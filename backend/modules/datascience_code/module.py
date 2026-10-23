from __future__ import annotations

import re
import sys
import uuid
from pathlib import Path
from typing import Any
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.tools import BaseTool
from langgraph.graph import StateGraph, START, END
from langgraph.graph.state import CompiledStateGraph

from backend.core.state import KarsaState, ProposedAction
from backend.modules.base_module import BaseKarsaModule, ModuleContext, ModuleManifest, registry
from backend.orchestrator.hitl_gate import check_and_request_approval
from backend.modules.datascience_code.tools import (
    profile_dataset_locally,
    clean_dataset_locally,
    execute_sandboxed_command,
    profile_dataset_tool,
    clean_dataset_tool,
)


class DataScienceCodeModule(BaseKarsaModule):
    """Specialist module for student local dataset profiling, data sanitation, and coding assistance."""

    manifest = ModuleManifest(
        module_id="datascience_code",
        display_name="Data Science & Coding Assistant",
        version="0.1.0",
        description="Sanitasi & profiling dataset lokal (Pandas 0-token), eksekusi sandbox aman, dan integrasi coding bridge.",
        intent_patterns=[
            r"(?:dataset|csv|xlsx|excel|dataframe|pandas|data science|profiling data|sanitasi data)",
            r"(?:debug|refactor|unit test|mcp|patch kode|linting)",
        ],
        model_tier="tier2_reasoning",
        high_risk_actions=["run_shell_command", "apply_code_patch"],
    )

    def get_tools(self) -> list[BaseTool]:
        return [profile_dataset_tool, clean_dataset_tool]

    def build_graph(self, ctx: ModuleContext) -> CompiledStateGraph:
        workflow = StateGraph(KarsaState)

        def ds_dispatch_node(state: KarsaState) -> dict[str, Any]:
            messages = state.get("messages", [])
            last_text = ""
            for msg in reversed(messages):
                if isinstance(msg, HumanMessage):
                    last_text = msg.content if isinstance(msg.content, str) else str(msg.content)
                    break
                elif isinstance(msg, dict) and msg.get("role") == "user":
                    last_text = str(msg.get("content", ""))
                    break

            cleaned = last_text.lower().strip()

            # 1. Clean Dataset Fast-Path Intent
            if any(kw in cleaned for kw in ["bersihkan dataset", "clean dataset", "sanitasi dataset", "hapus duplikat"]):
                path_match = re.search(r"['\"]?([a-zA-Z0-9_:\-\.\/\\]+?\.(?:csv|xlsx|xls))['\"]?", last_text, re.IGNORECASE)
                target_path = None
                if path_match:
                    target_path = Path(path_match.group(1)).expanduser().resolve()
                elif state.get("current_dataset_ref"):
                    target_path = Path(state["current_dataset_ref"]).resolve()

                if target_path and target_path.exists():
                    try:
                        res = clean_dataset_locally(target_path)
                        resp = (
                            f"🧹 **Dataset Berhasil Dibersihkan di Sandbox Pandas (0 Token LLM)!**\n\n"
                            f"📁 **File Asli:** `{res['original_file']}`\n"
                            f"✨ **File Bersih:** `{res['cleaned_file']}`\n\n"
                            f"**Statistik Pembersihan:**\n"
                            f"• Baris Awal: {res['initial_rows']:,} → Baris Akhir: {res['final_rows']:,}\n"
                            f"• Duplikasi Terhapus: **{res['duplicates_removed']:,} baris**\n"
                            f"• Missing Values Diimputasi: **{res['initial_missing_cells']:,} sel**\n"
                            f"💡 *File hasil sanitasi siap digunakan untuk pelatihan model Machine Learning!*"
                        )
                        return {"messages": [AIMessage(content=resp)]}
                    except Exception as e:
                        return {"messages": [AIMessage(content=f"⚠️ Gagal membersihkan dataset: {str(e)}")]}

            # 2. Profile / Inspect Dataset Fast-Path Intent (0 LLM Tokens)
            if any(kw in cleaned for kw in ["profiling", "inspeksi dataset", "analisis dataset", "cek dataset", "profil dataset"]) or (
                ("dataset" in cleaned or "csv" in cleaned or "xlsx" in cleaned) and ("cek" in cleaned or "info" in cleaned or "lihat" in cleaned)
            ):
                path_match = re.search(r"['\"]?([a-zA-Z0-9_:\-\.\/\\]+?\.(?:csv|xlsx|xls))['\"]?", last_text, re.IGNORECASE)
                target_path = None
                if path_match:
                    target_path = Path(path_match.group(1)).expanduser().resolve()
                elif state.get("current_dataset_ref"):
                    target_path = Path(state["current_dataset_ref"]).resolve()

                if target_path and target_path.exists():
                    try:
                        p = profile_dataset_locally(target_path)
                        cols_snip = ", ".join(p["columns"][:8]) + ("..." if len(p["columns"]) > 8 else "")
                        resp = (
                            f"📊 **Hasil Profiling Dataset Lokal (Pandas Sandbox — 0 Token LLM):**\n\n"
                            f"📁 **File:** `{p['file_name']}` ({p['file_size_bytes'] / 1024:.1f} KB)\n"
                            f"📐 **Dimensi:** **{p['rows']:,} baris × {p['columns_count']} kolom**\n"
                            f"📋 **Kolom:** {cols_snip}\n"
                            f"⚠️ **Missing Values:** **{p['total_missing_cells']:,} sel** kosong\n"
                            f"👥 **Duplikasi:** **{p['duplicate_rows']:,} baris** duplikat\n\n"
                            f"💡 *Data mentah diproses 100% di laptopmu tanpa pernah dikirim ke LLM.*"
                        )
                        return {"messages": [AIMessage(content=resp)]}
                    except Exception as e:
                        return {"messages": [AIMessage(content=f"⚠️ Gagal menganalisis dataset: {str(e)}")]}

            # 3. Terminal Test Sandbox Intent
            if any(kw in cleaned for kw in ["jalankan pytest", "run pytest", "jalankan test", "test kode"]):
                res = execute_sandboxed_command([sys.executable, "-m", "pytest", "backend/tests/test_state.py", "-q"])
                out = res["stdout"] or res["stderr"]
                status_icon = "✅" if res["returncode"] == 0 else "❌"
                resp = (
                    f"{status_icon} **Hasil Eksekusi Sandbox Terminal:**\n\n"
                    f"```text\n{out}\n```\n"
                    f"Return Code: {res['returncode']}"
                )
                return {"messages": [AIMessage(content=resp)]}

            # 4. LLM Fallback (Senior AI Engineer / Data Science Mentor)
            try:
                system_prompt = (
                    "Kamu adalah Karsa, Senior Data Scientist dan Lead Software Engineer pribadi mahasiswa. "
                    "Bantu mahasiswa memahami algoritma, optimasi Pandas, debugging kode Python, "
                    "dan arsitektur software bersih (Clean Architecture). "
                    "Berikan contoh kode yang efisien, berikan penjelasan baris per baris, dan gunakan bahasa Indonesia yang ramah."
                )
                model = ctx.router.get_model(
                    tier="tier2_reasoning",
                    module_name="datascience_code",
                    session_thread_id=ctx.session_thread_id,
                )
                model_with_tools = model.bind_tools(self.get_tools())
                llm_response = model_with_tools.invoke([
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=last_text),
                ])
                return {"messages": [llm_response]}
            except Exception:
                return {
                    "messages": [
                        AIMessage(
                            content="Saya siap membantumu melakukan profiling dataset (.csv/.xlsx) di sandbox lokal atau mendiskusikan implementasi kode dan debugging. Ada dataset atau script yang ingin dianalisis?"
                        )
                    ]
                }

        workflow.add_node("ds_dispatch", ds_dispatch_node)
        workflow.add_edge(START, "ds_dispatch")
        workflow.add_edge("ds_dispatch", END)

        return workflow.compile()


# Instantiate and auto-register into global registry
datascience_code_module = DataScienceCodeModule()
try:
    registry.register(datascience_code_module)
except ValueError:
    pass
