import sqlite3
import pytest
from pathlib import Path

from backend.core.database import (
    initialize_master_database,
    get_db_connection,
    get_sqlite_checkpointer,
)


def test_database_initialization_and_tables(tmp_path: Path):
    db_file = tmp_path / "test_karsa.db"
    initialize_master_database(db_file)

    conn = get_db_connection(db_file)
    cursor = conn.cursor()

    # Check WAL mode
    cursor.execute("PRAGMA journal_mode;")
    mode = cursor.fetchone()[0]
    assert mode.lower() == "wal"

    # Verify all expected tables exist
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = {row[0] for row in cursor.fetchall()}

    expected_tables = {
        "system_settings",
        "token_logs",
        "monthly_budget",
        "financial_transactions",
        "tasks",
        "study_summaries",
        "academic_papers",
        "wardrobe_items",
        "hitl_approvals",
        "schema_migrations",
        "focus_sessions",
        "hydration_logs",
        "hydration_settings",
        "shelf_files",
    }
    for t in expected_tables:
        assert t in tables, f"Expected table '{t}' was not found in database."

    # Verify seed settings exist
    cursor.execute("SELECT COUNT(*) FROM system_settings;")
    settings_count = cursor.fetchone()[0]
    assert settings_count > 0

    # Verify Eisenhower matrix generated column on tasks
    cursor.execute(
        """
        INSERT INTO tasks (title, is_important, is_urgent)
        VALUES ('Tugas Besar AI', 1, 1);
        """
    )
    cursor.execute("SELECT quadrant FROM tasks WHERE title = 'Tugas Besar AI';")
    quadrant = cursor.fetchone()[0]
    assert quadrant == "Q1_DO"

    cursor.execute(
        """
        INSERT INTO tasks (title, is_important, is_urgent)
        VALUES ('Belajar Teori Q2', 1, 0);
        """
    )
    cursor.execute("SELECT quadrant FROM tasks WHERE title = 'Belajar Teori Q2';")
    quadrant = cursor.fetchone()[0]
    assert quadrant == "Q2_SCHEDULE"

    conn.close()


def test_sqlite_checkpointer(tmp_path: Path):
    ckpt_file = tmp_path / "checkpoints.db"
    saver = get_sqlite_checkpointer(ckpt_file)
    assert saver is not None
    assert ckpt_file.exists()


def test_dynamic_island_v3_tables_and_helpers(tmp_path: Path):
    from backend.core.database import (
        log_focus_session,
        get_focus_sessions,
        log_hydration,
        get_today_hydration_summary,
        add_shelf_file,
        list_shelf_files,
        remove_shelf_file,
    )
    db_file = tmp_path / "test_v3.db"
    initialize_master_database(db_file)

    # 1. Test Focus Session
    f_res = log_focus_session(duration_minutes=25, session_type="focus", db_path=db_file)
    assert f_res["id"] is not None
    assert f_res["duration_minutes"] == 25
    assert f_res["session_type"] == "focus"
    
    sessions = get_focus_sessions(limit=5, db_path=db_file)
    assert len(sessions) == 1
    assert sessions[0]["duration_minutes"] == 25

    # 2. Test Hydration Logs
    h_res = log_hydration(amount_ml=250, daily_target_ml=2000, db_path=db_file)
    assert h_res["id"] is not None
    assert h_res["amount_ml"] == 250
    
    hyd_summary = get_today_hydration_summary(daily_target_ml=2000, db_path=db_file)
    assert hyd_summary["total_ml"] == 250
    assert hyd_summary["percentage"] == 12.5
    assert len(hyd_summary["hourly_chart"]) == 13  # 09:00 to 21:00

    # 3. Test Shelf Files
    s_res = add_shelf_file(
        file_path="C:/docs/paper.pdf",
        file_name="paper.pdf",
        file_type="application/pdf",
        db_path=db_file,
    )
    assert s_res["id"] is not None
    assert s_res["file_name"] == "paper.pdf"

    shelf_list = list_shelf_files(limit=10, db_path=db_file)
    assert len(shelf_list) == 1
    assert shelf_list[0]["file_name"] == "paper.pdf"

    # Remove shelf file
    deleted = remove_shelf_file(s_res["id"], db_path=db_file)
    assert deleted is True
    assert len(list_shelf_files(db_path=db_file)) == 0

