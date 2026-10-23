from pathlib import Path
from backend.core.database import initialize_master_database
from backend.core.config import settings
from backend.orchestrator.supervisor import (
    match_deterministic_intent,
    build_karsa_supervisor_graph,
)
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.messages import HumanMessage


def test_deterministic_intent_matcher():
    enabled = ["finance", "study_daily", "research", "writer", "datascience_code"]

    # Finance: Indonesian colloquial price
    res_fin = match_deterministic_intent("baru beli seblak 25rb di kantin", enabled)
    assert res_fin == "finance"

    res_fin2 = match_deterministic_intent("cek saldo dan daily safe spend hari ini", enabled)
    assert res_fin2 == "finance"

    # Study: Eisenhower task
    res_study = match_deterministic_intent("ingatkan deadline tugas besar besok malam", enabled)
    assert res_study == "study_daily"

    # Research: arXiv paper
    res_res = match_deterministic_intent("tolong carikan paper arXiv tentang agentic ai", enabled)
    assert res_res == "research"

    # Writer: IMRaD docx
    res_wr = match_deterministic_intent("susun draft paper imrad ke file docx", enabled)
    assert res_wr == "writer"

    # Data science: CSV dataset
    res_ds = match_deterministic_intent("bersihkan dataset csv ini dengan pandas", enabled)
    assert res_ds == "datascience_code"

    # Ambiguous or greeting returns None
    res_amb = match_deterministic_intent("halo selamat malam", enabled)
    assert res_amb is None


def test_supervisor_graph_execution(tmp_path: Path, monkeypatch):
    test_db = tmp_path / "test_sup.db"
    initialize_master_database(test_db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    mem_ckpt = MemorySaver()
    graph = build_karsa_supervisor_graph(checkpointer=mem_ckpt)

    config = {"configurable": {"thread_id": "test_sup_t1"}}
    state = graph.invoke(
        {"messages": [HumanMessage(content="halo apa kabar")]},
        config=config,
    )
    assert "messages" in state
    assert len(state["messages"]) > 0
