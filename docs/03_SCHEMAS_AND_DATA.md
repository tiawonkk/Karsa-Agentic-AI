# Schemas & Data Contracts: Project Karsa

> **Versi Dokumen:** 2.0 · **Terakhir diperbarui:** 2026-10-22  
> **Implementasi Target:** `backend/core/state.py` & `backend/core/database.py`

---

## 1. In-Memory Graph State (`KarsaState`)

State graf orkestrasi didefinisikan menggunakan `TypedDict` dengan reducer pesan dan penanda referensi eksternal:

```python
import operator
from typing import Annotated, Literal, TypedDict
from langchain_core.messages import AnyMessage

HardwareMode = Literal["turbo_gpu", "eco_cpu"]
PowerState = Literal["active", "sleep"]

class TokenUsage(TypedDict):
    tokens_in: int
    tokens_out: int
    estimated_cost_idr: float

class ActiveWindowContext(TypedDict):
    window_title: str
    process_name: str
    screenshot_ref: str | None      # Path file lokal (disanitasi/dikompresi)
    ocr_text_preview: str | None    # Teks hasil OCR lokal (maks 1.000 karakter)
    captured_at: str                # ISO-8601 UTC

class KarsaState(TypedDict, total=False):
    # Percakapan
    messages: Annotated[list[AnyMessage], operator.add]

    # Status Sistem & Perutean
    active_module: str | None
    hardware_mode: HardwareMode
    power_state: PowerState         # "active" | "sleep" (Zero-Heat Trigger)
    session_thread_id: str

    # Konteks Layar & Jendela Aktif (ScreenAssist)
    active_window_context: ActiveWindowContext | None

    # External Reference Pattern (Hanya Path, Bukan Isi File)
    active_workspace_path: str | None
    current_document_ref: str | None
    current_dataset_ref: str | None

    # Human-in-the-Loop Governance
    pending_approval: dict | None

    # Observabilitas
    session_token_usage: TokenUsage
```

---

## 2. Skema SQLite Lokal (`~/.karsa/storage/karsa_master.db`)

Semua tabel menggunakan koneksi WAL mode (`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`).

### 2.1 `system_settings`
Menyimpan konfigurasi sistem, mode hardware, model aktif, dan preferensi pengguna:
```sql
CREATE TABLE IF NOT EXISTS system_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,       -- JSON format
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

### 2.2 `token_logs`
Audit konsumsi token LLM dan estimasi biaya rupiah:
```sql
CREATE TABLE IF NOT EXISTS token_logs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    session_thread_id   TEXT,
    module              TEXT    NOT NULL,
    provider            TEXT    NOT NULL,
    model_used          TEXT    NOT NULL,
    hardware_mode       TEXT    CHECK (hardware_mode IN ('turbo_gpu','eco_cpu')),
    tokens_in           INTEGER NOT NULL DEFAULT 0,
    tokens_out          INTEGER NOT NULL DEFAULT 0,
    latency_ms          INTEGER,
    estimated_cost_idr  REAL    NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_token_logs_ts ON token_logs(timestamp);
```

### 2.3 `monthly_budget`
Pagu modal bulanan dan alokasi 5 kategori mutlak:
```sql
CREATE TABLE IF NOT EXISTS monthly_budget (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    period              TEXT    NOT NULL UNIQUE, -- 'YYYY-MM'
    total_capital_idr   INTEGER NOT NULL CHECK (total_capital_idr >= 0),
    alloc_makanan       INTEGER NOT NULL DEFAULT 0 CHECK (alloc_makanan >= 0),
    alloc_pelajaran     INTEGER NOT NULL DEFAULT 0 CHECK (alloc_pelajaran >= 0),
    alloc_kesehatan     INTEGER NOT NULL DEFAULT 0 CHECK (alloc_kesehatan >= 0),
    alloc_investment    INTEGER NOT NULL DEFAULT 0 CHECK (alloc_investment >= 0),
    alloc_kesenangan    INTEGER NOT NULL DEFAULT 0 CHECK (alloc_kesenangan >= 0),
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

### 2.4 `financial_transactions`
Mutasi transaksi harian:
```sql
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
    confidence      REAL,
    used_llm        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

### 2.5 `tasks`
Jadwal tugas mahasiswa dengan kuadran Eisenhower Matrix yang dihitung otomatis:
```sql
CREATE TABLE IF NOT EXISTS tasks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT    NOT NULL,
    description     TEXT,
    course          TEXT,
    task_type       TEXT    NOT NULL DEFAULT 'assignment',
    due_at          TEXT,
    is_urgent       INTEGER NOT NULL DEFAULT 0,
    is_important    INTEGER NOT NULL DEFAULT 0,
    quadrant        TEXT GENERATED ALWAYS AS (
                        CASE
                          WHEN is_important = 1 AND is_urgent = 1 THEN 'Q1_DO'
                          WHEN is_important = 1 AND is_urgent = 0 THEN 'Q2_SCHEDULE'
                          WHEN is_important = 0 AND is_urgent = 1 THEN 'Q3_DELEGATE'
                          ELSE 'Q4_ELIMINATE'
                        END
                    ) VIRTUAL,
    status          TEXT    NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','dropped')),
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

### 2.6 `study_summaries`
Penyimpanan rangkuman eksekutif, konsep kunci, dan lembar uji mandiri:
```sql
CREATE TABLE IF NOT EXISTS study_summaries (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    title               TEXT    NOT NULL,
    source_paths        TEXT    NOT NULL,   -- JSON array
    source_hash         TEXT,
    language            TEXT    NOT NULL DEFAULT 'id',
    executive_summary   TEXT    NOT NULL,   -- JSON array
    key_concepts        TEXT    NOT NULL,   -- JSON array
    self_test           TEXT    NOT NULL,   -- JSON array
    model_used          TEXT,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

### 2.7 `academic_papers`
Metadata jurnal ilmiah dari pencarian arXiv, Semantic Scholar, dan Crossref:
```sql
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
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (source, external_id)
);
```

### 2.8 `wardrobe_items` *(Penyimpanan Aksesoris Maskot & Warna Kustom)*
Menyimpan warna kustom dan aksesoris hasil gambar pengguna dari Wardrobe Studio:
```sql
CREATE TABLE IF NOT EXISTS wardrobe_items (
    id              TEXT PRIMARY KEY,           -- UUID / slug nama aksesoris
    name            TEXT NOT NULL,              -- mis. "Topi Wisuda Buatan Sendiri"
    anchor_type     TEXT NOT NULL CHECK (anchor_type IN ('head_top', 'eyes', 'neck', 'side', 'body')),
    layer_png_path  TEXT NOT NULL,              -- Path file PNG transparan 256x256 di ~/.karsa/wardrobe/
    color_palette   TEXT,                       -- JSON konfigurasi warna ({body_color, eye_color, aura})
    is_active       INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

### 2.9 `hitl_approvals`
Log audit persetujuan manusia dan pencegahan eksekusi ganda:
```sql
CREATE TABLE IF NOT EXISTS hitl_approvals (
    action_id           TEXT PRIMARY KEY,
    session_thread_id   TEXT    NOT NULL,
    module              TEXT    NOT NULL,
    action_name         TEXT    NOT NULL,
    risk_level          TEXT    NOT NULL,
    request_json        TEXT    NOT NULL,
    decision            TEXT    CHECK (decision IN ('approve','edit','reject')),
    decided_at          TEXT,
    executed            INTEGER NOT NULL DEFAULT 0 CHECK (executed IN (0, 1))
);
```

### 2.10 `focus_sessions` *(Pomodoro Timer Tracker)*
Mencatat sesi fokus belajar mandiri dan istirahat Pomodoro terhubung ke ID tugas:
```sql
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
```

### 2.11 `hydration_logs` *(Water Reminder & Hourly Intake Bar Chart)*
Audit konsumsi air minum harian mahasiswa beserta visualisasi grafik per jam (09:00 - 21:00):
```sql
CREATE TABLE IF NOT EXISTS hydration_logs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    amount_ml           INTEGER NOT NULL CHECK (amount_ml > 0),
    daily_target_ml     INTEGER NOT NULL DEFAULT 2000 CHECK (daily_target_ml > 0),
    timestamp           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_hydration_logs_ts ON hydration_logs(timestamp);
```

### 2.12 `shelf_files` *(Dynamic Island File Drop Shelf)*
Penyimpanan pointer file lokal yang di-drop ke pulau untuk akses cepat, ekstraksi instan, atau drag kembali ke aplikasi lain:
```sql
CREATE TABLE IF NOT EXISTS shelf_files (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path           TEXT NOT NULL,
    file_name           TEXT NOT NULL,
    file_type           TEXT NOT NULL,
    added_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_shelf_files_added ON shelf_files(added_at);
```

---

## 3. Checkpointer Sesi (LangGraph `SqliteSaver`)

* File database checkpoint: `~/.karsa/storage/karsa_checkpoints.db` (terpisah dari `karsa_master.db`).
* State percakapan, breakpoint interupsi HITL, dan status eksekusi tersimpan persisten berdasarkan `session_thread_id`.

