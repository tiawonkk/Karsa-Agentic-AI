"""One-call LLM helpers shared by the automation modules. Every caller also has a deterministic fallback."""
from __future__ import annotations

import json
import re
from typing import Any, Callable

LLMFn = Callable[[str, str], str]


def default_llm(purpose: str = "chat") -> LLMFn:
    """(system, user) -> text through the model plan with failover. Raises LLMUnavailable with the exact reason."""

    def call(system: str, user: str) -> str:
        from langchain_core.messages import HumanMessage, SystemMessage

        from backend.core.llm_router import router

        return router.invoke_text(purpose, [SystemMessage(content=system), HumanMessage(content=user)], module_name=purpose)

    return call


def llm_available() -> bool:
    from backend.core.llm_router import router

    return bool(router.candidates("chat"))


def parse_json_loose(text: str) -> Any:
    """The JSON object or array inside a model answer (code fences and chatter around it are ignored)."""
    t = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", t, re.DOTALL)
    if fence:
        t = fence.group(1).strip()
    for opener, closer in (("{", "}"), ("[", "]")):
        a, b = t.find(opener), t.rfind(closer)
        if a != -1 and b > a:
            try:
                return json.loads(t[a : b + 1])
            except ValueError:
                continue
    raise ValueError("Jawaban model bukan JSON yang valid.")
