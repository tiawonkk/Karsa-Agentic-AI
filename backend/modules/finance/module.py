from __future__ import annotations

import re
import uuid
from typing import Any
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.tools import BaseTool
from langgraph.graph import StateGraph, START, END
from langgraph.graph.state import CompiledStateGraph

from backend.core.state import KarsaState, ProposedAction
from backend.modules.base_module import BaseKarsaModule, ModuleContext, ModuleManifest, registry
from backend.orchestrator.hitl_gate import check_and_request_approval, execute_approved
from backend.modules.finance.tools import (
    format_rupiah,
    parse_indonesian_nominal,
    classify_category_deterministic,
    extract_transaction_intent,
    record_transaction_in_db,
    get_budget_snapshot,
    evaluate_investment_readiness,
    update_monthly_capital_in_db,
    record_transaction_tool,
    get_budget_snapshot_tool,
    evaluate_investment_readiness_tool,
)


class FinanceModule(BaseKarsaModule):
    """Financial Intelligence specialist module for college students."""

    manifest = ModuleManifest(
        module_id="finance",
        display_name="Financial Intelligence",
        version="0.1.0",
        description="Kelola keuangan mahasiswa: catat pengeluaran cepat, klasifikasi 5 kategori, hitung Daily Safe Spend, dan evaluasi kesiapan investasi konservatif.",
        intent_patterns=[
            r"(?:beli|bayar|jajan|struk|pengeluaran|pemasukan|belanja|saldo|reksadana|deposito|bibit)",
            r"\b\d+[\.,]?\d*\s*(?:rb|k|jt|ribu|juta|rupiah)\b",
            r"(?:rp\.?\s*\d+)",
            r"(?:daily safe spend|safe to spend)",
            r"(?:modal bulanan|pagu bulanan|anggaran bulanan)",
        ],
        model_tier="tier1_utility",
        high_risk_actions=["set_monthly_capital"],
    )

    def get_tools(self) -> list[BaseTool]:
        return [
            record_transaction_tool,
            get_budget_snapshot_tool,
            evaluate_investment_readiness_tool,
        ]

    def build_graph(self, ctx: ModuleContext) -> CompiledStateGraph:
        workflow = StateGraph(KarsaState)

        def finance_dispatch_node(state: KarsaState) -> dict[str, Any]:
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

            # 1. High-Risk Capital Modification Intent
            if any(kw in cleaned for kw in ["ubah modal", "ganti modal", "set modal", "pagu bulanan", "ubah pagu", "set budget"]):
                new_nominal = parse_indonesian_nominal(cleaned)
                if new_nominal and new_nominal > 0:
                    current_capital = get_budget_snapshot()["total_capital_idr"]
                    prop_action = ProposedAction(
                        action_id=f"act_cap_{uuid.uuid4().hex[:8]}",  # replaced by a stable id inside the gate
                        module="finance",
                        action_name="set_monthly_capital",
                        args={"new_total_capital_idr": new_nominal},
                        editable_args=["new_total_capital_idr"],
                        preview=f"Ubah total modal bulanan menjadi {format_rupiah(new_nominal)}",
                        reason=f"Kamu meminta mengubah pagu bulanan ({last_text.strip()[:80]})",
                        impact=f"Pagu {format_rupiah(current_capital)} → {format_rupiah(new_nominal)}; "
                        f"alokasi 5 kategori dihitung ulang secara proporsional.",
                        fingerprint=f"capital:{current_capital}",
                    )
                    thread_id = ctx.session_thread_id or state.get("session_thread_id") or "default_thread"
                    decision = check_and_request_approval(
                        action=prop_action,
                        session_thread_id=thread_id,
                        module_high_risk_actions=self.manifest.high_risk_actions,
                        nonce=str(len(messages)),
                    )
                    if decision and decision.get("decision") in ("approve", "edit"):
                        final_nominal = int(decision["final_args"]["new_total_capital_idr"])
                        outcome = execute_approved(
                            decision["action_id"],
                            lambda: update_monthly_capital_in_db(final_nominal),
                            current_fingerprint=f"capital:{get_budget_snapshot()['total_capital_idr']}",
                        )
                        if outcome["ran"]:
                            content = (
                                f"✅ Pagu anggaran bulanan berhasil diperbarui menjadi **{format_rupiah(final_nominal)}**.\n"
                                f"Alokasi baru telah disesuaikan secara proporsional untuk 5 kategori."
                            )
                        elif outcome["reason"] == "stale":
                            content = "⚠️ Persetujuan kedaluwarsa: pagu berubah sejak permintaan dibuat, jadi tidak dijalankan. Minta ulang jika masih perlu."
                        elif outcome["reason"] == "already_executed":
                            content = "ℹ️ Perubahan pagu ini sudah dijalankan sebelumnya; tidak dijalankan dua kali."
                        else:
                            content = f"⚠️ Perubahan pagu gagal dijalankan ({outcome['error'] or outcome['reason']}). Bisa dicoba ulang dari tab Approvals."
                        return {"messages": [AIMessage(content=content)]}
                    reason = (decision or {}).get("reason")
                    note = " (waktu persetujuan habis)" if reason == "timeout" else ""
                    return {
                        "messages": [
                            AIMessage(content=f"❌ Perubahan pagu anggaran bulanan dibatalkan{note}.")
                        ]
                    }

            # 2. Investment Readiness Intent
            if any(kw in cleaned for kw in ["reksadana", "investasi", "deposito", "bibit", "bareksa", "rdpu", "boleh invest"]):
                eval_res = evaluate_investment_readiness()
                return {"messages": [AIMessage(content=eval_res["recommendation"])]}

            # 3. Budget / Daily Safe Spend Snapshot Intent
            budget_keywords = [
                "daily safe spend", "safe to spend", "saldo", "sisa uang",
                "sisa anggaran", "cek budget", "rekap pengeluaran", "laporan keuangan",
                "uang saya", "uang ku", "uangku", "cek keuangan", "keuangan saya",
                "keuangan", "duit", "dompet", "kas", "sisa saldo", "uang"
            ]
            if any(kw in cleaned for kw in budget_keywords):
                snap = get_budget_snapshot()
                cat = snap["categories"]
                content = (
                    f"Total modalmu bulan ini {format_rupiah(snap['total_capital_idr'])}, "
                    f"sudah terpakai {format_rupiah(snap['total_spent_idr'])}, "
                    f"dan sisa belanja amanmu hari ini adalah **{format_rupiah(snap['daily_safe_spend_idr'])}/hari**.\n\n"
                    f"📊 **Ringkasan Anggaran ({snap['period']})**\n"
                    f"💰 **Pagu Bulanan:** {format_rupiah(snap['total_capital_idr'])}\n"
                    f"💸 **Total Terpakai:** {format_rupiah(snap['total_spent_idr'])}\n"
                    f"🏦 **Sisa Saldo Kas:** {format_rupiah(snap['total_remaining_idr'])}\n\n"
                    f"**Alokasi 5 Kategori:**\n"
                    f"🍽️ Makanan: Sisa **{format_rupiah(cat['makanan']['remaining'])}** (dari {format_rupiah(cat['makanan']['allocated'])})\n"
                    f"📚 Pelajaran: Sisa **{format_rupiah(cat['pelajaran']['remaining'])}** (dari {format_rupiah(cat['pelajaran']['allocated'])})\n"
                    f"🏥 Kesehatan: Sisa **{format_rupiah(cat['kesehatan']['remaining'])}** (dari {format_rupiah(cat['kesehatan']['allocated'])})\n"
                    f"📈 Investasi: Sisa **{format_rupiah(cat['investment']['remaining'])}** (dari {format_rupiah(cat['investment']['allocated'])})\n"
                    f"☕ Kesenangan: Sisa **{format_rupiah(cat['kesenangan']['remaining'])}** (dari {format_rupiah(cat['kesenangan']['allocated'])})\n\n"
                    f"🛡️ **Daily Safe Spend Hari Ini:** **{format_rupiah(snap['daily_safe_spend_idr'])} / hari** "
                    f"({snap['remaining_days']} hari tersisa bulan ini)."
                )
                return {"messages": [AIMessage(content=content)]}

            # 4. Deterministic Expense Entry Intent (0 Tokens Fast-Path)
            nominal = parse_indonesian_nominal(cleaned)
            is_expense_phrase = any(w in cleaned for w in [
                "beli", "bayar", "jajan", "pesan", "habis", "ongkir", "makan",
                "minum", "seblak", "kopi", "fotokopi", "print", "obat", "kafe"
            ]) or (nominal is not None and len(cleaned.split()) <= 6)

            if nominal and nominal > 0 and is_expense_phrase:
                _, category, desc = extract_transaction_intent(last_text)
                target_cat = category or "makanan"
                record_transaction_in_db(
                    amount_idr=nominal,
                    category=target_cat,
                    description=desc,
                    source="text",
                    used_llm=0,
                )
                snap = get_budget_snapshot()
                cat_info = snap["categories"].get(target_cat, {})
                rem_cat = cat_info.get("remaining", 0)

                resp = (
                    f"✅ Pengeluaran dicatat: **{format_rupiah(nominal)}** untuk **{target_cat}** ({desc}).\n"
                    f"📊 Sisa alokasi {target_cat}: {format_rupiah(rem_cat)}.\n"
                    f"💡 *Daily Safe Spend* kamu hari ini: **{format_rupiah(snap['daily_safe_spend_idr'])} / hari** "
                    f"({snap['remaining_days']} hari tersisa bulan ini)."
                )
                return {"messages": [AIMessage(content=resp)]}

            # 5. Conversational LLM Fallback (Empathetic Student Financial Mentor)
            try:
                system_prompt = (
                    "Kamu adalah Karsa, asisten AI pribadi mahasiswa yang ramah, santai, hemat token, dan solutif. "
                    "Kamu sedang bertugas sebagai mentor keuangan cerdas. "
                    "Karaktermu: hangat, menyemangati, realistis dengan kondisi dompet mahasiswa kos/kampus, "
                    "selalu menghargai pentingnya Daily Safe Spend dan 5 kategori pengeluaran (makanan, pelajaran, kesehatan, investment, kesenangan). "
                    "Gunakan bahasa Indonesia santai namun sopan."
                )
                model = ctx.router.get_model(
                    purpose="finance",
                    module_name="finance",
                    session_thread_id=ctx.session_thread_id,
                )
                model_with_tools = model.bind_tools(self.get_tools())
                llm_response = model_with_tools.invoke([
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=last_text),
                ])
                return {"messages": [llm_response]}
            except Exception as e:
                # Fallback graceful reply
                return {
                    "messages": [
                        AIMessage(
                            content=f"Saya mengerti kebutuhan keuanganmu. Saat ini sistem mencatat transaksi harianmu dengan aman. Ada pengeluaran atau saldo yang ingin dicek?"
                        )
                    ]
                }

        workflow.add_node("finance_dispatch", finance_dispatch_node)
        workflow.add_edge(START, "finance_dispatch")
        workflow.add_edge("finance_dispatch", END)

        return workflow.compile()


# Instantiate and auto-register finance module into global registry
finance_module = FinanceModule()
try:
    registry.register(finance_module)
except ValueError:
    pass
