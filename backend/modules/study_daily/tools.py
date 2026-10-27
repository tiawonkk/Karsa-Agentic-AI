from __future__ import annotations

import datetime
import json
import re
from pathlib import Path
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field
from langchain_core.tools import tool

from backend.core.database import get_db_cursor
from backend.core.state import ToolError

TaskType = Literal["assignment", "exam", "project", "roadmap", "personal"]
TaskStatus = Literal["todo", "in_progress", "done", "dropped"]
Quadrant = Literal["Q1_DO", "Q2_SCHEDULE", "Q3_DELEGATE", "Q4_ELIMINATE"]


def parse_due_date_natural(text: str) -> datetime.datetime | None:
    """Parse Indonesian natural time expressions into datetime object.
    
    Examples:
      - 'besok malam' -> tomorrow 21:00
      - 'besok sore' -> tomorrow 17:00
      - 'besok pagi' -> tomorrow 09:00
      - 'besok' -> tomorrow 23:59:00
      - 'lusa' -> today + 2 days 23:59:00
      - 'hari ini', 'nanti malam' -> today 21:00
      - '2 hari lagi' -> today + 2 days
      - '2026-10-25' or '2026-10-25 14:00' -> parsed datetime
    """
    cleaned = text.lower().strip()
    now = datetime.datetime.now()

    # ISO or standard date formats
    iso_match = re.search(r"\b(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?\b", cleaned)
    if iso_match:
        y, m, d = int(iso_match.group(1)), int(iso_match.group(2)), int(iso_match.group(3))
        hh = int(iso_match.group(4) or 23)
        mm = int(iso_match.group(5) or 59)
        return datetime.datetime(y, m, d, hh, mm)

    # N days later
    n_days_match = re.search(r"(\d+)\s*hari\s*lagi", cleaned)
    if n_days_match:
        days = int(n_days_match.group(1))
        target = now + datetime.timedelta(days=days)
        return target.replace(hour=23, minute=59, second=0, microsecond=0)

    # Relative days
    if "lusa" in cleaned:
        target = now + datetime.timedelta(days=2)
        return target.replace(hour=23, minute=59, second=0, microsecond=0)

    if "besok" in cleaned:
        target = now + datetime.timedelta(days=1)
        if "malam" in cleaned:
            return target.replace(hour=21, minute=0, second=0, microsecond=0)
        elif "sore" in cleaned:
            return target.replace(hour=17, minute=0, second=0, microsecond=0)
        elif "pagi" in cleaned:
            return target.replace(hour=9, minute=0, second=0, microsecond=0)
        elif "siang" in cleaned:
            return target.replace(hour=13, minute=0, second=0, microsecond=0)
        return target.replace(hour=23, minute=59, second=0, microsecond=0)

    if "hari ini" in cleaned or "nanti malam" in cleaned:
        return now.replace(hour=21, minute=0, second=0, microsecond=0)

    return None


def is_auto_urgent(due_dt: datetime.datetime | None) -> int:
    """Evaluate whether task is urgent (due within <= 48 hours from now)."""
    if not due_dt:
        return 0
    now = datetime.datetime.now()
    diff = due_dt - now
    # <= 48 hours is urgent
    return 1 if diff.total_seconds() <= (48 * 3600) else 0


def add_task_in_db(
    title: str,
    description: str | None = None,
    course: str | None = None,
    task_type: TaskType = "assignment",
    due_at: str | datetime.datetime | None = None,
    is_important: int = 1,
    is_urgent: int | None = None,
    priority: int | None = None,
    recurrence: str | None = None,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Insert task into database with automatic Eisenhower Matrix quadrant calculation."""
    if not title.strip():
        raise ValueError("Judul tugas tidak boleh kosong.")
    if len(title.strip()) > MAX_TITLE:
        raise ValueError(f"Judul tugas maksimal {MAX_TITLE} karakter.")
    if task_type not in VALID_TASK_TYPES:
        raise ValueError(f"Jenis tugas harus salah satu dari {', '.join(VALID_TASK_TYPES)}.")
    if priority is not None and priority not in (1, 2, 3, 4):
        raise ValueError("Prioritas harus 1 (kritis) sampai 4 (santai).")
    recurrence = _check_recurrence(recurrence)

    due_str: str | None = None
    due_dt: datetime.datetime | None = None

    if isinstance(due_at, datetime.datetime):
        due_dt = due_at
        due_str = due_dt.strftime("%Y-%m-%d %H:%M:%S")
    elif isinstance(due_at, str) and due_at.strip():
        parsed = parse_due_date_natural(due_at)
        if parsed:
            due_dt = parsed
            due_str = due_dt.strftime("%Y-%m-%d %H:%M:%S")
        else:
            due_str = due_at.strip()

    # Map priority 1..4 to Eisenhower matrix flags if specified
    if priority == 1:
        is_important, effective_urgent = 1, 1
    elif priority == 2:
        is_important, effective_urgent = 1, 0
    elif priority == 3:
        is_important, effective_urgent = 0, 1
    elif priority == 4:
        is_important, effective_urgent = 0, 0
    else:
        # Determine urgency: if not explicitly supplied, calculate based on 48-hour threshold
        if is_urgent is None:
            effective_urgent = is_auto_urgent(due_dt)
        else:
            effective_urgent = 1 if is_urgent else 0

    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            INSERT INTO tasks (
                title, description, course, task_type, due_at,
                is_urgent, is_important, status, recurrence
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?);
            """,
            (title.strip(), description, course, task_type, due_str, effective_urgent, is_important, recurrence),
        )
        task_id = cursor.lastrowid
        cursor.execute("SELECT * FROM tasks WHERE id = ?;", (task_id,))
        row = cursor.fetchone()
        return dict(row) if row else {}


TASK_TIME_FMT = "%Y-%m-%d %H:%M:%S"
RECURRENCES = ("daily", "weekdays", "weekly")


def _check_recurrence(value: str | None) -> str | None:
    if value in (None, "", "none"):
        return None
    if value not in RECURRENCES:
        raise ValueError("Pengulangan harus daily, weekdays, atau weekly.")
    return value


def list_tasks_from_db(
    status: str = "todo",
    quadrant: str | None = None,
    course: str | None = None,
    db_path: Path | str | None = None,
    recent_done_hours: int = 0,
    now: datetime.datetime | None = None,
) -> list[dict[str, Any]]:
    """Fetch tasks filtered by status and Eisenhower quadrant, ordered by priority P1..P4.

    - A routine's next instance stays hidden until its `available_from` time.
    - With `recent_done_hours`, tasks finished within that window are included too, so a task you just checked
      stays visible (checked) instead of vanishing; after the window it drops out of this view (history stays in SQLite).
    """
    now = now or datetime.datetime.now()
    query = "SELECT * FROM tasks WHERE (available_from IS NULL OR available_from <= ?)"
    params: list[Any] = [now.strftime(TASK_TIME_FMT)]

    if status != "all":
        if recent_done_hours > 0:
            cutoff = (now - datetime.timedelta(hours=recent_done_hours)).strftime(TASK_TIME_FMT)
            query += " AND (status = ? OR (status = 'done' AND completed_at >= ?))"
            params += [status, cutoff]
        else:
            query += " AND status = ?"
            params.append(status)

    if quadrant:
        query += " AND quadrant = ?"
        params.append(quadrant)

    if course:
        query += " AND course LIKE ?"
        params.append(f"%{course}%")

    query += " ORDER BY is_important DESC, is_urgent DESC, due_at ASC, id DESC"

    with get_db_cursor(db_path) as cursor:
        cursor.execute(query, params)
        rows = cursor.fetchall()
        return [dict(r) for r in rows]


def next_routine_time(done_at: datetime.datetime, recurrence: str) -> datetime.datetime:
    """When a finished routine reappears: daily +24 h, weekdays +24 h skipping the weekend, weekly +7 days."""
    if recurrence == "weekly":
        return done_at + datetime.timedelta(days=7)
    nxt = done_at + datetime.timedelta(hours=24)
    if recurrence == "weekdays":
        while nxt.weekday() >= 5:  # Sat/Sun -> next day until Monday
            nxt += datetime.timedelta(days=1)
    return nxt


def complete_task_in_db(
    task_id: int,
    db_path: Path | str | None = None,
    now: datetime.datetime | None = None,
) -> dict[str, Any]:
    """Mark a task as done. A routine task also schedules its next instance (hidden until it is due again)."""
    now = now or datetime.datetime.now()
    now_str = now.strftime(TASK_TIME_FMT)
    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            UPDATE tasks
            SET status = 'done', completed_at = ?
            WHERE id = ?;
            """,
            (now_str, task_id),
        )
        if cursor.rowcount == 0:
            raise ValueError(f"Tugas dengan ID {task_id} tidak ditemukan.")
        cursor.execute("SELECT * FROM tasks WHERE id = ?;", (task_id,))
        row = dict(cursor.fetchone())

        if row.get("recurrence"):
            cursor.execute("SELECT 1 FROM tasks WHERE routine_parent_id = ?;", (task_id,))
            if cursor.fetchone() is None:  # idempotent: completing twice never spawns two copies
                when = next_routine_time(now, row["recurrence"])
                shift = when - now
                due = row.get("due_at")
                new_due = due
                if due:
                    try:
                        new_due = (datetime.datetime.strptime(due, TASK_TIME_FMT) + shift).strftime(TASK_TIME_FMT)
                    except ValueError:
                        new_due = due
                cursor.execute(
                    """
                    INSERT INTO tasks (title, description, course, task_type, due_at, is_urgent, is_important,
                                       status, recurrence, available_from, routine_parent_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?);
                    """,
                    (
                        row["title"], row["description"], row["course"], row["task_type"], new_due,
                        row["is_urgent"], row["is_important"], row["recurrence"], when.strftime(TASK_TIME_FMT), task_id,
                    ),
                )
                row["next_available_from"] = when.strftime(TASK_TIME_FMT)
        return row


def reopen_task_in_db(task_id: int, db_path: Path | str | None = None) -> dict[str, Any]:
    """Undo a completion. A routine's not-yet-visible next instance is removed so it is not duplicated."""
    with get_db_cursor(db_path) as cursor:
        cursor.execute("UPDATE tasks SET status = 'todo', completed_at = NULL WHERE id = ?;", (task_id,))
        if cursor.rowcount == 0:
            raise ValueError(f"Tugas dengan ID {task_id} tidak ditemukan.")
        cursor.execute("DELETE FROM tasks WHERE routine_parent_id = ? AND status = 'todo';", (task_id,))
        cursor.execute("SELECT * FROM tasks WHERE id = ?;", (task_id,))
        return dict(cursor.fetchone())


def set_task_recurrence(task_id: int, recurrence: str | None, db_path: Path | str | None = None) -> dict[str, Any]:
    recurrence = _check_recurrence(recurrence)
    with get_db_cursor(db_path) as cursor:
        cursor.execute("UPDATE tasks SET recurrence = ? WHERE id = ?;", (recurrence, task_id))
        if cursor.rowcount == 0:
            raise ValueError(f"Tugas dengan ID {task_id} tidak ditemukan.")
        cursor.execute("SELECT * FROM tasks WHERE id = ?;", (task_id,))
        return dict(cursor.fetchone())


def dedupe_pending_tasks(db_path: Path | str | None = None) -> int:
    """Drop duplicates among pending tasks: same title, course, type, priority, routine and due DATE.

    The time of day is ignored (generators stamp "now + 7 days", so copies differ by seconds); a different date counts
    as a different task. The oldest copy is kept; the others are marked 'dropped' (not deleted), and finished tasks are
    never touched. Returns how many were dropped.
    """
    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            UPDATE tasks SET status = 'dropped'
            WHERE status = 'todo' AND id NOT IN (
                SELECT MIN(id) FROM tasks WHERE status = 'todo'
                GROUP BY lower(trim(title)), COALESCE(course, ''), task_type, COALESCE(substr(due_at, 1, 10), ''),
                         is_important, is_urgent, COALESCE(recurrence, ''), COALESCE(available_from, '')
            );
            """
        )
        return cursor.rowcount


def drop_task_in_db(
    task_id: int,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Mark a task as dropped."""
    with get_db_cursor(db_path) as cursor:
        cursor.execute("UPDATE tasks SET status = 'dropped' WHERE id = ?;", (task_id,))
        if cursor.rowcount == 0:
            raise ValueError(f"Tugas dengan ID {task_id} tidak ditemukan.")
        cursor.execute("SELECT * FROM tasks WHERE id = ?;", (task_id,))
        row = cursor.fetchone()
        return dict(row) if row else {}


MAX_TITLE = 200
VALID_TASK_TYPES = ("assignment", "exam", "project", "roadmap", "personal")
_PRIORITY_FLAGS = {1: (1, 1), 2: (1, 0), 3: (0, 1), 4: (0, 0)}  # priority -> (important, urgent)


def update_task_in_db(
    task_id: int,
    fields: dict[str, Any],
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Edit a task. Only the fields that are sent change; validation failures write nothing. LookupError if missing."""
    allowed = {"title", "description", "course", "task_type", "due_at", "priority"}
    unknown = set(fields) - allowed
    if unknown:
        raise ValueError(f"Kolom tidak dikenal: {', '.join(sorted(unknown))}.")
    if not fields:
        raise ValueError("Tidak ada yang diubah.")
    sets: list[str] = []
    params: list[Any] = []
    for key, val in fields.items():
        if key == "title":
            if not isinstance(val, str) or not val.strip():
                raise ValueError("Judul tugas tidak boleh kosong.")
            if len(val.strip()) > MAX_TITLE:
                raise ValueError(f"Judul tugas maksimal {MAX_TITLE} karakter.")
            sets.append("title = ?"), params.append(val.strip())
        elif key in ("description", "course"):
            text = None if val is None else " ".join(str(val).split()) or None
            if text and len(text) > (2000 if key == "description" else 80):
                raise ValueError(f"{key} terlalu panjang.")
            sets.append(f"{key} = ?"), params.append(text)
        elif key == "task_type":
            if val not in VALID_TASK_TYPES:
                raise ValueError(f"Jenis tugas harus salah satu dari {', '.join(VALID_TASK_TYPES)}.")
            sets.append("task_type = ?"), params.append(val)
        elif key == "due_at":
            if val in (None, ""):
                sets.append("due_at = ?"), params.append(None)
            else:
                parsed = parse_due_date_natural(str(val))
                if not parsed:
                    raise ValueError("Tanggal tenggat tidak dikenali. Contoh: besok, 25 Oktober, 2026-10-25 14:00.")
                sets.append("due_at = ?"), params.append(parsed.strftime("%Y-%m-%d %H:%M:%S"))
        elif key == "priority":
            if val not in _PRIORITY_FLAGS:
                raise ValueError("Prioritas harus 1 (kritis) sampai 4 (santai).")
            imp, urg = _PRIORITY_FLAGS[val]
            sets.append("is_important = ?"), params.append(imp)
            sets.append("is_urgent = ?"), params.append(urg)
    with get_db_cursor(db_path) as cursor:
        cursor.execute("SELECT id FROM tasks WHERE id = ?;", (task_id,))
        if cursor.fetchone() is None:
            raise LookupError(f"Tugas dengan ID {task_id} tidak ditemukan.")
        cursor.execute(f"UPDATE tasks SET {', '.join(sets)} WHERE id = ?;", [*params, task_id])
        cursor.execute("SELECT * FROM tasks WHERE id = ?;", (task_id,))
        return dict(cursor.fetchone())


def delete_task_in_db(
    task_id: int,
    db_path: Path | str | None = None,
) -> bool:
    """Delete a task permanently from SQLite database."""
    with get_db_cursor(db_path) as cursor:
        cursor.execute("DELETE FROM tasks WHERE id = ?;", (task_id,))
        if cursor.rowcount == 0:
            raise ValueError(f"Tugas dengan ID {task_id} tidak ditemukan.")
        return True


# Document Extractor (.pdf, .docx, .pptx, .txt, .md)
def extract_text_from_file(file_path: Path | str) -> str:
    """Extract clean text content from supported academic document files."""
    p = Path(file_path).expanduser().resolve()
    if not p.exists():
        raise FileNotFoundError(f"File tidak ditemukan: {p}")

    ext = p.suffix.lower()

    if ext in (".txt", ".md", ".csv", ".py"):
        try:
            return p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return p.read_text(encoding="latin-1", errors="ignore")

    elif ext == ".docx":
        import docx
        doc = docx.Document(p)
        paragraphs = [para.text for para in doc.paragraphs if para.text.strip()]
        return "\n".join(paragraphs)

    elif ext == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(str(p))
        pages_text = []
        for page in reader.pages:
            t = page.extract_text()
            if t:
                pages_text.append(t)
        return "\n".join(pages_text)

    elif ext == ".pptx":
        from pptx import Presentation
        lines: list[str] = []
        for idx, slide in enumerate(Presentation(str(p)).slides, start=1):
            texts = [sh.text_frame.text.strip() for sh in slide.shapes if sh.has_text_frame and sh.text_frame.text.strip()]
            if texts:
                lines.append(f"[Slide {idx}] " + " | ".join(texts))
        return "\n".join(lines)

    else:
        raise ValueError(f"Format file '{ext}' belum didukung. Gunakan .pdf, .docx, .pptx, .txt, atau .md.")


def save_study_summary_in_db(
    title: str,
    source_paths: list[str],
    executive_summary: list[str],
    key_concepts: list[dict[str, str]],
    self_test: list[dict[str, str]],
    language: Literal["id", "en"] = "id",
    model_used: str | None = None,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Persist 3-structure study summary into study_summaries table."""
    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            INSERT INTO study_summaries (
                title, source_paths, language, executive_summary,
                key_concepts, self_test, model_used
            ) VALUES (?, ?, ?, ?, ?, ?, ?);
            """,
            (
                title,
                json.dumps(source_paths),
                language,
                json.dumps(executive_summary, ensure_ascii=False),
                json.dumps(key_concepts, ensure_ascii=False),
                json.dumps(self_test, ensure_ascii=False),
                model_used,
            ),
        )
        sum_id = cursor.lastrowid
        cursor.execute("SELECT * FROM study_summaries WHERE id = ?;", (sum_id,))
        row = cursor.fetchone()
        return dict(row) if row else {}


# Curated Skill Roadmaps
CURATED_ROADMAPS: dict[str, dict[str, Any]] = {
    "python_data_science": {
        "title": "Roadmap 4 Minggu: Python & Data Science Mahasiswa",
        "weeks": [
            {
                "week": 1,
                "title": "Dasar Python & NumPy",
                "goal": "Kuasai struktur data, list comprehension, manipulasi matriks dengan NumPy.",
                "resources": ["Kaggle Learn: Python", "FreeCodeCamp Python for Beginners"],
            },
            {
                "week": 2,
                "title": "Analisis & Eksplorasi Data dengan Pandas",
                "goal": "Filtering, agregasi groupby, handling missing values, pembersihan dataset CSV/Excel.",
                "resources": ["Kaggle Learn: Pandas", "Dicoding: Memulai Pemrograman dengan Python"],
            },
            {
                "week": 3,
                "title": "Visualisasi Data (Matplotlib & Seaborn)",
                "goal": "Membuat plot distribusi, korelasi heatmap, visualisasi insight riset.",
                "resources": ["Kaggle Learn: Data Visualization", "CS50 Harvard Python"],
            },
            {
                "week": 4,
                "title": "Mini Proyek Data Science Portofolio",
                "goal": "Analisis end-to-end dataset publik dan simpan di GitHub/Kaggle notebook.",
                "resources": ["Kaggle Datasets", "Coursera Financial Aid: IBM Data Science"],
            },
        ],
    },
    "web_development": {
        "title": "Roadmap 4 Minggu: Modern Web Development",
        "weeks": [
            {
                "week": 1,
                "title": "HTML5 Semantik & CSS3 Modern",
                "goal": "Responsive layout, Flexbox, Grid, dan modern aesthetics.",
                "resources": ["FreeCodeCamp Responsive Web Design", "Dicoding Dasar Pemrograman Web"],
            },
            {
                "week": 2,
                "title": "JavaScript Modern (ES6+)",
                "goal": "Async/await, DOM manipulation, Fetch API, Promise.",
                "resources": ["FreeCodeCamp JavaScript", "The Odin Project"],
            },
            {
                "week": 3,
                "title": "React & Tailwind CSS",
                "goal": "State management, Hooks, komponen reusable.",
                "resources": ["React.dev Official Tutorial", "FreeCodeCamp Front End Dev Libraries"],
            },
            {
                "week": 4,
                "title": "Fullstack API & Deploy",
                "goal": "Hubungkan React ke REST API (FastAPI) dan deploy gratis di Vercel / Render.",
                "resources": ["CS50 Web Programming with Python and JS"],
            },
        ],
    },
    "machine_learning": {
        "title": "Roadmap 4 Minggu: Dasar Machine Learning Praktis",
        "weeks": [
            {
                "week": 1,
                "title": "Supervised Learning: Regresi & Klasifikasi",
                "goal": "Linear Regression, Decision Tree, Logistic Regression dengan Scikit-Learn.",
                "resources": ["Kaggle Learn: Intro to Machine Learning", "Coursera Andrew Ng (Audit gratis)"],
            },
            {
                "week": 2,
                "title": "Model Evaluation & Feature Engineering",
                "goal": "Train-test split, Cross-Validation, F1-Score, ROC-AUC, scaling data.",
                "resources": ["Kaggle Learn: Intermediate Machine Learning"],
            },
            {
                "week": 3,
                "title": "Tree Ensemble & Random Forest / XGBoost",
                "goal": "Hyperparameter tuning, GridSearchCV, handling imbalance class.",
                "resources": ["Kaggle Learn: Feature Engineering"],
            },
            {
                "week": 4,
                "title": "Deploy Model ML Sederhana",
                "goal": "Kemasi model dengan FastAPI / Streamlit untuk demo portofolio.",
                "resources": ["Streamlit Documentation", "Dicoding Machine Learning Terapan"],
            },
        ],
    },
}


def generate_skill_roadmap(
    skill_topic: str,
    register_as_tasks: bool = True,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Generate structured student learning roadmap and optionally enroll milestones into tasks table."""
    cleaned = skill_topic.lower().strip()
    matched_key = "python_data_science"
    if "web" in cleaned or "react" in cleaned or "javascript" in cleaned or "frontend" in cleaned:
        matched_key = "web_development"
    elif "machine learning" in cleaned or "ml" in cleaned or "ai" in cleaned or "model" in cleaned:
        matched_key = "machine_learning"

    plan = CURATED_ROADMAPS[matched_key]
    registered_task_ids = []

    if register_as_tasks:
        now = datetime.datetime.now()
        for idx, w in enumerate(plan["weeks"]):
            due_target = now + datetime.timedelta(days=(idx + 1) * 7)
            title = f"Minggu {w['week']}: {w['title']}"
            # Idempotent: asking for the same roadmap again must not pile up copies of milestones still pending
            with get_db_cursor(db_path) as cursor:
                cursor.execute(
                    "SELECT id FROM tasks WHERE status = 'todo' AND task_type = 'roadmap' AND title = ? AND course = ?;",
                    (title, "Skill Roadmap Mandiri"),
                )
                existing = cursor.fetchone()
            if existing:
                registered_task_ids.append(existing["id"])
                continue
            t = add_task_in_db(
                title=title,
                description=f"Tujuan: {w['goal']}\nSumber belajar: {', '.join(w['resources'])}",
                course="Skill Roadmap Mandiri",
                task_type="roadmap",
                due_at=due_target,
                is_important=1,
                is_urgent=0,
                db_path=db_path,
            )
            registered_task_ids.append(t["id"])

    return {
        "topic": skill_topic,
        "matched_curriculum": matched_key,
        "roadmap": plan,
        "tasks_registered": registered_task_ids,
    }


# LangChain Tool wrappers with Poka-Yoke schemas
class AddTaskArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(description="Judul tugas atau pekerjaan, contoh: 'Tugas Besar Kalkulus Bab 3'")
    description: str | None = Field(default=None, description="Detail instruksi atau catatan tugas")
    course: str | None = Field(default=None, description="Nama mata kuliah atau kategori, contoh: 'Kalkulus II'")
    due_at: str | None = Field(default=None, description="Waktu tenggat/deadline, contoh: 'besok malam', '2026-10-25', 'lusa'")
    is_important: int = Field(default=1, description="1 jika penting/berbobot nilai tinggi, 0 jika sekunder")


@tool(args_schema=AddTaskArgs)
def add_task_tool(
    title: str,
    description: str | None = None,
    course: str | None = None,
    due_at: str | None = None,
    is_important: int = 1,
) -> dict[str, Any]:
    """Tambah tugas kuliah ke Eisenhower Matrix dengan penentuan otomatis kuadran prioritas."""
    try:
        task = add_task_in_db(
            title=title,
            description=description,
            course=course,
            due_at=due_at,
            is_important=is_important,
        )
        return {"status": "success", "task": task}
    except Exception as e:
        return ToolError(
            error_code="ADD_TASK_FAILED",
            message=str(e),
            hint="Pastikan judul tugas terisi dengan benar.",
        ).model_dump()


class ListTasksArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str = Field(default="todo", description="'todo', 'done', 'in_progress', atau 'all'")
    quadrant: str | None = Field(default=None, description="Filter kuadran: 'Q1_DO', 'Q2_SCHEDULE', 'Q3_DELEGATE', 'Q4_ELIMINATE'")


@tool(args_schema=ListTasksArgs)
def list_tasks_tool(status: str = "todo", quadrant: str | None = None) -> dict[str, Any]:
    """Daftar tugas mahasiswa yang dikelompokkan menurut prioritas Eisenhower Matrix."""
    try:
        tasks = list_tasks_from_db(status=status, quadrant=quadrant)
        return {"status": "success", "count": len(tasks), "tasks": tasks}
    except Exception as e:
        return ToolError(
            error_code="LIST_TASKS_FAILED",
            message=str(e),
            hint="Periksa filter kuadran atau status.",
        ).model_dump()


class CompleteTaskArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_id: int = Field(description="ID tugas yang telah diselesaikan")


@tool(args_schema=CompleteTaskArgs)
def complete_task_tool(task_id: int) -> dict[str, Any]:
    """Tandai tugas kuliah sebagai selesai (done)."""
    try:
        updated = complete_task_in_db(task_id)
        return {"status": "success", "task": updated}
    except Exception as e:
        return ToolError(
            error_code="COMPLETE_TASK_FAILED",
            message=str(e),
            hint="Periksa apakah ID tugas valid dan ada di database.",
        ).model_dump()
