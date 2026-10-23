from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any
from contextlib import contextmanager

from langgraph.checkpoint.sqlite import SqliteSaver

from backend.core.config import settings

# Master Schema DDL
MASTER_SCHEMA_DDL = """
-- 1. System Settings
CREATE TABLE IF NOT EXISTS system_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 2. Token Logs
CREATE TABLE IF NOT EXISTS token_logs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    session_thread_id   TEXT,
    module              TEXT    NOT NULL,
    provider            TEXT    NOT NULL,
    model_used          TEXT    NOT NULL,
    hardware_mode       TEXT    CHECK (hardware_mode IN ('turbo_gpu','eco_cpu')),
    tokens_in           INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
    tokens_out          INTEGER NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
    latency_ms          INTEGER,
    estimated_cost_idr  REAL    NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_token_logs_ts     ON token_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_token_logs_module ON token_logs(module);

-- 3. Monthly Budget
CREATE TABLE IF NOT EXISTS monthly_budget (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    period              TEXT    NOT NULL UNIQUE CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    total_capital_idr   INTEGER NOT NULL CHECK (total_capital_idr >= 0),
    alloc_makanan       INTEGER NOT NULL DEFAULT 0 CHECK (alloc_makanan >= 0),
    alloc_pelajaran     INTEGER NOT NULL DEFAULT 0 CHECK (alloc_pelajaran >= 0),
    alloc_kesehatan     INTEGER NOT NULL DEFAULT 0 CHECK (alloc_kesehatan >= 0),
    alloc_investment    INTEGER NOT NULL DEFAULT 0 CHECK (alloc_investment >= 0),
    alloc_kesenangan    INTEGER NOT NULL DEFAULT 0 CHECK (alloc_kesenangan >= 0),
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (alloc_makanan + alloc_pelajaran + alloc_kesehatan + alloc_investment + alloc_kesenangan = total_capital_idr)
);

-- 4. Financial Transactions
CREATE TABLE IF NOT EXISTS financial_transactions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    period          TEXT    NOT NULL,
    txn_date        TEXT    NOT NULL,
    amount_idr      INTEGER NOT NULL CHECK (amount_idr > 0),
    category        TEXT    NOT NULL CHECK (category IN ('makanan','pelajaran','kesehatan','investment','kesenangan')),
    merchant        TEXT,
    description     TEXT,
    source          TEXT    NOT NULL CHECK (source IN ('text','ocr','manual')),
    receipt_ref     TEXT,
    confidence      REAL    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    used_llm        INTEGER NOT NULL DEFAULT 0 CHECK (used_llm IN (0,1)),
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_fin_txn_period_cat ON financial_transactions(period, category);

-- 5. Tasks (Eisenhower Matrix with Generated Column)
CREATE TABLE IF NOT EXISTS tasks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT    NOT NULL,
    description     TEXT,
    course          TEXT,
    task_type       TEXT    NOT NULL DEFAULT 'assignment' CHECK (task_type IN ('assignment','exam','project','roadmap','personal')),
    due_at          TEXT,
    is_urgent       INTEGER NOT NULL DEFAULT 0 CHECK (is_urgent IN (0,1)),
    is_important    INTEGER NOT NULL DEFAULT 0 CHECK (is_important IN (0,1)),
    quadrant        TEXT GENERATED ALWAYS AS (
                        CASE
                          WHEN is_important = 1 AND is_urgent = 1 THEN 'Q1_DO'
                          WHEN is_important = 1 AND is_urgent = 0 THEN 'Q2_SCHEDULE'
                          WHEN is_important = 0 AND is_urgent = 1 THEN 'Q3_DELEGATE'
                          ELSE 'Q4_ELIMINATE'
                        END
                    ) VIRTUAL,
    status          TEXT    NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','dropped')),
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    completed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status, due_at);

-- 6. Study Summaries
CREATE TABLE IF NOT EXISTS study_summaries (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    title               TEXT    NOT NULL,
    source_paths        TEXT    NOT NULL,
    source_hash         TEXT,
    language            TEXT    NOT NULL DEFAULT 'id' CHECK (language IN ('id','en')),
    executive_summary   TEXT    NOT NULL,
    key_concepts        TEXT    NOT NULL,
    self_test           TEXT    NOT NULL,
    model_used          TEXT,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 7. Academic Papers
CREATE TABLE IF NOT EXISTS academic_papers (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    source              TEXT    NOT NULL CHECK (source IN ('arxiv','semantic_scholar','crossref','local_pdf')),
    external_id         TEXT    NOT NULL,
    doi                 TEXT,
    title               TEXT    NOT NULL,
    authors             TEXT,
    publication_year    INTEGER,
    abstract            TEXT,
    dataset_source      TEXT,
    methodology         TEXT,
    limitations         TEXT,
    evaluation_metrics  TEXT,
    pdf_path            TEXT,
    url                 TEXT,
    extraction_status   TEXT    NOT NULL DEFAULT 'metadata_only' CHECK (extraction_status IN ('metadata_only','extracted','failed')),
    model_used          TEXT,
    extracted_at        TEXT,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_papers_doi ON academic_papers(doi);

-- 8. Wardrobe Items (Mascot Accessories & Custom Colors)
CREATE TABLE IF NOT EXISTS wardrobe_items (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    anchor_type     TEXT NOT NULL CHECK (anchor_type IN ('head_top', 'eyes', 'neck', 'side', 'body')),
    layer_png_path  TEXT NOT NULL,
    color_palette   TEXT,
    is_active       INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 9. HITL Approvals Audit
CREATE TABLE IF NOT EXISTS hitl_approvals (
    action_id           TEXT PRIMARY KEY,
    session_thread_id   TEXT    NOT NULL,
    module              TEXT    NOT NULL,
    action_name         TEXT    NOT NULL,
    risk_level          TEXT    NOT NULL CHECK (risk_level IN ('high','critical')),
    request_json        TEXT    NOT NULL,
    decision            TEXT    CHECK (decision IN ('approve','edit','reject')),
    decision_json       TEXT,
    requested_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    decided_at          TEXT,
    executed            INTEGER NOT NULL DEFAULT 0 CHECK (executed IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_hitl_pending ON hitl_approvals(decision) WHERE decision IS NULL;

-- 10. Schema Migrations Log
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 11. Focus Sessions (Pomodoro Timer)
CREATE TABLE IF NOT EXISTS focus_sessions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id             INTEGER,
    duration_minutes    INTEGER NOT NULL CHECK (duration_minutes > 0),
    session_type        TEXT NOT NULL DEFAULT 'focus' CHECK (session_type IN ('focus', 'short_break', 'long_break')),
    timestamp           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_ts ON focus_sessions(timestamp);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_task ON focus_sessions(task_id);

-- 12. Hydration Logs (Water Reminder & Hourly Intake)
CREATE TABLE IF NOT EXISTS hydration_logs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    amount_ml           INTEGER NOT NULL CHECK (amount_ml > 0),
    daily_target_ml     INTEGER NOT NULL DEFAULT 2000 CHECK (daily_target_ml > 0),
    timestamp           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_hydration_logs_ts ON hydration_logs(timestamp);

-- 13. Shelf Files (File Drop Shelf)
CREATE TABLE IF NOT EXISTS shelf_files (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path           TEXT NOT NULL,
    file_name           TEXT NOT NULL,
    file_type           TEXT NOT NULL,
    added_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_shelf_files_added ON shelf_files(added_at);
"""

# Default system settings seed
DEFAULT_SETTINGS: dict[str, Any] = {
    "hardware.override": "auto",
    "hardware.min_vram_gb": 6.0,
    "hardware.sleep_idle_minutes": 5,
    "modules.enabled": ["finance", "study_daily", "research", "writer", "datascience_code"],
    "token_budget.daily_tokens": 50000,
    "token_budget.daily_idr": 2000.0,
    "pricing.usd_idr_rate": 16000.0,
    "user.locale": "id-ID",
    "user.timezone": "Asia/Jakarta",
    "study.urgent_threshold_hours": 48,
    "wardrobe.body_color": "#A0D2EB",
    "wardrobe.eye_color": "#2E4057",
}


def get_db_connection(db_path: Path | str | None = None) -> sqlite3.Connection:
    """Open and configure a SQLite connection in WAL mode."""
    target_path = Path(db_path) if db_path else settings.master_db_path
    target_path.parent.mkdir(parents=True, exist_ok=True)
    
    conn = sqlite3.connect(target_path, timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA busy_timeout=5000;")
    return conn


@contextmanager
def get_db_cursor(db_path: Path | str | None = None):
    """Context manager yielding cursor and committing on success."""
    conn = get_db_connection(db_path)
    cursor = conn.cursor()
    try:
        yield cursor
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def initialize_master_database(db_path: Path | str | None = None) -> None:
    """Run DDL and seed default settings if not initialized."""
    settings.ensure_directories()
    conn = get_db_connection(db_path)
    try:
        with conn:
            conn.executescript(MASTER_SCHEMA_DDL)
            
            # Record schema migrations
            conn.execute(
                "INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);"
            )
            conn.execute(
                "INSERT OR IGNORE INTO schema_migrations (version) VALUES (2);"
            )
            
            # Seed default system settings
            for key, val in DEFAULT_SETTINGS.items():
                conn.execute(
                    "INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?);",
                    (key, json.dumps(val)),
                )
    finally:
        conn.close()


def get_sqlite_checkpointer(checkpoints_path: Path | str | None = None) -> SqliteSaver:
    """Return a SqliteSaver checkpointer for LangGraph on checkpoints database."""
    target_path = Path(checkpoints_path) if checkpoints_path else settings.checkpoints_db_path
    target_path.parent.mkdir(parents=True, exist_ok=True)
    
    conn = sqlite3.connect(target_path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    saver = SqliteSaver(conn)
    saver.setup()
    return saver


# -------------------------------------------------------------------------
# Dynamic Island V3 Helpers (Pomodoro Focus, Hydration Logs, File Shelf)
# -------------------------------------------------------------------------

def log_focus_session(
    duration_minutes: int,
    session_type: str = "focus",
    task_id: int | None = None,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Record a completed or active Pomodoro focus/break session."""
    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            INSERT INTO focus_sessions (task_id, duration_minutes, session_type)
            VALUES (?, ?, ?);
            """,
            (task_id, duration_minutes, session_type),
        )
        row_id = cursor.lastrowid
        cursor.execute("SELECT * FROM focus_sessions WHERE id = ?;", (row_id,))
        row = cursor.fetchone()
        return dict(row) if row else {}


def get_focus_sessions(limit: int = 20, db_path: Path | str | None = None) -> list[dict[str, Any]]:
    """Retrieve recent Pomodoro focus sessions."""
    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            SELECT f.*, t.title as task_title
            FROM focus_sessions f
            LEFT JOIN tasks t ON f.task_id = t.id
            ORDER BY f.timestamp DESC
            LIMIT ?;
            """,
            (limit,),
        )
        return [dict(r) for r in cursor.fetchall()]


def log_hydration(
    amount_ml: int,
    daily_target_ml: int = 2000,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Record a water intake entry in milliliters."""
    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            INSERT INTO hydration_logs (amount_ml, daily_target_ml)
            VALUES (?, ?);
            """,
            (amount_ml, daily_target_ml),
        )
        row_id = cursor.lastrowid
        cursor.execute("SELECT * FROM hydration_logs WHERE id = ?;", (row_id,))
        row = cursor.fetchone()
        return dict(row) if row else {}


def get_today_hydration_summary(
    daily_target_ml: int = 2000,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Calculate today's total water intake and hourly distribution between 09:00 - 21:00."""
    import datetime
    today_str = datetime.date.today().isoformat()
    hourly_slots = {f"{h:02d}:00": 0 for h in range(9, 22)}

    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            SELECT amount_ml, daily_target_ml, timestamp
            FROM hydration_logs
            WHERE date(timestamp) = date('now')
            ORDER BY timestamp ASC;
            """
        )
        rows = cursor.fetchall()

    total_ml = 0
    effective_target = daily_target_ml
    for r in rows:
        amount = r["amount_ml"]
        total_ml += amount
        if r["daily_target_ml"]:
            effective_target = r["daily_target_ml"]
        ts_str = r["timestamp"]
        try:
            hour_val = int(ts_str[11:13]) if len(ts_str) >= 13 else 9
            slot_key = f"{hour_val:02d}:00"
            if slot_key in hourly_slots:
                hourly_slots[slot_key] += amount
        except Exception:
            pass

    return {
        "date": today_str,
        "total_ml": total_ml,
        "daily_target_ml": effective_target,
        "percentage": min(100.0, round((total_ml / effective_target) * 100, 1)) if effective_target > 0 else 0.0,
        "hourly_chart": [{"time": k, "amount_ml": v} for k, v in hourly_slots.items()],
    }


def add_shelf_file(
    file_path: str,
    file_name: str,
    file_type: str,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Store a file pointer dropped onto the Dynamic Island Shelf."""
    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            INSERT INTO shelf_files (file_path, file_name, file_type)
            VALUES (?, ?, ?);
            """,
            (file_path, file_name, file_type),
        )
        row_id = cursor.lastrowid
        cursor.execute("SELECT * FROM shelf_files WHERE id = ?;", (row_id,))
        row = cursor.fetchone()
        return dict(row) if row else {}


def list_shelf_files(limit: int = 30, db_path: Path | str | None = None) -> list[dict[str, Any]]:
    """List all files currently pinned or dropped on the shelf."""
    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            SELECT * FROM shelf_files
            ORDER BY added_at DESC
            LIMIT ?;
            """,
            (limit,),
        )
        return [dict(r) for r in cursor.fetchall()]


def remove_shelf_file(shelf_id: int, db_path: Path | str | None = None) -> bool:
    """Remove a file from the drop shelf by id."""
    with get_db_cursor(db_path) as cursor:
        cursor.execute("DELETE FROM shelf_files WHERE id = ?;", (shelf_id,))
        return cursor.rowcount > 0

