from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable, Literal

from langchain_core.messages import HumanMessage, SystemMessage

from backend.core.config import settings

CouncilMode = Literal["auto", "solo", "relay"]
ModelFactory = Callable[[str, str, float], Any]

# Heuristic (0-token) signals that a request needs deeper reasoning than a small local model.
REASONING_HINTS = re.compile(
    r"(?:kenapa|mengapa|jelaskan|buktikan|analisis|bandingkan|strategi|rancang|"
    r"debug|optimasi|metodologi|limitasi|hitung|turunkan|rumus|why|prove|compare|design)",
    re.IGNORECASE,
)
LONG_PROMPT_CHARS = 600


@dataclass(frozen=True)
class CouncilMember:
    key: str            # worker | reasoner | synth
    display_name: str   # shown in UI
    provider: str
    model: str
    temperature: float
    system_prompt: str


def build_members() -> dict[str, CouncilMember]:
    """Council roster. Models are configurable through KARSA_COUNCIL_* settings."""
    return {
        "worker": CouncilMember(
            key="worker",
            display_name="Hermes 3",
            provider="ollama",
            model=settings.council_worker_model,
            temperature=0.3,
            system_prompt=(
                "Kamu Hermes, pelaksana cepat. Pecah permintaan mahasiswa menjadi poin ringkas "
                "dan tulis draf jawaban pertama yang singkat, runtut, berbahasa Indonesia."
            ),
        ),
        "reasoner": CouncilMember(
            key="reasoner",
            display_name="DeepSeek-R1",
            provider=settings.council_reasoner_provider,
            model=settings.council_reasoner_model,
            temperature=0.2,
            system_prompt=(
                "Kamu DeepSeek, penalar kritis. Periksa draf: cari kesalahan logika, hitungan, "
                "atau asumsi lemah. Balas HANYA daftar koreksi singkat. Jika draf sudah benar, "
                "tulis 'DRAF SUDAH BENAR'."
            ),
        ),
        "synth": CouncilMember(
            key="synth",
            display_name="Gemini",
            provider="gemini",
            model=settings.council_synth_model,
            temperature=0.3,
            system_prompt=(
                "Kamu Gemini, penulis akhir untuk mahasiswa Indonesia. Gabungkan draf dan "
                "koreksi menjadi jawaban final yang akurat, lugas, dan tanpa basa-basi. "
                "Jangan menyebut proses internal."
            ),
        ),
    }


def needs_deep_reasoning(prompt: str) -> bool:
    return len(prompt) > LONG_PROMPT_CHARS or bool(REASONING_HINTS.search(prompt))


def _clean(text: Any) -> str:
    """Normalize provider output: flatten content blocks and strip DeepSeek <think> traces."""
    if isinstance(text, list):
        text = "".join(
            part.get("text", "") if isinstance(part, dict) else str(part) for part in text
        )
    text = str(text)
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def _default_factory(provider: str, model: str, temperature: float) -> Any:
    from backend.core.llm_router import router
    return router.create_chat_model(provider, model, temperature)


def _call(member: CouncilMember, user_text: str, factory: ModelFactory) -> str:
    chat = factory(member.provider, member.model, member.temperature)
    reply = chat.invoke([
        SystemMessage(content=member.system_prompt),
        HumanMessage(content=user_text),
    ])
    return _clean(getattr(reply, "content", reply))


def _step(member: CouncilMember, user_text: str, factory: ModelFactory) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "role": member.key,
        "model": f"{member.display_name} ({member.model})",
        "status": "ok",
        "output": "",
    }
    if member.provider == "ollama" and factory is _default_factory:
        try:
            import httpx
            r = httpx.get(f"{settings.ollama_base_url}/api/tags", timeout=0.6)
            if r.status_code != 200:
                entry.update(status="error", error="Ollama offline")
                return entry
        except Exception:
            entry.update(status="error", error="Ollama offline")
            return entry

    try:
        entry["output"] = _call(member, user_text, factory)
        if not entry["output"]:
            entry.update(status="error", error="Respons kosong")
    except Exception as exc:  # network down, missing key, model not pulled, etc.
        entry.update(status="error", error=f"{type(exc).__name__}: {exc}"[:300])
    return entry


def run_council(
    prompt: str,
    mode: CouncilMode = "auto",
    context: str = "",
    model_factory: ModelFactory | None = None,
) -> dict[str, Any]:
    """Run models in relay: Hermes draft -> DeepSeek critique -> Gemini final.

    - auto : relay only when the request looks complex, otherwise Gemini answers alone (cheap).
    - solo : Gemini only.
    - relay: always run the full chain.
    Failed members are skipped; the answer is the output of the last member that succeeded.
    """
    factory = model_factory or _default_factory
    members = build_members()
    effective = mode
    if mode == "auto":
        effective = "relay" if needs_deep_reasoning(prompt) else "solo"

    base = f"{context}\n\n{prompt}".strip() if context else prompt
    steps: list[dict[str, Any]] = []

    if effective == "solo":
        steps.append(_step(members["synth"], base, factory))
    else:
        draft = _step(members["worker"], base, factory)
        steps.append(draft)

        critique_input = base
        if draft["status"] == "ok":
            critique_input = f"PERTANYAAN:\n{base}\n\nDRAF:\n{draft['output']}"
        critique = _step(members["reasoner"], critique_input, factory)
        steps.append(critique)

        parts = [f"PERTANYAAN:\n{base}"]
        if draft["status"] == "ok":
            parts.append(f"DRAF:\n{draft['output']}")
        if critique["status"] == "ok" and "DRAF SUDAH BENAR" not in critique["output"].upper():
            parts.append(f"KOREKSI:\n{critique['output']}")
        steps.append(_step(members["synth"], "\n\n".join(parts), factory))

    final = next((s for s in reversed(steps) if s["status"] == "ok"), None)
    return {
        "mode": effective,
        "answer": final["output"] if final else "",
        "answered_by": final["model"] if final else None,
        "steps": steps,
        "ok": final is not None,
    }
