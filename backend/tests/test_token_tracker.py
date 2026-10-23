from pathlib import Path
from backend.core.token_tracker import (
    calculate_cost_idr,
    record_token_log,
    get_token_usage_summary,
)
from backend.core.database import initialize_master_database


def test_calculate_cost_idr():
    # Ollama is always Rp0
    cost_ollama = calculate_cost_idr(
        provider="ollama",
        model_name="hermes3:8b",
        tokens_in=10000,
        tokens_out=2000,
    )
    assert cost_ollama == 0.0

    # Gemini Flash calculation
    cost_gemini = calculate_cost_idr(
        provider="gemini",
        model_name="gemini-2.0-flash",
        tokens_in=1_000_000,  # $0.10
        tokens_out=1_000_000, # $0.40
        usd_to_idr_rate=16000.0,
    )
    # Total $0.50 * 16000 = Rp8000
    assert abs(cost_gemini - 8000.0) < 1.0


def test_token_logging_and_query(tmp_path: Path):
    test_db = tmp_path / "test_tokens.db"
    initialize_master_database(test_db)

    # Record two calls to the isolated test database
    record_token_log(
        module="finance",
        provider="gemini",
        model_used="gemini-2.0-flash",
        tokens_in=500,
        tokens_out=150,
        hardware_mode="eco_cpu",
        session_thread_id="t-1",
        latency_ms=120,
        db_path=test_db,
    )

    record_token_log(
        module="finance",
        provider="ollama",
        model_used="hermes3:8b",
        tokens_in=1000,
        tokens_out=300,
        hardware_mode="turbo_gpu",
        session_thread_id="t-1",
        latency_ms=80,
        db_path=test_db,
    )

    summary = get_token_usage_summary(module="finance", db_path=test_db)
    assert summary["call_count"] == 2
    assert summary["grand_total_tokens"] == (500 + 150 + 1000 + 300)
    assert summary["total_cost_idr"] > 0
