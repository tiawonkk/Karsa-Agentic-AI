from pathlib import Path
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

from backend.core.database import initialize_master_database, get_db_cursor
from backend.core.config import settings
from backend.modules.base_module import registry, ModuleContext
from backend.modules.finance.tools import (
    parse_indonesian_nominal,
    classify_category_deterministic,
    calculate_daily_safe_spend,
    get_or_create_monthly_budget,
    record_transaction_in_db,
    get_budget_snapshot,
    evaluate_investment_readiness,
    update_monthly_capital_in_db,
)
from backend.modules.finance.module import FinanceModule, finance_module


def test_nominal_parser():
    assert parse_indonesian_nominal("beli seblak 25rb di kantin") == 25000
    assert parse_indonesian_nominal("jajan es kopi 18k") == 18000
    assert parse_indonesian_nominal("beli buku tulis 120 ribu") == 120000
    assert parse_indonesian_nominal("bayar kos 1.5jt") == 1500000
    assert parse_indonesian_nominal("spp kuliah 2,5 juta") == 2500000
    assert parse_indonesian_nominal("bayar Rp 50.000") == 50000
    assert parse_indonesian_nominal("total rp. 75.000") == 75000
    assert parse_indonesian_nominal("15000") == 15000
    assert parse_indonesian_nominal("halo karsa apa kabar?") is None


def test_deterministic_category_classifier():
    assert classify_category_deterministic("beli nasi padang rendang") == "makanan"
    assert classify_category_deterministic("jajan seblak level 5") == "makanan"
    assert classify_category_deterministic("fotokopi materi ujian dan modul") == "pelajaran"
    assert classify_category_deterministic("beli buku kalkulus di togamas") == "pelajaran"
    assert classify_category_deterministic("beli tolak angin dan paracetamol di apotek") == "kesehatan"
    assert classify_category_deterministic("nabung reksadana pasar uang bibit") == "investment"
    assert classify_category_deterministic("nongkrong di kafe kopi sama teman") == "kesenangan"
    assert classify_category_deterministic("top up game steam 50k") == "kesenangan"


def test_daily_safe_spend_formula():
    # 500k makanan + 100k kesenangan / 10 days = 60.000
    assert calculate_daily_safe_spend(500000, 100000, 10) == 60000
    # Last day of month
    assert calculate_daily_safe_spend(50000, 20000, 1) == 70000
    # Deficit / negative
    assert calculate_daily_safe_spend(-20000, 0, 5) == 0


def test_budget_and_transactions_lifecycle(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    (tmp_path / "storage").mkdir(parents=True, exist_ok=True)
    initialize_master_database(settings.master_db_path)

    # 1. Initialize budget
    period = "2026-10"
    b = get_or_create_monthly_budget(period=period, default_capital=2_000_000)
    assert b["total_capital_idr"] == 2_000_000
    assert b["alloc_makanan"] == 1_000_000

    # 2. Record transactions
    t1 = record_transaction_in_db(
        amount_idr=25000,
        category="makanan",
        description="seblak kantin",
        period=period,
    )
    assert t1["amount_idr"] == 25000

    t2 = record_transaction_in_db(
        amount_idr=50000,
        category="pelajaran",
        description="buku catatan",
        period=period,
    )
    assert t2["amount_idr"] == 50000

    # 3. Snapshot verification
    snap = get_budget_snapshot(period=period)
    assert snap["total_spent_idr"] == 75000
    assert snap["total_remaining_idr"] == 1_925_000
    assert snap["categories"]["makanan"]["spent"] == 25000
    assert snap["categories"]["makanan"]["remaining"] == 975000
    assert snap["categories"]["pelajaran"]["spent"] == 50000
    assert snap["categories"]["pelajaran"]["remaining"] == 350000
    assert snap["daily_safe_spend_idr"] > 0


def test_investment_readiness_evaluation(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    (tmp_path / "storage").mkdir(parents=True, exist_ok=True)
    initialize_master_database(settings.master_db_path)

    period = "2026-10"
    get_or_create_monthly_budget(period=period, default_capital=2_000_000)

    # Normal healthy budget -> should be ready for conservative investment
    res_ready = evaluate_investment_readiness(period=period)
    assert res_ready["is_ready"] is True
    assert "Reksadana Pasar Uang" in res_ready["recommendation"]

    # Deplete makanan allocation completely
    record_transaction_in_db(
        amount_idr=1_200_000,
        category="makanan",
        description="traktir sekelas",
        period=period,
    )
    res_not_ready = evaluate_investment_readiness(period=period)
    assert res_not_ready["is_ready"] is False
    assert "Belum Disarankan" in res_not_ready["recommendation"]


def test_finance_subgraph_deterministic_flow(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    (tmp_path / "storage").mkdir(parents=True, exist_ok=True)
    initialize_master_database(settings.master_db_path)

    mod = FinanceModule()
    ctx = ModuleContext(session_thread_id="test_fin_thread_01")
    graph = mod.build_graph(ctx)

    # 1. Fast-path expense input
    res1 = graph.invoke({"messages": [HumanMessage(content="beli seblak 25rb")]})
    assert len(res1["messages"]) > 0
    msg_content = str(res1["messages"][-1].content)
    assert "Pengeluaran dicatat" in msg_content
    assert "25.000" in msg_content
    assert "Daily Safe Spend" in msg_content

    # 2. Budget snapshot query
    res2 = graph.invoke({"messages": [HumanMessage(content="cek saldo dan daily safe spend")]})
    content2 = str(res2["messages"][-1].content)
    assert "Ringkasan Anggaran" in content2
    assert "Daily Safe Spend" in content2

    # 3. Investment advice query
    res3 = graph.invoke({"messages": [HumanMessage(content="apakah saya boleh investasi di bibit reksadana?")]})
    content3 = str(res3["messages"][-1].content)
    assert "Reksadana" in content3 or "Investasi" in content3


def test_finance_set_monthly_capital_hitl(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    (tmp_path / "storage").mkdir(parents=True, exist_ok=True)
    initialize_master_database(settings.master_db_path)

    # Test update_monthly_capital_in_db directly
    res_update = update_monthly_capital_in_db(
        new_total_capital_idr=3_000_000,
        period="2026-10",
    )
    assert res_update["total_capital_idr"] == 3_000_000
    assert res_update["allocations"]["makanan"] == 1_500_000

    snap = get_budget_snapshot(period="2026-10")
    assert snap["total_capital_idr"] == 3_000_000

