"""Notebook extras: web pages as sources, OCR for scanned PDFs, a spoken-overview script and a quiz.

Same rules as the notebook: grounded in the user's own sources, honest fallbacks when no model is available, and no
request that could reach the user's own network (private addresses are refused for URL sources).
"""
from __future__ import annotations

import io
import ipaddress
import json
import random
import re
import socket
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

import httpx

from backend.core.config import settings
from backend.core.llm_helpers import LLMFn, parse_json_loose
from backend.modules.notebook.store import NotebookError, add_source, load_chunks

MAX_PAGE_BYTES = 3 * 1024 * 1024
MIN_TEXT_CHARS = 200
OCR_MAX_PAGES = 8
SKIP_TAGS = {"script", "style", "noscript", "nav", "footer", "header", "form", "aside", "svg", "iframe"}
BLOCK_TAGS = {"p", "div", "section", "article", "li", "br", "h1", "h2", "h3", "h4", "tr", "blockquote", "pre"}

FetchFn = Callable[[str], tuple[str, str]]  # url -> (content_type, text)
OcrFn = Callable[[bytes], str]


# ----------------------------------------------------------------------------------------------------- web pages
class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self._in_title = False
        self._skip = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag == "title":
            self._in_title = True
        elif tag in SKIP_TAGS:
            self._skip += 1
        elif tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag in SKIP_TAGS and self._skip:
            self._skip -= 1
        elif tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        elif not self._skip:
            self.parts.append(data)


def html_to_text(page: str) -> tuple[str, str]:
    """(title, readable text) from an HTML page: scripts, menus and footers are dropped."""
    p = _TextExtractor()
    p.feed(page)
    text = re.sub(r"[ \t\r\f\v]+", " ", "".join(p.parts))
    text = "\n".join(line.strip() for line in text.split("\n"))
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return " ".join(p.title.split())[:160], text


def check_public_url(url: str) -> str:
    """Only http(s) pages on the public internet: localhost, private and link-local addresses are refused."""
    u = urlparse((url or "").strip())
    if u.scheme not in ("http", "https") or not u.hostname:
        raise NotebookError("Alamat harus diawali http:// atau https://.")
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise NotebookError("Alamat tidak ditemukan (periksa penulisan atau koneksi internet).")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise NotebookError("Alamat di jaringan lokal tidak diizinkan sebagai sumber.")
    return u.geturl()


def _http_fetch(url: str) -> tuple[str, str]:
    try:
        with httpx.stream("GET", url, timeout=12.0, follow_redirects=True, headers={"User-Agent": "Karsa/1.0 (+personal notebook)"}) as r:
            if r.status_code != 200:
                raise NotebookError(f"Halaman membalas HTTP {r.status_code}.")
            ctype = r.headers.get("content-type", "")
            body = b""
            for chunk in r.iter_bytes():
                body += chunk
                if len(body) > MAX_PAGE_BYTES:
                    raise NotebookError("Halaman terlalu besar (maks 3 MB).")
            return ctype, body.decode(r.encoding or "utf-8", errors="replace")
    except httpx.HTTPError as e:
        raise NotebookError(f"Halaman tidak bisa dibuka ({type(e).__name__}).")


def add_url_source(notebook_id: int, url: str, fetch: FetchFn | None = None, db_path: Path | str | None = None) -> dict[str, Any]:
    clean = check_public_url(url)
    ctype, body = (fetch or _http_fetch)(clean)
    if "html" in ctype.lower() or body.lstrip().lower().startswith(("<!doctype", "<html")):
        title, text = html_to_text(body)
    elif ctype.lower().startswith("text/"):
        title, text = "", body.strip()
    else:
        raise NotebookError("Jenis isi tidak didukung. Gunakan halaman web atau teks; untuk PDF, unduh lalu unggah filenya.")
    if len(text) < MIN_TEXT_CHARS:
        raise NotebookError("Halaman hampir tidak berisi teks yang bisa dibaca (mungkin butuh login atau dimuat lewat JavaScript).")
    name = title or urlparse(clean).netloc
    return add_source(notebook_id, f"{name} ({urlparse(clean).netloc})"[:150], "text", f"Sumber: {clean}\n\n{text}", path=clean, db_path=db_path)


# ----------------------------------------------------------------------------------------------------- scanned PDFs
OCR_PROMPT = "Transkripsikan semua teks pada gambar halaman ini apa adanya (bahasa asli, tanpa ringkasan, tanpa komentar). Jika tidak ada teks, balas kosong."


def gemini_ocr(jpeg: bytes) -> str:
    from backend.modules.finance.receipt_ocr import _resolve_api_key

    key = _resolve_api_key()
    if not key:
        raise NotebookError("PDF ini hasil scan (gambar). Pasang kunci Gemini di Settings agar Karsa bisa membacanya (OCR).", "no_api_key")
    try:
        from google import genai
        from google.genai import types

        resp = genai.Client(api_key=key).models.generate_content(
            model=settings.tier1_model,
            contents=[types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"), OCR_PROMPT],
            config=types.GenerateContentConfig(temperature=0),
        )
        return (resp.text or "").strip()
    except Exception as e:
        raise NotebookError(f"OCR gagal: {str(e)[:160]}")


def ocr_pdf(path: Path | str, ocr_fn: OcrFn | None = None, max_pages: int = OCR_MAX_PAGES) -> dict[str, Any]:
    """Read a scanned PDF through its embedded page images (first `max_pages` pages). Returns {text, pages, truncated}."""
    from PIL import Image
    from pypdf import PdfReader

    from backend.modules.finance.receipt_ocr import prepare_image

    reader = PdfReader(str(path))
    total = len(reader.pages)
    texts: list[str] = []
    done = 0
    for page in reader.pages[:max_pages]:
        images = list(page.images)
        if not images:
            continue
        data = images[0].data
        try:
            with Image.open(io.BytesIO(data)) as im:
                im.load()
            jpeg = prepare_image(data)
        except Exception:
            continue
        done += 1
        t = (ocr_fn or gemini_ocr)(jpeg)
        if t.strip():
            texts.append(t.strip())
    if not texts:
        raise NotebookError("Tidak ada teks yang berhasil dibaca dari PDF scan ini.")
    return {"text": "\n\n".join(texts), "pages": done, "total_pages": total, "truncated": total > max_pages}


# ----------------------------------------------------------------------------------------------------- audio overview
def _context(notebook_id: int, limit: int = 12, db_path: Path | str | None = None) -> list[dict[str, Any]]:
    chunks = load_chunks(notebook_id, db_path)
    if not chunks:
        raise NotebookError("Notebook belum punya sumber. Tambahkan dokumen atau dataset dulu.")
    by_source: dict[int, list[dict[str, Any]]] = {}
    for c in chunks:
        by_source.setdefault(c["source_id"], []).append(c)
    out: list[dict[str, Any]] = []
    for group in by_source.values():
        out.extend(group[:3])
    return out[:limit]


def audio_overview(notebook_id: int, llm_fn: LLMFn | None = None, db_path: Path | str | None = None) -> dict[str, Any]:
    """A short spoken-style overview of the sources, split into segments the browser reads aloud (speechSynthesis).

    Without a model it reads the opening of each source aloud as is (honest, extractive)."""
    ctx = _context(notebook_id, db_path=db_path)
    material = "\n\n".join(f"[{i + 1}] {c.get('source', '')}: {str(c.get('text', c.get('excerpt', '')))[:700]}" for i, c in enumerate(ctx))
    if llm_fn:
        try:
            raw = llm_fn(
                "Kamu pemandu belajar. Ubah materi menjadi ringkasan lisan yang enak didengar (sekitar 5-8 segmen pendek, bahasa Indonesia santai tapi akurat). "
                "Hanya gunakan isi materi; jangan menambah fakta. Balas JSON: {\"title\": str, \"segments\": [str, ...]}.",
                material,
            )
            data = parse_json_loose(raw)
            segs = [str(s).strip() for s in data.get("segments", []) if str(s).strip()]
            if segs:
                return {"title": str(data.get("title", "Ringkasan audio")), "segments": segs[:12], "mode": "llm"}
        except Exception as e:
            reason = str(e)[:120]
    else:
        reason = "model AI belum tersambung"
    segs = []
    for c in ctx[:8]:
        t = re.sub(r"\s+", " ", str(c.get("text", c.get("excerpt", "")))).strip()
        if t:
            segs.append(f"Dari {c.get('source', 'sumber')}: {t[:320]}")
    return {"title": "Pembacaan sumber (tanpa AI)", "segments": segs, "mode": "extractive", "note": f"Ringkasan AI tidak tersedia ({reason}); ini cuplikan asli sumbermu."}


# ----------------------------------------------------------------------------------------------------- quiz
_STOP = set("yang dan atau dengan untuk pada dari dalam adalah ini itu juga akan oleh sebagai dapat karena tidak lebih telah serta agar bahwa the and for with that this from are was were has have".split())


def cloze_questions(chunks: list[dict[str, Any]], n: int, seed: int = 7) -> list[dict[str, Any]]:
    """Deterministic fill-in-the-blank questions: a sentence from the source with its most informative word removed."""
    sentences: list[tuple[str, str]] = []
    for c in chunks:
        for s in re.split(r"(?<=[.!?])\s+", str(c.get("text", c.get("excerpt", "")))):
            s = " ".join(s.split())
            if 40 <= len(s) <= 240:
                sentences.append((s, str(c.get("source", ""))))
    random.Random(seed).shuffle(sentences)
    out = []
    for s, src in sentences:
        words = [w for w in re.findall(r"[A-Za-zÀ-ÿ0-9\-]{5,}", s) if w.lower() not in _STOP]
        if not words:
            continue
        ans = max(words, key=len)
        out.append({"type": "isian", "question": s.replace(ans, "_____", 1), "answer": ans, "explanation": f"Dari {src}", "source": src})
        if len(out) >= n:
            break
    return out


def generate_quiz(notebook_id: int, n: int = 6, llm_fn: LLMFn | None = None, db_path: Path | str | None = None) -> dict[str, Any]:
    n = max(1, min(int(n), 12))
    ctx = _context(notebook_id, db_path=db_path)
    material = "\n\n".join(f"[{i + 1}] ({c.get('source', '')}) {str(c.get('text', c.get('excerpt', '')))[:700]}" for i, c in enumerate(ctx))
    if llm_fn:
        try:
            raw = llm_fn(
                f"Buat {n} soal pilihan ganda dari materi, Bahasa Indonesia. Hanya dari isi materi. Balas JSON: "
                '{"questions":[{"question":str,"options":[4 string],"answer_index":0-3,"explanation":str,"source":str}]}.',
                material,
            )
            qs = []
            for q in parse_json_loose(raw).get("questions", []):
                opts = [str(o) for o in q.get("options", [])]
                idx = q.get("answer_index")
                if len(opts) == 4 and isinstance(idx, int) and 0 <= idx < 4 and str(q.get("question", "")).strip():
                    qs.append({"type": "pilihan", "question": str(q["question"]), "options": opts, "answer_index": idx, "explanation": str(q.get("explanation", "")), "source": str(q.get("source", ""))})
            if qs:
                return {"questions": qs[:n], "mode": "llm"}
        except Exception:
            pass
    qs = cloze_questions(ctx, n)
    if not qs:
        raise NotebookError("Sumber terlalu pendek untuk dibuatkan soal.")
    return {"questions": qs, "mode": "extractive", "note": "Soal isian otomatis dari kalimat sumber (tanpa AI)."}
