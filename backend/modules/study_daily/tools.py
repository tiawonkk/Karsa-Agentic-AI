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
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Insert task into database with automatic Eisenhower Matrix quadrant calculation."""
    if not title.strip():
        raise ValueError("Judul tugas tidak boleh kosong.")

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
                is_urgent, is_important, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'todo');
            """,
            (title.strip(), description, course, task_type, due_str, effective_urgent, is_important),
        )
        task_id = cursor.lastrowid
        cursor.execute("SELECT * FROM tasks WHERE id = ?;", (task_id,))
        row = cursor.fetchone()
        return dict(row) if row else {}


def list_tasks_from_db(
    status: str = "todo",
    quadrant: str | None = None,
    course: str | None = None,
    db_path: Path | str | None = None,
) -> list[dict[str, Any]]:
    """Fetch tasks filtered by status and Eisenhower quadrant."""
    query = "SELECT * FROM tasks WHERE 1=1"
    params: list[Any] = []

    if status != "all":
        query += " AND status = ?"
        params.append(status)

    if quadrant:
        query += " AND quadrant = ?"
        params.append(quadrant)

    if course:
        query += " AND course LIKE ?"
        params.append(f"%{course}%")

    query += " ORDER BY is_urgent DESC, due_at ASC, id ASC"

    with get_db_cursor(db_path) as cursor:
        cursor.execute(query, params)
        rows = cursor.fetchall()
        return [dict(r) for r in rows]


def complete_task_in_db(
    task_id: int,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Mark a task as done with completion timestamp."""
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
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
        row = cursor.fetchone()
        return dict(row) if row else {}


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


# Document Extractor (.pdf, .docx, .txt, .md)
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

    else:
        raise ValueError(f"Format file '{ext}' belum didukung. Gunakan .pdf, .docx, .txt, atau .md.")


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
            t = add_task_in_db(
                title=f"Minggu {w['week']}: {w['title']}",
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
            actionable_hint="Pastikan judul tugas terisi dengan benar.",
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
            actionable_hint="Periksa filter kuadran atau status.",
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
            actionable_hint="Periksa apakah ID tugas valid dan ada di database.",
        ).model_dump()
