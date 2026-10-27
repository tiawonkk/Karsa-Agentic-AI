from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.tools import BaseTool
from langgraph.graph import StateGraph, START, END
from langgraph.graph.state import CompiledStateGraph

from backend.core.state import KarsaState, ProposedAction
from backend.modules.base_module import BaseKarsaModule, ModuleContext, ModuleManifest, registry
from backend.orchestrator.hitl_gate import check_and_request_approval, execute_approved, fingerprint_path
from backend.modules.research_writer.research_tools import (
    search_and_cache_papers,
    ResearchSearchError,
    extract_paper_parameters,
    search_papers_tool,
    extract_paper_parameters_tool,
)
from backend.modules.research_writer.writer_tools import (
    generate_imrad_template,
    compile_imrad_to_docx,
    generate_imrad_draft_tool,
    compile_docx_tool,
)


class ResearchModule(BaseKarsaModule):
    """Academic Research specialist module for paper discovery and parameter extraction."""

    manifest = ModuleManifest(
        module_id="research",
        display_name="Academic Research",
        version="0.1.0",
        description="Pencarian jurnal ilmiah terpadu (arXiv, Crossref) dan ekstraksi 5 parameter kunci paper.",
        intent_patterns=[
            r"(?:arxiv|semantic scholar|crossref|jurnal ilmiah|tinjauan pustaka)",
            r"(?:metodologi penelitian|limitasi riset|state of the art)",
            r"\bpaper\b",
        ],
        model_tier="tier3_reasoning",
        high_risk_actions=[],
    )

    def get_tools(self) -> list[BaseTool]:
        return [search_papers_tool, extract_paper_parameters_tool]

    def build_graph(self, ctx: ModuleContext) -> CompiledStateGraph:
        workflow = StateGraph(KarsaState)

        def research_dispatch_node(state: KarsaState) -> dict[str, Any]:
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

            # 1. Parameter Extraction Intent
            if any(kw in cleaned for kw in ["ekstrak parameter", "5 parameter", "limitasi paper", "metodologi paper"]):
                title = last_text.strip()
                title = re.sub(r"(?i)\b(?:ekstrak|parameter|paper|analisis)\b", "", title).strip()
                params = extract_paper_parameters(title if len(title) > 3 else "Paper Riset")
                resp = (
                    f"📑 **Ekstraksi 5 Parameter Kunci Riset:**\n"
                    f"📌 **Judul:** {params['title']}\n"
                    f"1. **Tahun Terbit:** {params['publication_year']}\n"
                    f"2. **Sumber Dataset:** {params['dataset_source']}\n"
                    f"3. **Metodologi Riset:** {params['methodology']}\n"
                    f"4. **Limitasi Riset:** {params['limitations']}\n"
                    f"5. **Hasil Evaluasi Metrik:** {params['evaluation_metrics']}"
                )
                return {"messages": [AIMessage(content=resp)]}

            # 2. Paper Search Fast-Path Intent
            is_search = any(kw in cleaned for kw in ["cari paper", "carikan paper", "jurnal tentang", "paper arxiv", "literatur tentang"])
            if is_search or ("arxiv" in cleaned or "crossref" in cleaned or "paper" in cleaned):
                query = last_text.strip()
                query = re.sub(r"(?i)\b(?:tolong|carikan|cari|paper|jurnal|ilmiah|tentang|arxiv|crossref)\b", "", query).strip(" ,.-")
                if not query:
                    query = "Agentic AI Systems"

                source = "crossref" if "crossref" in cleaned else "arxiv"
                try:
                    papers = search_and_cache_papers(query=query, source=source, max_results=3)
                except ResearchSearchError as e:
                    return {"messages": [AIMessage(content=f"⚠️ {e}\nPeriksa koneksi internet lalu coba lagi.")]}
                if not papers:
                    return {"messages": [AIMessage(content=f"Tidak ada paper yang cocok dengan '{query}'. Coba kata kunci bahasa Inggris yang lebih spesifik.")]}

                lines = [f"📚 **Hasil Pencarian Jurnal Ilmiah ({source.upper()}) — Topik: '{query}':**\n"]
                for idx, p in enumerate(papers, 1):
                    abstract_snip = (p.get("abstract") or "")[:200]
                    lines.append(
                        f"**{idx}. {p['title']}** ({p.get('publication_year', 2025)})\n"
                        f"   • Penulis: *{p.get('authors', 'Unknown')}*\n"
                        f"   • Link: {p.get('url', '-')}\n"
                        f"   • Ringkasan: {abstract_snip}..."
                    )
                lines.append("\n💡 *Semua metadata telah dicache di database lokal Karsa.*")
                return {"messages": [AIMessage(content="\n\n".join(lines))]}

            # 3. LLM Fallback (Research Assistant)
            try:
                system_prompt = (
                    "Kamu adalah Karsa, konsultan riset akademik dan literatur ilmiah mahasiswa. "
                    "Bantu mahasiswa menyusun state-of-the-art, merumuskan hipotesis, dan membedah metodologi paper "
                    "secara kritis, runut, dan objektif dalam bahasa Indonesia akademis yang mudah dipahami."
                )
                model = ctx.router.get_model(
                    purpose="research",
                    module_name="research",
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
                            content="Saya siap membantumu mencari paper di arXiv/Crossref atau mengekstrak metodologi dan limitasi riset. Ada topik yang ingin ditelusuri?"
                        )
                    ]
                }

        workflow.add_node("research_dispatch", research_dispatch_node)
        workflow.add_edge(START, "research_dispatch")
        workflow.add_edge("research_dispatch", END)

        return workflow.compile()


class WriterModule(BaseKarsaModule):
    """Scientific Writer specialist module for IMRaD drafts and .docx compilation."""

    manifest = ModuleManifest(
        module_id="writer",
        display_name="Scientific Writer",
        version="0.1.0",
        description="Penyusun draf karya ilmiah berstruktur IMRaD dan kompilator deterministik format Microsoft Word (.docx).",
        intent_patterns=[
            r"(?:imrad|karya ilmiah|skripsi|makalah|draft paper)",
            r"\b(?:docx|dokumen word|format word|daftar pustaka|kompilasi docx)\b",
        ],
        model_tier="tier3_reasoning",
        high_risk_actions=["compile_docx_overwrite"],
    )

    def get_tools(self) -> list[BaseTool]:
        return [generate_imrad_draft_tool, compile_docx_tool]

    def build_graph(self, ctx: ModuleContext) -> CompiledStateGraph:
        workflow = StateGraph(KarsaState)

        def writer_dispatch_node(state: KarsaState) -> dict[str, Any]:
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

            # 1. Deterministic DOCX Compilation Intent
            if any(kw in cleaned for kw in ["docx", "dokumen word", "format word", "kompilasi"]):
                # Extract topic
                topic = last_text.strip()
                topic = re.sub(r"(?i)\b(?:susun|buatkan|kompilasi|draf|draft|ke|file|format|docx|dokumen|word|paper|imrad)\b", "", topic).strip(" ,.-")
                if not topic or len(topic) < 3:
                    topic = "Riset Agentic AI Mahasiswa"

                clean_name = re.sub(r"[^\w\s-]", "", topic).strip().replace(" ", "_")
                filename = f"Paper_{clean_name}.docx"
                out_dir = ctx.settings.data_dir / "outputs"
                out_dir.mkdir(parents=True, exist_ok=True)
                out_path = out_dir / filename

                # If file exists, check HITL Gate for overwrite
                overwrite = False
                if out_path.exists():
                    prop_action = ProposedAction(
                        action_id=f"act_docx_{uuid.uuid4().hex[:8]}",  # replaced by a stable id inside the gate
                        module="writer",
                        action_name="compile_docx_overwrite",
                        target_path=str(out_path),
                        args={"output_filename": filename, "overwrite": True},
                        editable_args=["output_filename"],
                        preview=f"Menimpa dokumen Word yang sudah ada: {filename}",
                        reason="Dokumen dengan nama yang sama sudah ada di folder outputs.",
                        impact="Isi file lama diganti dengan draf IMRaD baru; versi lama tidak bisa dikembalikan.",
                    )
                    thread_id = ctx.session_thread_id or state.get("session_thread_id") or "default_thread"
                    decision = check_and_request_approval(
                        action=prop_action,
                        session_thread_id=thread_id,
                        module_high_risk_actions=self.manifest.high_risk_actions,
                        db_path=ctx.settings.master_db_path,
                        nonce=str(len(messages)),
                    )
                    if not decision or decision.get("decision") not in ("approve", "edit"):
                        return {
                            "messages": [
                                AIMessage(content=f"❌ Penulisan dokumen `{filename}` dibatalkan untuk mencegah penimpaan file yang tidak disengaja.")
                            ]
                        }
                    # Edit: the reviewer may have chosen another file name; that one is what gets written.
                    final_name = Path(str(decision["final_args"].get("output_filename") or filename)).name
                    if not final_name.lower().endswith(".docx"):
                        final_name += ".docx"
                    out_path = out_dir / final_name
                    filename = final_name
                    overwrite = out_path.exists()

                    imrad_data = generate_imrad_template(topic)
                    outcome = execute_approved(
                        decision["action_id"],
                        lambda: compile_imrad_to_docx(imrad_data, out_path, overwrite=overwrite),
                        current_fingerprint=fingerprint_path(Path(prop_action.target_path)),
                        db_path=ctx.settings.master_db_path,
                    )
                    if not outcome["ran"]:
                        why = {
                            "stale": "file berubah sejak permintaan dibuat",
                            "already_executed": "permintaan ini sudah dijalankan sebelumnya",
                        }.get(outcome["reason"], outcome["error"] or outcome["reason"])
                        return {"messages": [AIMessage(content=f"⚠️ Dokumen `{filename}` tidak ditulis: {why}.")]}
                    res = outcome["result"]
                else:
                    imrad_data = generate_imrad_template(topic)
                    res = compile_imrad_to_docx(imrad_data, out_path, overwrite=overwrite)
                resp = (
                    f"✅ **Dokumen Microsoft Word (.docx) Berhasil Dikompilasi Secara Deterministik (0 Token LLM)!**\n\n"
                    f"📄 **Nama File:** `{res['file_name']}`\n"
                    f"📍 **Lokasi File:** `{res['file_path']}`\n"
                    f"📊 **Ukuran File:** {res['size_bytes'] / 1024:.1f} KB\n\n"
                    f"✨ **Spesifikasi Dokumen:**\n"
                    f"• Struktur Lengkap IMRaD (*Introduction, Methods, Results, Discussion*)\n"
                    f"• Format Formal Akademik (Times New Roman, Heading 1–3, Spasi Teratur)\n"
                    f"• Tabel Grid Formal dengan Perbandingan Metrik Evaluasi\n"
                    f"• Sitasi Bernomor & Daftar Pustaka Standar"
                )
                return {"messages": [AIMessage(content=resp)]}

            # 2. IMRaD Draft Fast-Path Intent
            if any(kw in cleaned for kw in ["imrad", "draft paper", "karya ilmiah", "draf paper", "kerangka skripsi"]):
                topic = last_text.strip()
                topic = re.sub(r"(?i)\b(?:buatkan|susun|draf|draft|paper|imrad|tentang|karya|ilmiah)\b", "", topic).strip(" ,.-")
                if not topic:
                    topic = "Sistem Agentic AI Mahasiswa"

                draft = generate_imrad_template(topic)
                resp = (
                    f"📝 **Draf Naskah Ilmiah IMRaD — '{draft['title']}':**\n\n"
                    f"**1. ABSTRAK**\n{draft['abstract']}\n\n"
                    f"**2. PENDAHULUAN (INTRODUCTION)**\n{draft['introduction']}\n\n"
                    f"**3. METODOLOGI PENELITIAN (METHODS)**\n{draft['methods']}\n\n"
                    f"**4. HASIL DAN ANALISIS (RESULTS)**\n{draft['results']}\n\n"
                    f"**5. PEMBAHASAN DAN LIMITASI (DISCUSSION)**\n{draft['discussion']}\n\n"
                    f"💡 *Ketik 'kompilasi ke docx' jika kamu ingin Karsa mengubah naskah ini menjadi file Word resmi.*"
                )
                return {"messages": [AIMessage(content=resp)]}

            # 3. LLM Fallback (Scientific Writing Mentor)
            try:
                system_prompt = (
                    "Kamu adalah Karsa, mentor penulisan ilmiah formal mahasiswa. "
                    "Bantu menyusun kalimat akademis yang presisi, bebas plagiasi, menerapkan kaidah bahasa baku (PUEBI/APA/IEEE), "
                    "dan memperjelas narasi argumen ilmiah."
                )
                model = ctx.router.get_model(
                    purpose="writer",
                    module_name="writer",
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
                            content="Saya siap membantumu menyusun draf karya ilmiah berstruktur IMRaD atau mengompilasinya langsung ke dokumen Word (.docx). Ada topik yang ingin ditulis?"
                        )
                    ]
                }

        workflow.add_node("writer_dispatch", writer_dispatch_node)
        workflow.add_edge(START, "writer_dispatch")
        workflow.add_edge("writer_dispatch", END)

        return workflow.compile()


# Instantiate and auto-register both modules into global registry
research_module = ResearchModule()
writer_module = WriterModule()

try:
    registry.register(research_module)
except ValueError:
    pass

try:
    registry.register(writer_module)
except ValueError:
    pass
