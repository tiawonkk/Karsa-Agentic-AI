from __future__ import annotations

import re
from typing import Any
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.tools import BaseTool
from langgraph.graph import StateGraph, START, END
from langgraph.graph.state import CompiledStateGraph

from backend.core.state import KarsaState
from backend.modules.base_module import BaseKarsaModule, ModuleContext, ModuleManifest, registry
from backend.modules.study_daily.tools import (
    parse_due_date_natural,
    add_task_in_db,
    list_tasks_from_db,
    complete_task_in_db,
    generate_skill_roadmap,
    add_task_tool,
    list_tasks_tool,
    complete_task_tool,
)


QUADRANT_LABELS = {
    "Q1_DO": "🔥 Q1: Kerjakan Segera (Do First - Mendesak & Penting)",
    "Q2_SCHEDULE": "📅 Q2: Jadwalkan (Schedule - Penting, Tidak Mendesak)",
    "Q3_DELEGATE": "👥 Q3: Delegasikan / Cepatkan (Delegate - Mendesak, Tidak Penting)",
    "Q4_ELIMINATE": "🗑️ Q4: Eliminasi (Eliminate - Tidak Mendesak & Tidak Penting)",
}


class StudyDailyModule(BaseKarsaModule):
    """Specialist module for student daily productivity, tasks, and coursework."""

    manifest = ModuleManifest(
        module_id="study_daily",
        display_name="Daily Life & Study",
        version="0.1.0",
        description="Pelacak tugas prioritas Eisenhower Matrix otomatis, perangkum materi kuliah, dan penyusun roadmap skill mingguan.",
        intent_patterns=[
            r"(?:tugas|pr|kuliah|matkul|deadline|tenggat|ujian|uts|uas|eisenhower|prioritas)",
            r"(?:rangkum|ringkas|slide|materi|diktat|silabus|kursus|roadmap belajar|skill roadmap)",
            r"(?:jadwal belajar|daftar tugas|list tugas)",
        ],
        model_tier="tier1_utility",
        high_risk_actions=[],
    )

    def get_tools(self) -> list[BaseTool]:
        return [add_task_tool, list_tasks_tool, complete_task_tool]

    def build_graph(self, ctx: ModuleContext) -> CompiledStateGraph:
        workflow = StateGraph(KarsaState)

        def study_dispatch_node(state: KarsaState) -> dict[str, Any]:
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

            # 1. Skill Roadmap Intent
            if any(kw in cleaned for kw in ["roadmap belajar", "skill roadmap", "kurikulum belajar", "rencana belajar"]):
                topic = "python_data_science"
                if "web" in cleaned or "react" in cleaned or "javascript" in cleaned:
                    topic = "web_development"
                elif "machine learning" in cleaned or "ml" in cleaned or "ai" in cleaned:
                    topic = "machine_learning"

                plan_res = generate_skill_roadmap(topic, register_as_tasks=True)
                plan = plan_res["roadmap"]
                weeks_text = []
                for w in plan["weeks"]:
                    weeks_text.append(
                        f"**Minggu {w['week']}: {w['title']}**\n"
                        f"• Target: {w['goal']}\n"
                        f"• Sumber: {', '.join(w['resources'])}"
                    )

                resp = (
                    f"🗺️ **{plan['title']}**\n\n"
                    + "\n\n".join(weeks_text)
                    + f"\n\n✅ *Semua {len(plan['weeks'])} milestone telah didaftarkan otomatis ke daftar tugasmu!*"
                )
                return {"messages": [AIMessage(content=resp)]}

            # 2. Complete Task Intent
            is_complete = ("selesai" in cleaned or "done" in cleaned) and any(w in cleaned for w in ["tugas", "task", "pr", "#"])
            if is_complete:
                num_match = re.search(r"\b(\d+)\b", cleaned)
                if num_match:
                    task_id = int(num_match.group(1))
                    try:
                        t = complete_task_in_db(task_id)
                        return {
                            "messages": [
                                AIMessage(
                                    content=f"🎉 Mantap! Tugas **#{t['id']} — {t['title']}** berhasil ditandai selesai."
                                )
                            ]
                        }
                    except Exception as e:
                        return {"messages": [AIMessage(content=f"⚠️ {str(e)}")]}

            # 3. Add Task Fast-Path (0 Tokens Intent)
            is_add_task = any(kw in cleaned for kw in ["tambah tugas", "ingatkan", "pr baru", "catat tugas", "tugas baru"]) or (
                ("tugas" in cleaned or "pr" in cleaned) and any(w in cleaned for w in ["deadline", "tenggat", "besok", "lusa", "hari lagi"]) and not any(w in cleaned for w in ["daftar", "list", "cek", "lihat"])
            )
            if is_add_task:
                # Clean title
                title = last_text.strip()
                title = re.sub(r"(?i)\b(?:tolong|ingatkan|tambah|jadwalkan|catat|tugas baru)\b", "", title)
                due_parsed = parse_due_date_natural(cleaned)
                
                # Extract course if in brackets or after 'matkul'
                course_match = re.search(r"(?:matkul|kuliah|pelajaran)\s+([a-zA-Z0-9\s]+?)(?:deadline|tenggat|besok|$)", cleaned)
                course = course_match.group(1).strip().title() if course_match else None

                t = add_task_in_db(
                    title=title if len(title) > 3 else "Tugas Kuliah",
                    course=course,
                    due_at=due_parsed,
                    is_important=1,
                )
                q_label = QUADRANT_LABELS.get(t.get("quadrant", "Q1_DO"), t.get("quadrant"))
                due_info = f"Deadline: **{t.get('due_at')}**" if t.get("due_at") else "Tanpa deadline spesifik"

                resp = (
                    f"✅ **Tugas Berhasil Ditambahkan ke Eisenhower Matrix!**\n"
                    f"📌 **#{t['id']} — {t['title']}**\n"
                    f"⏰ {due_info}\n"
                    f"🎯 Status Kuadran: {q_label}"
                )
                return {"messages": [AIMessage(content=resp)]}

            # 4. List Tasks / Eisenhower Matrix Query Intent
            if any(kw in cleaned for kw in [
                "daftar tugas", "list tugas", "cek tugas", "cek deadline", "lihat deadline", "lihat tugas",
                "eisenhower", "tugas hari ini", "jadwal tugas", "ada tugas apa", "semua tugas"
            ]):
                tasks = list_tasks_from_db(status="todo")
                if not tasks:
                    return {
                        "messages": [
                            AIMessage(
                                content="🎉 Tidak ada tugas tertunda saat ini! Eisenhower Matrix kamu bersih. Mau mulai pelajari skill baru?"
                            )
                        ]
                    }

                grouped: dict[str, list[dict]] = {
                    "Q1_DO": [],
                    "Q2_SCHEDULE": [],
                    "Q3_DELEGATE": [],
                    "Q4_ELIMINATE": [],
                }
                for t in tasks:
                    q = t.get("quadrant", "Q2_SCHEDULE")
                    grouped.setdefault(q, []).append(t)

                lines = ["📋 **Eisenhower Matrix — Tugas Kuliah & Harian:**\n"]
                for q_key, label in QUADRANT_LABELS.items():
                    q_tasks = grouped.get(q_key, [])
                    if q_tasks:
                        lines.append(f"**{label}**")
                        for t in q_tasks:
                            due = f" (Deadline: {t['due_at']})" if t.get("due_at") else ""
                            course = f" [{t['course']}]" if t.get("course") else ""
                            lines.append(f"  • `#{t['id']}` **{t['title']}**{course}{due}")
                        lines.append("")

                return {"messages": [AIMessage(content="\n".join(lines).strip())]}

            # 5. LLM Fallback (Study Coach & Summarizer)
            try:
                system_prompt = (
                    "Kamu adalah Karsa, pendamping belajar dan asisten pribadi mahasiswa yang suportif, cerdas, dan ringkas. "
                    "Kamu menguasai teknik belajar efektif (Feynman technique, Pomodoro, active recall, Eisenhower Matrix). "
                    "Berikan panduan yang praktis, aplikatif, dan menyemangati mahasiswa dalam bahasa Indonesia santai."
                )
                model = ctx.router.get_model(
                    purpose="study",
                    module_name="study_daily",
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
                            content="Saya siap membantumu mengelola tugas kuliah dan jadwal belajarmu. Ada tugas yang ingin ditambahkan atau dicek deadline-nya?"
                        )
                    ]
                }

        workflow.add_node("study_dispatch", study_dispatch_node)
        workflow.add_edge(START, "study_dispatch")
        workflow.add_edge("study_dispatch", END)

        return workflow.compile()


study_daily_module = StudyDailyModule()
try:
    registry.register(study_daily_module)
except ValueError:
    pass
