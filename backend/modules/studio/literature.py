"""Literature search across arXiv, Crossref and Semantic Scholar, a structured literature matrix, and project novelty analysis.

Papers are always real search results. Matrix cells are extracted deterministically from the abstract text and left empty
when the abstract does not say (never filled in by guessing). The novelty analysis needs a model; without one the tool
returns the facts it can count and says plainly that the gap judgement was not made.
"""
from __future__ import annotations

import re
import urllib.parse
from collections import Counter
from typing import Any, Callable

from backend.core.llm_helpers import LLMFn, parse_json_loose
from backend.modules.research_writer.research_tools import ResearchSearchError, _fetch, query_arxiv_api, query_crossref_api

SearchFn = Callable[[str, int], dict[str, Any]]

METHOD_TERMS = [
    "transformer", "convolutional", "cnn", "lstm", "gru", "random forest", "xgboost", "svm", "support vector", "bert", "gpt", "llm",
    "large language model", "retrieval-augmented", "rag", "reinforcement learning", "diffusion", "gan", "naive bayes",
    "logistic regression", "k-means", "clustering", "regression", "fine-tuning", "transfer learning", "federated", "graph neural",
    "autoencoder", "ensemble", "bayesian", "decision tree", "time series", "ocr", "object detection", "segmentation",
]
KNOWN_DATASETS = ["ImageNet", "CIFAR-10", "CIFAR-100", "MNIST", "COCO", "SQuAD", "GLUE", "IMDB", "Kaggle", "UCI", "PubMed", "Wikipedia", "Common Crawl", "MS MARCO", "LibriSpeech"]
_DATASET_RE = re.compile(r"\b([A-Z][\w\-]{2,}(?:\s[A-Z][\w\-]{2,})?)\s+(?:dataset|data set|corpus|benchmark)s?\b")
_METRIC_RE = re.compile(r"\b(accuracy|precision|recall|f1(?:-score)?|auc|rmse|mae|bleu|rouge(?:-\w)?|mape|r2|r\^2)\b[^.\d]{0,20}?(\d{1,3}(?:\.\d+)?\s?%?)", re.I)
_GAP_RE = re.compile(r"[^.]*\b(future work|limitation|limitations|however|remains? (?:unclear|open|challenging)|lack of|lacks|not yet|little (?:work|attention)|few studies)\b[^.]*\.", re.I)


def query_semantic_scholar(query: str, max_results: int = 5) -> list[dict[str, Any]]:
    fields = "title,year,abstract,venue,externalIds,url,citationCount,authors"
    url = f"https://api.semanticscholar.org/graph/v1/paper/search?query={urllib.parse.quote(query.strip())}&limit={max(1, min(int(max_results), 10))}&fields={fields}"
    try:
        data = _fetch(url).json()
    except ValueError as e:
        raise ResearchSearchError(f"jawaban sumber tidak terbaca ({e})") from e
    out = []
    for p in data.get("data", []) or []:
        ext = p.get("externalIds") or {}
        out.append(
            {
                "source": "semantic_scholar",
                "external_id": p.get("paperId", ""),
                "doi": ext.get("DOI", ""),
                "title": p.get("title") or "Untitled",
                "authors": ", ".join(a.get("name", "") for a in (p.get("authors") or [])[:5]) or "Unknown",
                "publication_year": p.get("year"),
                "abstract": (p.get("abstract") or "")[:1200],
                "url": p.get("url", ""),
                "venue": p.get("venue") or "",
                "citations": p.get("citationCount"),
            }
        )
    return out


SOURCES: dict[str, Callable[[str, int], list[dict[str, Any]]]] = {
    "arxiv": query_arxiv_api,
    "crossref": query_crossref_api,
    "semantic_scholar": query_semantic_scholar,
}


def search_all(query: str, per_source: int = 4, sources: dict[str, Callable[[str, int], list[dict[str, Any]]]] | None = None) -> dict[str, Any]:
    """Every source is tried on its own: one failing never hides the papers the others found. Duplicates (same title) are merged."""
    papers: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for name, fn in (sources or SOURCES).items():
        try:
            papers.extend(fn(query, per_source))
        except Exception as e:
            errors.append({"source": name, "error": str(e)[:160]})
    seen: set[str] = set()
    unique = []
    for p in papers:
        key = re.sub(r"\W+", "", str(p.get("title", "")).lower())
        if key and key not in seen:
            seen.add(key)
            unique.append(p)
    unique.sort(key=lambda p: (p.get("publication_year") or 0), reverse=True)
    return {"papers": unique, "errors": errors}


def matrix_row(p: dict[str, Any]) -> dict[str, Any]:
    text = f"{p.get('title', '')}. {p.get('abstract', '')}"
    low = text.lower()
    methods = []
    for term in METHOD_TERMS:
        if re.search(rf"(?<![a-z]){re.escape(term)}(?![a-z])", low) and term not in methods:
            methods.append(term)
    datasets = [d for d in KNOWN_DATASETS if d.lower() in low]
    for m in _DATASET_RE.finditer(text):
        name = m.group(1).strip()
        if name not in datasets and name.lower() not in ("the", "this", "our", "new", "large", "public"):
            datasets.append(name)
    metrics = []
    for m in _METRIC_RE.finditer(text):
        item = f"{m.group(1).upper()} {m.group(2).strip()}"
        if item not in metrics:
            metrics.append(item)
    gap = _GAP_RE.search(text)
    return {
        "title": p.get("title", ""),
        "year": p.get("publication_year"),
        "source": p.get("source", ""),
        "url": p.get("url", ""),
        "methods": methods[:6],
        "datasets": datasets[:5],
        "metrics": metrics[:5],
        "gap": gap.group(0).strip()[:300] if gap else "",
        "has_abstract": bool((p.get("abstract") or "").strip()),
    }


def literature_matrix(papers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [matrix_row(p) for p in papers]


def analyze_topic(
    name: str,
    topic: str,
    search_fn: SearchFn | None = None,
    llm_fn: LLMFn | None = None,
) -> dict[str, Any]:
    """Search the literature for the project's topic and assess what could be new about it."""
    query = (topic or name).strip()
    if len(query) < 3:
        raise ValueError("Tulis topik proyek minimal beberapa kata.")
    found = (search_fn or search_all)(query, 4)
    papers = found["papers"]
    matrix = literature_matrix(papers)
    methods = Counter(m for r in matrix for m in r["methods"])
    datasets = Counter(d for r in matrix for d in r["datasets"])
    facts = {
        "papers_found": len(papers),
        "years": sorted({r["year"] for r in matrix if r["year"]}),
        "top_methods": methods.most_common(5),
        "datasets_mentioned": datasets.most_common(6),
        "gaps_quoted": [r["gap"] for r in matrix if r["gap"]][:5],
    }
    result: dict[str, Any] = {"name": name, "topic": query, "papers": papers, "matrix": matrix, "facts": facts, "errors": found["errors"], "novelty": None, "used_llm": False}
    if not papers:
        result["novelty"] = {"summary": "Tidak ada paper ditemukan untuk topik ini, jadi kebaruan belum bisa dinilai. Coba kata kunci bahasa Inggris yang lebih umum.", "ideas": [], "gaps": []}
        return result
    if llm_fn:
        listing = "\n".join(f"- {r['title']} ({r['year']}); metode: {', '.join(r['methods']) or '?'}; dataset: {', '.join(r['datasets']) or '?'}; metrik: {', '.join(r['metrics']) or '?'}" for r in matrix[:12])
        try:
            raw = llm_fn(
                "Kamu pembimbing riset. Berdasarkan HANYA daftar paper nyata di bawah, nilai peluang kebaruan (novelty) proyek mahasiswa. "
                "Balas JSON dengan kunci: summary (2-4 kalimat), gaps (daftar celah riset yang terlihat dari daftar), ideas (daftar 3-5 ide konkret "
                "yang bisa dikerjakan, tiap item {title, why_new, first_step}). Jangan menyebut paper yang tidak ada di daftar dan jangan "
                "mengklaim sesuatu belum pernah dilakukan; katakan 'dari daftar ini belum terlihat'.",
                f"Proyek: {name}\nTopik: {query}\n\nPaper:\n{listing}",
            )
            data = parse_json_loose(raw)
            result["novelty"] = {
                "summary": str(data.get("summary", "")).strip(),
                "gaps": [str(g) for g in (data.get("gaps") or [])][:8],
                "ideas": [i for i in (data.get("ideas") or []) if isinstance(i, dict)][:6],
            }
            result["used_llm"] = True
            return result
        except Exception as e:
            result["llm_error"] = str(e)[:200]
    top = ", ".join(f"{m} ({c})" for m, c in facts["top_methods"]) or "tidak terdeteksi dari abstrak"
    result["novelty"] = {
        "summary": (
            f"Ditemukan {len(papers)} paper. Metode yang paling sering muncul: {top}. "
            "Penilaian celah dan kebaruan butuh AI atau pembacaan paper; tombol analisis akan memakainya saat model tersambung."
        ),
        "gaps": facts["gaps_quoted"],
        "ideas": [],
    }
    return result
