"""Notebook service: source ingestion, grounded Q&A with citations, study outputs, paper drafts and .docx export.

Design rules (same as the rest of Karsa):
- Deterministic first: retrieval is local BM25; the LLM only writes prose from numbered excerpts.
- Grounded: answers must cite [n]; when nothing relevant is found the LLM is not called (no invented answers).
- Works without an API key: every LLM step has an honest extractive fallback.
- Datasets are indexed as a compact PROFILE, never as raw rows.
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any, Callable

from backend.core.config import settings
from backend.modules.notebook import dataset_cleaner
from backend.modules.notebook.retrieval import rank
from backend.modules.notebook.store import NotebookError, add_source, get_notebook, load_chunks

# (system_prompt, user_prompt) -> model text
LLMFn = Callable[[str, str], str]

DOCUMENT_EXTS = {".pdf", ".docx", ".pptx", ".txt", ".md"}
DATASET_EXTS = {".csv", ".xlsx", ".xls"}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_EXCERPT_CHARS = 700


# Reasoning tier first; if its provider/key is not usable (e.g. a DeepSeek endpoint without a valid key), fall back
# to the utility tier. Free Gemini keys have a small per-model daily quota (HTTP 429), so as a last resort a couple of
# other Gemini models are tried before giving up to the extractive mode.
LLM_TIERS = ("tier3_reasoning", "tier1_utility")
GEMINI_FALLBACK_MODELS = ("gemini-3.5-flash", "gemini-3.1-flash-lite")


def _invoke(model: Any, system: str, user: str) -> str:
    from langchain_core.messages import HumanMessage, SystemMessage

    resp = model.invoke([SystemMessage(content=system), HumanMessage(content=user)])
    content = resp.content
    if isinstance(content, list):
        content = "".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in content)
    text = str(content).strip()
    if not text:
        raise ValueError("jawaban kosong")
    return text


def default_llm(system: str, user: str) -> str:
    """Call the router's reasoning model, then the utility model, then other Gemini models. Usage is logged by the router."""
    from backend.core.llm_router import router

    last_error: Exception | None = None
    for tier in LLM_TIERS:
        try:
            return _invoke(router.get_chat_model(tier=tier, module_name="notebook"), system, user)
        except Exception as e:  # provider down, invalid key, retired model, quota...
            last_error = e
    if (settings.gemini_api_key or "").strip():
        for name in GEMINI_FALLBACK_MODELS:
            try:
                return _invoke(
                    router.get_chat_model(tier="tier1_utility", provider="gemini", model=name, module_name="notebook"),
                    system,
                    user,
                )
            except Exception as e:
                last_error = e
    raise last_error or RuntimeError("Tidak ada model AI yang tersedia")


# --------------------------------------------------------------------------- sources


def safe_filename(name: str) -> str:
    base = Path(name).name
    base = re.sub(r"[^\w.\- ()]", "_", base).strip(" .") or "sumber"
    return base[:120]


def ingest_file(notebook_id: int, file_path: Path, display_name: str | None = None, db_path: Path | str | None = None, ocr_fn: Callable[[bytes], str] | None = None) -> dict[str, Any]:
    """Index a stored file. Documents are chunked; datasets are indexed as a compact profile."""
    ext = file_path.suffix.lower()
    name = display_name or file_path.name
    if ext in DATASET_EXTS:
        text = dataset_cleaner.profile_text(file_path)
        return add_source(notebook_id, name, "dataset", text, path=str(file_path), db_path=db_path)
    if ext in DOCUMENT_EXTS:
        from backend.modules.study_daily.tools import extract_text_from_file

        try:
            text = extract_text_from_file(file_path)
        except Exception as e:
            raise NotebookError(f"Dokumen tidak bisa dibaca: {str(e)[:120]}")
        if not text.strip() and ext == ".pdf":
            from backend.modules.notebook import extras

            ocr = extras.ocr_pdf(file_path, ocr_fn=ocr_fn)  # a scanned PDF: read its page images (needs a Gemini key)
            note = f"\n\n[OCR: {ocr['pages']} dari {ocr['total_pages']} halaman dibaca" + (", sisanya dilewati]" if ocr["truncated"] else "]")
            return add_source(notebook_id, name, "document", ocr["text"] + note, path=str(file_path), db_path=db_path)
        if not text.strip():
            raise NotebookError("Dokumen tidak berisi teks yang bisa diekstrak (mungkin hasil scan/gambar).")
        return add_source(notebook_id, name, "document", text, path=str(file_path), db_path=db_path)
    raise NotebookError("Format belum didukung. Gunakan PDF, DOCX, PPTX, TXT, MD, CSV, atau XLSX.")


def store_upload(notebook_id: int, filename: str, data: bytes) -> Path:
    if len(data) > MAX_UPLOAD_BYTES:
        raise NotebookError("Ukuran file maksimal 25 MB.", "too_large")
    if not data:
        raise NotebookError("File kosong.")
    folder = settings.uploads_dir / "notebooks" / str(notebook_id)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / safe_filename(filename)
    if target.exists():
        target = folder / f"{target.stem}_{time.strftime('%H%M%S')}{target.suffix}"
    target.write_bytes(data)
    return target


# --------------------------------------------------------------------------- Q&A


def _excerpt(text: str, limit: int = MAX_EXCERPT_CHARS) -> str:
    t = re.sub(r"\s+", " ", text).strip()
    return t if len(t) <= limit else t[: limit - 1].rstrip() + "…"


def _numbered(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Number excerpts 1..n and group source names so citations stay stable inside one answer."""
    return [
        {"n": i, "source_id": h["source_id"], "source": h["source"], "excerpt": _excerpt(h["text"])}
        for i, h in enumerate(hits, start=1)
    ]


def _numbered_by_source(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Number excerpts by SOURCE (all excerpts of one source share [n]) so in-text citations map to a reference list."""
    order: dict[int, int] = {}
    out = []
    for h in hits:
        n = order.setdefault(h["source_id"], len(order) + 1)
        out.append({"n": n, "source_id": h["source_id"], "source": h["source"], "excerpt": _excerpt(h["text"])})
    return out


def _cited_numbers(text: str) -> list[int]:
    return sorted({int(n) for grp in re.findall(r"\[(\d+(?:\s*[,;]\s*\d+)*)\]", text) for n in re.split(r"[,;]\s*", grp)})


ASK_SYSTEM = (
    "Kamu adalah asisten riset untuk mahasiswa (seperti NotebookLM). Jawab HANYA berdasarkan KUTIPAN SUMBER yang diberikan. "
    "Setiap klaim wajib diberi rujukan angka dalam kurung siku, misalnya [1] atau [2][3]. "
    "Jika kutipan tidak cukup untuk menjawab, katakan terus terang bahwa sumber tidak memuat jawabannya. "
    "Jangan menambah fakta dari luar sumber. Jawab dalam bahasa yang sama dengan pertanyaan, ringkas dan jelas."
)


def ask(notebook_id: int, question: str, llm_fn: LLMFn | None = None, db_path: Path | str | None = None) -> dict[str, Any]:
    question = (question or "").strip()
    if not question:
        raise NotebookError("Pertanyaan tidak boleh kosong.")
    get_notebook(notebook_id, db_path)
    chunks = load_chunks(notebook_id, db_path)
    if not chunks:
        raise NotebookError("Notebook belum punya sumber. Tambahkan dokumen atau dataset dulu.")

    hits = rank(question, chunks, k=6)
    if not hits:
        return {
            "answer": "Sumber di notebook ini tidak memuat informasi yang relevan dengan pertanyaan itu.",
            "citations": [],
            "mode": "no_match",
        }
    cites = _numbered(hits)
    excerpts = "\n\n".join(f"[{c['n']}] (sumber: {c['source']})\n{c['excerpt']}" for c in cites)
    user = f"KUTIPAN SUMBER:\n{excerpts}\n\nPERTANYAAN: {question}"

    try:
        text = (llm_fn or default_llm)(ASK_SYSTEM, user)
        if not text.strip():
            raise ValueError("empty answer")
    except Exception as e:
        return {
            "answer": "Model AI belum tersedia, jadi ini kutipan paling relevan dari sumbermu:\n\n"
            + "\n\n".join(f"[{c['n']}] {c['excerpt']}" for c in cites[:3]),
            "citations": cites[:3],
            "mode": "extractive",
            "note": f"LLM tidak tersedia: {str(e)[:100]}",
        }

    used = set(_cited_numbers(text))
    shown = [c for c in cites if c["n"] in used] or cites
    return {"answer": text.strip(), "citations": shown, "mode": "llm"}


# --------------------------------------------------------------------------- studio outputs


STUDIO_SYSTEMS = {
    "briefing": (
        "Buat BRIEFING DOC dari kutipan sumber: (1) Ringkasan eksekutif 3-4 kalimat, (2) 5-7 poin kunci, "
        "(3) Pertanyaan terbuka/keterbatasan. Rujuk setiap poin dengan [n]. Hanya gunakan isi kutipan."
    ),
    "study_guide": (
        "Buat PANDUAN BELAJAR dari kutipan sumber: (1) Konsep kunci + definisi singkat, (2) Kamus istilah, "
        "(3) 5 soal latihan mandiri beserta kunci jawaban singkat. Rujuk dengan [n]. Hanya gunakan isi kutipan."
    ),
}


def _spread_sample(chunks: list[dict[str, Any]], per_source: int = 2, limit: int = 12) -> list[dict[str, Any]]:
    by_source: dict[int, list[dict[str, Any]]] = {}
    for c in chunks:
        by_source.setdefault(c["source_id"], []).append(c)
    out: list[dict[str, Any]] = []
    for group in by_source.values():
        out.extend(group[:per_source])
    return out[:limit]


def generate_study(notebook_id: int, kind: str, llm_fn: LLMFn | None = None, db_path: Path | str | None = None) -> dict[str, Any]:
    if kind not in STUDIO_SYSTEMS:
        raise NotebookError("Jenis keluaran tidak dikenal.")
    chunks = load_chunks(notebook_id, db_path)
    if not chunks:
        raise NotebookError("Notebook belum punya sumber. Tambahkan dokumen atau dataset dulu.")
    cites = _numbered_by_source(_spread_sample(chunks))
    excerpts = "\n\n".join(f"[{c['n']}] (sumber: {c['source']})\n{c['excerpt']}" for c in cites)
    try:
        text = (llm_fn or default_llm)(STUDIO_SYSTEMS[kind], f"KUTIPAN SUMBER:\n{excerpts}")
        if not text.strip():
            raise ValueError("empty")
        return {"kind": kind, "markdown": text.strip(), "citations": cites, "mode": "llm"}
    except Exception as e:
        body = "\n".join(f"- {c['excerpt'][:240]} [{c['n']}]" for c in cites[:8])
        title = "Ringkasan sumber (ekstraktif)" if kind == "briefing" else "Bahan belajar dari sumber (ekstraktif)"
        return {
            "kind": kind,
            "markdown": f"## {title}\n\nModel AI belum tersedia, berikut cuplikan nyata dari sumbermu:\n\n{body}",
            "citations": cites[:8],
            "mode": "extractive",
            "note": f"LLM tidak tersedia: {str(e)[:100]}",
        }


# --------------------------------------------------------------------------- scientific paper draft (IMRaD)

SECTION_QUERIES = {
    "introduction": "latar belakang masalah pendahuluan tujuan penelitian motivasi background introduction objective",
    "methods": "metode metodologi dataset data pendekatan algoritma prosedur eksperimen method methodology approach",
    "results": "hasil temuan evaluasi akurasi performa analisis results findings evaluation accuracy",
    "discussion": "pembahasan diskusi limitasi keterbatasan kesimpulan implikasi discussion limitation conclusion",
}
SECTION_LABELS = {
    "introduction": "Pendahuluan",
    "methods": "Metodologi",
    "results": "Hasil",
    "discussion": "Pembahasan",
}

PAPER_SYSTEM = (
    "Kamu penulis karya ilmiah untuk mahasiswa. Tulis draf IMRaD dalam bahasa Indonesia baku HANYA dari kutipan sumber yang diberikan. "
    "Setiap klaim faktual wajib dirujuk dengan [n] sesuai nomor kutipan. Jangan mengarang angka, hasil, atau referensi. "
    "Bila kutipan untuk suatu bagian kurang, tulis kalimat jujur seperti 'Bagian ini perlu data tambahan dari penulis.'. "
    'Balas HANYA JSON: {"title": str, "abstract": str, "introduction": str, "methods": str, "results": str, "discussion": str}.'
)


def _parse_json_object(text: str) -> dict[str, Any]:
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.IGNORECASE)
    start, end = t.find("{"), t.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON object")
    data = json.loads(t[start : end + 1])
    if not isinstance(data, dict):
        raise ValueError("not an object")
    return data


def _references(cites: list[dict[str, Any]], used: set[int] | None = None) -> list[str]:
    """One reference line per source that is actually cited; [n] matches the in-text citation numbers."""
    seen: dict[int, str] = {}
    for c in cites:
        if used is None or c["n"] in used:
            seen.setdefault(c["n"], c["source"])
    return [f"[{n}] {name}" for n, name in sorted(seen.items())]


def generate_paper(
    notebook_id: int,
    topic: str = "",
    llm_fn: LLMFn | None = None,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """IMRaD draft grounded in the notebook's sources. Returns structured sections, markdown and the citation table."""
    nb = get_notebook(notebook_id, db_path)
    chunks = load_chunks(notebook_id, db_path)
    if not chunks:
        raise NotebookError("Notebook belum punya sumber. Tambahkan dokumen atau dataset dulu.")
    topic = (topic or nb["title"]).strip()

    # Retrieve per section, then number the union of excerpts once so citations are consistent across sections
    picked: dict[int, dict[str, Any]] = {}
    per_section: dict[str, list[int]] = {}
    for key, q in SECTION_QUERIES.items():
        ids = []
        for h in rank(f"{topic} {q}", chunks, k=3):
            picked.setdefault(h["chunk_id"], h)
            ids.append(h["chunk_id"])
        per_section[key] = ids
    if not picked:
        picked = {c["chunk_id"]: c for c in _spread_sample(chunks, per_source=2, limit=6)}
    ordered = list(picked.values())
    cites = _numbered_by_source(ordered)
    number_of = {h["chunk_id"]: c["n"] for h, c in zip(ordered, cites)}

    excerpts = "\n\n".join(f"[{c['n']}] (sumber: {c['source']})\n{c['excerpt']}" for c in cites)
    user = f"TOPIK/JUDUL: {topic}\n\nKUTIPAN SUMBER:\n{excerpts}"

    sections: dict[str, str]
    mode = "llm"
    note = None
    try:
        data = _parse_json_object((llm_fn or default_llm)(PAPER_SYSTEM, user))
        sections = {k: str(data.get(k, "")).strip() for k in ("introduction", "methods", "results", "discussion")}
        title = str(data.get("title") or topic).strip()
        abstract = str(data.get("abstract", "")).strip()
        if not any(sections.values()):
            raise ValueError("empty sections")
    except Exception as e:
        # Honest fallback: evidence lists per section, no invented prose
        mode, note = "extractive", f"LLM tidak tersedia: {str(e)[:100]}"
        title, abstract = topic, ""
        sections = {}
        for key, ids in per_section.items():
            lines = [f"- {_excerpt(picked[i]['text'], 260)} [{number_of[i]}]" for i in ids if i in picked]
            sections[key] = (
                "Bahan dari sumber (tulis ulang dengan kalimatmu sendiri):\n" + "\n".join(lines)
                if lines
                else "Belum ada kutipan sumber yang cocok untuk bagian ini."
            )

    used = set(_cited_numbers(" ".join(sections.values()) + " " + abstract))
    references = _references(cites, used or None)
    md = [f"**{title}**", ""]
    if abstract:
        md += ["## Abstrak", abstract, ""]
    for key in ("introduction", "methods", "results", "discussion"):
        md += [f"## {SECTION_LABELS[key]}", sections[key], ""]
    md += ["## Daftar Sumber", *[f"{r}" for r in references]]
    return {
        "kind": "paper_draft",
        "title": title,
        "abstract": abstract,
        "sections": sections,
        "references": references,
        "markdown": "\n".join(md).strip(),
        "citations": cites,
        "mode": mode,
        **({"note": note} if note else {}),
    }


def export_paper_docx(paper: dict[str, Any], out_dir: Path | None = None) -> dict[str, Any]:
    """Compile a paper dict (from generate_paper, possibly edited by the user) into a .docx. Never overwrites."""
    from backend.modules.research_writer.writer_tools import compile_imrad_to_docx

    sections = paper.get("sections") or {}
    if not any(str(sections.get(k, "")).strip() for k in ("introduction", "methods", "results", "discussion")):
        raise NotebookError("Draf kosong: tidak ada bagian yang bisa diekspor.")
    title = str(paper.get("title") or "Karya Ilmiah").strip()
    slug = re.sub(r"[^A-Za-z0-9]+", "_", title).strip("_")[:50] or "Karya_Ilmiah"
    out_dir = out_dir or settings.outputs_dir
    out = out_dir / f"{slug}_{time.strftime('%Y%m%d_%H%M%S')}.docx"
    imrad = {
        "title": title,
        "abstract": str(paper.get("abstract") or ""),
        "keywords": [],
        "introduction": str(sections.get("introduction", "")),
        "methods": str(sections.get("methods", "")),
        "results": str(sections.get("results", "")),
        "discussion": str(sections.get("discussion", "")),
        "references": [str(r) for r in (paper.get("references") or [])],
    }
    compile_imrad_to_docx(imrad, out, overwrite=False)
    return {"path": str(out), "filename": out.name}
