"""Deterministic context compaction: keep recent chat turns verbatim, fold older ones into a short digest.

No LLM call (deterministic-first). Token counts use the common ~4 characters per token estimate, which is good enough
to decide when to compact; real usage is still measured by the token tracker.
"""
from __future__ import annotations

from typing import Any, Iterable

COMPACT_THRESHOLD_TOKENS = 3000
DIGEST_LINE_CHARS = 110


def estimate_tokens(text: str) -> int:
    return (len(text) + 3) // 4


def _role(msg: Any) -> str:
    kind = getattr(msg, "type", "") or (msg.get("role", "") if isinstance(msg, dict) else "")
    return "Kamu" if kind in ("human", "user") else "Karsa"


def _text(msg: Any) -> str:
    content = getattr(msg, "content", None)
    if content is None and isinstance(msg, dict):
        content = msg.get("content", "")
    return " ".join(str(content or "").split())


def compact_history(
    messages: Iterable[Any],
    max_tokens: int = COMPACT_THRESHOLD_TOKENS,
    keep_recent: int = 6,
) -> str:
    """Return a context string for the model. Short histories pass through untouched.

    Above `max_tokens`, the newest `keep_recent` turns stay verbatim and the older ones become one-line summaries
    ("Kamu: ..."), oldest dropped first, until the result fits the budget.
    """
    turns = [(_role(m), _text(m)) for m in messages if _text(m)]
    if not turns:
        return ""
    full = "\n".join(f"{r}: {t}" for r, t in turns)
    if estimate_tokens(full) <= max_tokens:
        return full

    recent = turns[-keep_recent:]
    older = turns[:-keep_recent]
    recent_block = "\n".join(f"{r}: {t}" for r, t in recent)
    # budget left for the digest; if the recent turns alone overflow, trim each of them
    budget = max_tokens - estimate_tokens(recent_block)
    if budget <= 0:
        per_turn = max(80, (max_tokens * 4) // max(1, len(recent)))
        return "\n".join(f"{r}: {t[:per_turn]}" for r, t in recent)

    lines: list[str] = []
    used = 0
    for r, t in reversed(older):  # newest of the old turns first, oldest dropped when out of budget
        line = f"- {r}: {t[:DIGEST_LINE_CHARS]}{'…' if len(t) > DIGEST_LINE_CHARS else ''}"
        cost = estimate_tokens(line)
        if used + cost > budget:
            break
        lines.append(line)
        used += cost
    lines.reverse()
    digest = "Ringkasan percakapan sebelumnya:\n" + "\n".join(lines) if lines else ""
    return "\n".join(x for x in (digest, "Percakapan terbaru:", recent_block) if x)
