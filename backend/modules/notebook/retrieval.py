"""Local retrieval for Notebook: paragraph-aware chunking and BM25 ranking. No embeddings, no network, no LLM."""
from __future__ import annotations

import math
import re
from collections import Counter
from typing import Any

# Small Indonesian + English stopword list; enough to keep BM25 focused on content words.
STOPWORDS = frozenset(
    """
    yang dan di ke dari untuk pada dengan adalah ini itu atau juga dalam sebagai oleh karena akan ada tidak
    dapat para serta saat saya kita kami mereka anda bagi telah sudah lebih hanya jika agar maka lalu
    the a an and or of to in on for with is are was were be been by as at from that this these those it its
    which who whom what when where how not no but if then than so such can could should would may might
    """.split()
)

_TOKEN_RE = re.compile(r"[A-Za-zÀ-ÿ0-9]{2,}")


def tokenize(text: str) -> list[str]:
    return [t for t in (m.group(0).lower() for m in _TOKEN_RE.finditer(text)) if t not in STOPWORDS]


def chunk_text(text: str, size: int = 900, overlap: int = 120) -> list[str]:
    """Split text into ~`size`-char chunks on paragraph/sentence boundaries, carrying a small overlap."""
    text = re.sub(r"[ \t]+", " ", text.replace("\r\n", "\n")).strip()
    if not text:
        return []
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n|\n(?=[A-Z0-9#•\-*])", text) if p.strip()]
    pieces: list[str] = []
    for para in paragraphs:
        if len(para) <= size:
            pieces.append(para)
            continue
        # long paragraph: split on sentence ends
        sentences = re.split(r"(?<=[.!?])\s+", para)
        buf = ""
        for sent in sentences:
            if len(sent) > size:  # pathological sentence: hard split
                if buf:
                    pieces.append(buf)
                    buf = ""
                pieces.extend(sent[i : i + size] for i in range(0, len(sent), size))
                continue
            if buf and len(buf) + len(sent) + 1 > size:
                pieces.append(buf)
                buf = sent
            else:
                buf = f"{buf} {sent}".strip()
        if buf:
            pieces.append(buf)

    chunks: list[str] = []
    buf = ""
    for piece in pieces:
        if buf and len(buf) + len(piece) + 2 > size:
            chunks.append(buf)
            tail = buf[-overlap:] if overlap > 0 else ""
            buf = f"{tail} {piece}".strip() if tail else piece
        else:
            buf = f"{buf}\n\n{piece}".strip() if buf else piece
    if buf:
        chunks.append(buf)
    return chunks


def rank(query: str, chunks: list[dict[str, Any]], k: int = 6, k1: float = 1.5, b: float = 0.75) -> list[dict[str, Any]]:
    """BM25 over `chunks` (dicts with a "text" key). Returns up to k chunks with score > 0, best first (adds "score")."""
    q_terms = list(dict.fromkeys(tokenize(query)))
    if not q_terms or not chunks:
        return []
    docs = [Counter(tokenize(c["text"])) for c in chunks]
    lengths = [sum(d.values()) for d in docs]
    avg_len = (sum(lengths) / len(lengths)) or 1.0
    n = len(docs)
    df = {t: sum(1 for d in docs if t in d) for t in q_terms}

    scored: list[tuple[float, int]] = []
    for i, d in enumerate(docs):
        score = 0.0
        for t in q_terms:
            f = d.get(t, 0)
            if not f:
                continue
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * lengths[i] / avg_len))
        if score > 0:
            scored.append((score, i))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [{**chunks[i], "score": round(s, 4)} for s, i in scored[:k]]
