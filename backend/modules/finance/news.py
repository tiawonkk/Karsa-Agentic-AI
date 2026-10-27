"""Finance news from public RSS feeds. Real headlines or an honest error: never invented news."""
from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from typing import Any, Callable

import httpx

# Public Indonesian economy/finance RSS feeds (each is tried independently; one failing does not hide the others)
FEEDS: list[dict[str, str]] = [
    {"source": "Antara Ekonomi", "url": "https://www.antaranews.com/rss/ekonomi.xml"},
    {"source": "Detik Finance", "url": "https://finance.detik.com/rss"},
    {"source": "CNBC Indonesia Market", "url": "https://www.cnbcindonesia.com/market/rss"},
]

FetchFn = Callable[[str], str]
_TAG = re.compile(r"<[^>]+>")


class NewsError(RuntimeError):
    pass


def _http_get(url: str) -> str:
    r = httpx.get(url, timeout=8.0, follow_redirects=True, headers={"User-Agent": "Karsa/1.0 (+personal companion)"})
    r.raise_for_status()
    return r.text


def clean(text: str | None, limit: int = 240) -> str:
    t = html.unescape(_TAG.sub(" ", text or ""))
    t = re.sub(r"\s+", " ", t).strip()
    return t if len(t) <= limit else t[: limit - 1].rstrip() + "…"


def parse_rss(xml_text: str, source: str, limit: int = 8) -> list[dict[str, Any]]:
    try:
        root = ET.fromstring(xml_text.strip())
    except ET.ParseError as e:
        raise NewsError(f"Feed {source} bukan XML yang valid: {e}")
    out: list[dict[str, Any]] = []
    for item in root.iter("item"):
        title = clean(item.findtext("title"), 200)
        link = (item.findtext("link") or "").strip()
        if not title or not link.startswith(("http://", "https://")):
            continue
        out.append({"title": title, "link": link, "summary": clean(item.findtext("description")), "published": (item.findtext("pubDate") or "").strip(), "source": source})
        if len(out) >= limit:
            break
    return out


def fetch_news(limit: int = 12, fetch: FetchFn | None = None, feeds: list[dict[str, str]] | None = None) -> dict[str, Any]:
    """Headlines from every reachable feed (newest first as the feeds give them) plus which feeds failed and why."""
    get = fetch or _http_get
    items: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for feed in feeds or FEEDS:
        try:
            items.extend(parse_rss(get(feed["url"]), feed["source"]))
        except Exception as e:
            errors.append({"source": feed["source"], "error": str(e)[:160]})
    seen: set[str] = set()
    unique = []
    for it in items:
        key = re.sub(r"\W+", "", it["title"].lower())
        if key not in seen:
            seen.add(key)
            unique.append(it)
    if not unique:
        raise NewsError("Berita tidak bisa diambil sekarang: " + "; ".join(f"{e['source']}: {e['error']}" for e in errors) if errors else "Tidak ada berita.")
    # interleave sources so one feed does not fill the list
    by_src: dict[str, list[dict[str, Any]]] = {}
    for it in unique:
        by_src.setdefault(it["source"], []).append(it)
    mixed: list[dict[str, Any]] = []
    while any(by_src.values()) and len(mixed) < limit:
        for k in list(by_src):
            if by_src[k] and len(mixed) < limit:
                mixed.append(by_src[k].pop(0))
    return {"items": mixed, "errors": errors}


def summarize_news(items: list[dict[str, Any]], llm_fn: Callable[[str, str], str] | None = None) -> dict[str, Any]:
    """A short Indonesian digest. Without a model it lists the headlines (honest extractive fallback)."""
    if not items:
        return {"summary": "Belum ada berita untuk dirangkum.", "used_llm": False}
    heads = "\n".join(f"- {i['title']} ({i['source']})" for i in items[:10])
    if llm_fn:
        try:
            text = llm_fn(
                "Kamu analis keuangan untuk mahasiswa Indonesia. Rangkum judul berita di bawah menjadi 3-4 poin singkat dan netral. "
                "Jangan menambah fakta di luar judul, jangan memberi saran investasi.",
                heads,
            )
            if text.strip():
                return {"summary": text.strip(), "used_llm": True}
        except Exception:
            pass
    return {"summary": "Judul terbaru (tanpa ringkasan AI):\n" + heads, "used_llm": False}
