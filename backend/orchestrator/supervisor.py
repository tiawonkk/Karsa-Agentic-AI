from __future__ import annotations

import re
from typing import Any
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from backend.core.context import compact_history
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from backend.core.config import settings
from backend.core.council import run_council
from backend.core.database import get_sqlite_checkpointer
from backend.core.llm_router import router
from backend.core.state import KarsaState, RouteDecision
from backend.modules.base_module import ModuleContext, registry
import backend.modules  # Ensure all plugins are registered

# Core Regex Patterns for Tier-A Deterministic Matcher (0-token)
BUILTIN_INTENT_PATTERNS: dict[str, list[str]] = {
    "finance": [
        r"(?:beli|bayar|jajan|struk|pengeluaran|pemasukan|belanja|saldo|reksadana|deposito|bibit)",
        r"(?:uang|duit|keuangan|anggaran|dana|dompet|kas)",
        r"(?:uang\s*(?:saya|ku|skrg|sekarang|berapa)|cek\s*(?:keuangan|saldo|budget|duit|uang)|berapa\s*(?:uang|saldo|duit|kas))",
        r"\b\d+[\.,]?\d*\s*(?:rb|k|jt|ribu|juta|rupiah)\b",
        r"(?:rp\.?\s*\d+)",
        r"(?:daily safe spend|safe to spend)",
    ],
    "study_daily": [
        r"(?:tugas|pr|kuliah|matkul|deadline|tenggat|ujian|uts|uas|eisenhower|prioritas)",
        r"(?:rangkum|ringkas|slide|materi|diktat|silabus|kursus|roadmap belajar)",
        r"\b(?:roadmap|belajar)\b",
    ],
    "research": [
        r"(?:arxiv|semantic scholar|crossref|jurnal ilmiah|tinjauan pustaka)",
        r"(?:metodologi penelitian|limitasi riset|state of the art)",
        r"\bpaper\b",
    ],
    "writer": [
        r"(?:imrad|karya ilmiah|skripsi|makalah|draft paper)",
        r"\b(?:docx|dokumen word|format word|daftar pustaka|kompilasi docx)\b",
    ],
    "datascience_code": [
        r"(?:dataset|csv|xlsx|excel|dataframe|pandas|data science|profiling data|sanitasi data)",
        r"(?:debug|refactor|unit test|mcp|patch kode|linting)",
        r"\b(?:bug|error|traceback|script|python|kode|coding)\b",
    ],
}


def match_deterministic_intent(user_text: str, enabled_module_ids: list[str]) -> str | None:
    """Evaluate regex patterns to classify user intent deterministically (0 LLM tokens).
    
    Returns the module_id if one module clearly matches with highest score, else None.
    """
    cleaned = user_text.lower().strip()
    scores: dict[str, int] = {}

    for mod_id in enabled_module_ids:
        patterns = list(BUILTIN_INTENT_PATTERNS.get(mod_id, []))
        
        # Check module's own declared patterns from manifest
        mod_instance = registry.get_module(mod_id)
        if mod_instance:
            patterns.extend(mod_instance.manifest.intent_patterns)

        total_hits = 0
        for pat in patterns:
            hits = len(re.findall(pat, cleaned, re.IGNORECASE))
            total_hits += hits
        
        if total_hits > 0:
            scores[mod_id] = total_hits

    if not scores:
        return None

    if len(scores) == 1:
        return next(iter(scores.keys()))
    
    # If multiple matched, pick the winner if it has strictly more hits
    sorted_scores = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    if sorted_scores[0][1] > sorted_scores[1][1]:
        return sorted_scores[0][0]

    return None


def supervisor_triage_node(state: KarsaState) -> dict[str, Any]:
    """Triage node: Decides which specialist module handles the request."""
    messages = state.get("messages", [])
    if not messages:
        return {"active_module": None}

    last_user_msg = ""
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage) or getattr(msg, "type", "") == "human":
            last_user_msg = str(msg.content)
            break

    if not last_user_msg:
        return {"active_module": None}

    enabled_modules = registry.get_enabled_module_ids()
    if not enabled_modules:
        return {"active_module": None}

    # 0. Tier 0: Directive Command Match (@Money, @Todo, @Search, @Write, @Data, @Code, @Screen)
    from backend.orchestrator.directive_parser import parse_directive
    directive = parse_directive(last_user_msg)
    if directive.is_directive and directive.target_module in enabled_modules:
        return {"active_module": directive.target_module}

    # 1. Tier A: Deterministic Regex Match (0 Tokens)
    matched_id = match_deterministic_intent(last_user_msg, enabled_modules)
    if matched_id:
        return {"active_module": matched_id}

    # 2. Tier B: Fast LLM Triage (Tier-1 Model)
    modules_desc = []
    for mod_id in enabled_modules:
        m = registry.get_module(mod_id)
        desc = m.manifest.description if m else mod_id
        modules_desc.append(f"- {mod_id}: {desc}")

    system_prompt = (
        "You are the Supervisor Triage Node for Karsa Agentic AI.\n"
        "Your sole task is to classify user request into ONE specialist module.\n"
        "Available modules:\n" + "\n".join(modules_desc) + "\n\n"
        "Respond strictly with the single most relevant module_id."
    )

    try:
        chat_model = router.get_chat_model(
            tier="tier1_utility",
            module_name="supervisor",
            session_thread_id=state.get("session_thread_id"),
        )
        structured_llm = chat_model.with_structured_output(RouteDecision)
        res: RouteDecision = structured_llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=last_user_msg),
        ])
        if res.module in enabled_modules:
            return {"active_module": res.module}
    except Exception:
        pass

    # If no specialist module matched, return None for general companion mode
    return {"active_module": None}


def _general_llm_answer(prompt: str, history: str = "") -> str:
    """Answer a free-form question via the Hermes/DeepSeek/Gemini council.

    Returns the AI answer or transparent error diagnostic instead of falling back to canned greetings.
    """
    if not prompt:
        return "Halo! Ada yang bisa kubantu? Ketik pertanyaan atau tugasmu."
    effective_key = settings.gemini_api_key
    if not effective_key:
        from backend.core.database import get_system_setting
        effective_key = get_system_setting("api_key.gemini", "")
        if effective_key:
            settings.gemini_api_key = effective_key

    if not effective_key and settings.hardware_override != "turbo_gpu":
        return (
            "⚠️ Kunci API Gemini belum dipasang di Settings.\n"
            "Silakan tambahkan `GEMINI_API_KEY` di menu Settings atau file `.env` untuk mengaktifkan obrolan AI."
        )
    try:
        result = run_council(prompt, mode="auto", context=history)
        if result.get("ok") and result.get("answer"):
            return result["answer"]
        err_msg = result.get("error", "Model tidak merespons.")
        return f"⚠️ Gagal memanggil AI: {err_msg}\nSilakan periksa koneksi internet atau kunci API di Settings."
    except Exception as e:
        return f"⚠️ Terjadi kesalahan saat memanggil AI: {str(e)}"


def subagent_dispatch_node(state: KarsaState) -> dict[str, Any]:
    """Execute specialist module in an isolated context and return only last_message summary."""
    active_module_id = state.get("active_module")
    if not active_module_id:
        # Check last user query for capability inquiry or greeting
        last_user = ""
        last_user_raw = ""
        for m in reversed(state.get("messages", [])):
            if isinstance(m, HumanMessage) or getattr(m, "type", "") == "human":
                last_user_raw = str(m.content).strip()
                last_user = last_user_raw.lower()
                break

        if any(w in last_user for w in ["bisa apa", "apa yang bisa", "apa yang kamu", "apa yang sekarang", "fitur", "kemampuan", "menu", "bantuan", "help"]):
            response_text = (
                "Hai! Aku **Karsa**, Desktop Island Companion pribadimu! ✨\n\n"
                "Ini 5 keahlian utama yang bisa langsung kamu gunakan:\n"
                "1. 💰 **Financial Intelligence**: Catat pengeluaran natural (contoh: *\"makan siang ayam 20rb\"*), pantau sisa saldo, dan hitung *Daily Safe Spend*.\n"
                "2. 📚 **Daily Life & Study**: Manajemen tugas otomatis dengan *Eisenhower Matrix* (contoh: *\"tugas fisika deadline besok\"*) & rangkum materi kuliah (`.pdf`/`.docx`).\n"
                "3. 🔬 **Academic Research**: Cari paper jurnal di arXiv & Crossref serta ekstrak otomatis 5 parameter riset kunci.\n"
                "4. 📝 **Scientific Writer**: Susun draf karya ilmiah berformat IMRaD dan kompilasi langsung ke file Microsoft Word (`.docx`).\n"
                "5. 📊 **Data Science & Coding**: Profiling dataset `.csv`/`.xlsx` secara lokal di sandbox tanpa membuang token LLM.\n"
                "6. 🎨 **Wardrobe & Custom Mascot**: Buka menu Wardrobe di Notch untuk gambar aksesoris sendiri di kepalaku!\n\n"
                "Mau mulai dari mana sekarang? 😊"
            )
        elif re.fullmatch(
            r"(?:\W*(?:sup|yo|halo|hai|hei|pagi|siang|sore|malam|selamat|hello|hi|karsa|apa|kabar)\W*)+",
            last_user,
        ):
            response_text = (
                "Sup! Karsa di sini, siap menemani produktivitasmu hari ini! ✨\n\n"
                "Ada yang bisa kubantu? Kamu bisa langsung ketik pengeluaran (*\"kopi 15rb\"*), tugas kuliah, atau minta draf paper riset!"
            )
        else:
            # earlier turns (without the question itself), compacted once they pass ~3000 tokens
            earlier = state.get("messages", [])[:-1]
            response_text = _general_llm_answer(last_user_raw, compact_history(earlier))

        return {"messages": [AIMessage(content=response_text)]}

    mod = registry.get_module(active_module_id)
    if not mod:
        return {
            "messages": [AIMessage(content=f"Modul '{active_module_id}' belum siap atau tidak terpasang.")]
        }

    # Deterministic directive execution check (0-token instant return)
    from backend.orchestrator.directive_parser import parse_directive
    last_user_txt = ""
    for m in reversed(state.get("messages", [])):
        if isinstance(m, HumanMessage) or getattr(m, "type", "") == "human":
            last_user_txt = str(m.content).strip()
            break
    if last_user_txt:
        d = parse_directive(last_user_txt)
        if d.is_directive and d.execution_result:
            return {"messages": [AIMessage(content=d.execution_result)]}

    # Build sub-graph in isolated scope
    ctx = ModuleContext(
        llm_router=router,
        hardware_mode=state.get("hardware_mode", "eco_cpu"),
        session_thread_id=state.get("session_thread_id"),
    )
    subgraph = mod.build_graph(ctx)

    # Invoke sub-graph
    result_state = subgraph.invoke(dict(state))

    # Context Isolation: Only extract the final assistant message (output_mode="last_message")
    sub_messages = result_state.get("messages", [])
    if sub_messages:
        last_msg = sub_messages[-1]
        if isinstance(last_msg, AIMessage):
            return {"messages": [last_msg]}
        return {"messages": [AIMessage(content=str(last_msg.content))]}

    return {
        "messages": [AIMessage(content=f"Tugas modul '{mod.manifest.display_name}' selesai dieksekusi.")]
    }


def build_karsa_supervisor_graph(checkpointer: Any | None = None) -> CompiledStateGraph:
    """Construct and compile the primary LangGraph StateGraph with checkpointer."""
    workflow = StateGraph(KarsaState)

    workflow.add_node("supervisor_triage", supervisor_triage_node)
    workflow.add_node("subagent_dispatch", subagent_dispatch_node)

    workflow.add_edge(START, "supervisor_triage")
    workflow.add_edge("supervisor_triage", "subagent_dispatch")
    workflow.add_edge("subagent_dispatch", END)

    ckpt = checkpointer if checkpointer is not None else get_sqlite_checkpointer()
    return workflow.compile(checkpointer=ckpt)
