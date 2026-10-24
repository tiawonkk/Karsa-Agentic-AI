"""SQLite persistence for Notebook (notebooks, sources, chunks). Mirrors the helper style in core/database.py."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from backend.core.database import get_db_cursor
from backend.modules.notebook.retrieval import chunk_text

SourceKind = Literal["document", "dataset", "text"]


class NotebookError(Exception):
    """User-facing (Indonesian) error. `code` maps to an HTTP status in the API."""

    def __init__(self, message: str, code: str = "invalid") -> None:
        super().__init__(message)
        self.code = code


def create_notebook(title: str, db_path: Path | str | None = None) -> dict[str, Any]:
    title = (title or "").strip()[:80]
    if not title:
        raise NotebookError("Judul notebook tidak boleh kosong.")
    with get_db_cursor(db_path) as cur:
        cur.execute("INSERT INTO notebooks (title) VALUES (?);", (title,))
        nid = cur.lastrowid
        cur.execute("SELECT * FROM notebooks WHERE id = ?;", (nid,))
        return dict(cur.fetchone())


def list_notebooks(db_path: Path | str | None = None) -> list[dict[str, Any]]:
    with get_db_cursor(db_path) as cur:
        cur.execute(
            """
            SELECT n.id, n.title, n.created_at,
                   (SELECT COUNT(*) FROM notebook_sources s WHERE s.notebook_id = n.id) AS source_count
            FROM notebooks n ORDER BY n.id DESC;
            """
        )
        return [dict(r) for r in cur.fetchall()]


def get_notebook(notebook_id: int, db_path: Path | str | None = None) -> dict[str, Any]:
    with get_db_cursor(db_path) as cur:
        cur.execute("SELECT * FROM notebooks WHERE id = ?;", (notebook_id,))
        row = cur.fetchone()
        if not row:
            raise NotebookError("Notebook tidak ditemukan.", "not_found")
        nb = dict(row)
        cur.execute("SELECT * FROM notebook_sources WHERE notebook_id = ? ORDER BY id;", (notebook_id,))
        nb["sources"] = [dict(r) for r in cur.fetchall()]
        return nb


def delete_notebook(notebook_id: int, db_path: Path | str | None = None) -> None:
    with get_db_cursor(db_path) as cur:
        cur.execute("DELETE FROM notebook_chunks WHERE notebook_id = ?;", (notebook_id,))
        cur.execute("DELETE FROM notebook_sources WHERE notebook_id = ?;", (notebook_id,))
        cur.execute("DELETE FROM notebooks WHERE id = ?;", (notebook_id,))


def add_source(
    notebook_id: int,
    name: str,
    kind: SourceKind,
    text: str,
    path: str | None = None,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Store a source and index its text as chunks. Datasets pass a compact PROFILE as `text`, never raw rows."""
    get_notebook(notebook_id, db_path)  # raises if the notebook does not exist
    text = (text or "").strip()
    if not text:
        raise NotebookError("Sumber tidak berisi teks yang bisa dibaca.")
    chunks = chunk_text(text)
    with get_db_cursor(db_path) as cur:
        cur.execute(
            "INSERT INTO notebook_sources (notebook_id, name, kind, path, char_count) VALUES (?, ?, ?, ?, ?);",
            (notebook_id, name[:120], kind, path, len(text)),
        )
        sid = cur.lastrowid
        cur.executemany(
            "INSERT INTO notebook_chunks (source_id, notebook_id, idx, text) VALUES (?, ?, ?, ?);",
            [(sid, notebook_id, i, c) for i, c in enumerate(chunks)],
        )
        cur.execute("SELECT * FROM notebook_sources WHERE id = ?;", (sid,))
        src = dict(cur.fetchone())
    src["chunk_count"] = len(chunks)
    return src


def remove_source(source_id: int, db_path: Path | str | None = None) -> None:
    with get_db_cursor(db_path) as cur:
        cur.execute("DELETE FROM notebook_chunks WHERE source_id = ?;", (source_id,))
        cur.execute("DELETE FROM notebook_sources WHERE id = ?;", (source_id,))


def get_source(source_id: int, db_path: Path | str | None = None) -> dict[str, Any]:
    with get_db_cursor(db_path) as cur:
        cur.execute("SELECT * FROM notebook_sources WHERE id = ?;", (source_id,))
        row = cur.fetchone()
        if not row:
            raise NotebookError("Sumber tidak ditemukan.", "not_found")
        return dict(row)


def load_chunks(notebook_id: int, db_path: Path | str | None = None) -> list[dict[str, Any]]:
    """All chunks of a notebook with their source info, in reading order."""
    with get_db_cursor(db_path) as cur:
        cur.execute(
            """
            SELECT c.id AS chunk_id, c.source_id, c.idx, c.text, s.name AS source, s.kind
            FROM notebook_chunks c JOIN notebook_sources s ON s.id = c.source_id
            WHERE c.notebook_id = ? ORDER BY c.source_id, c.idx;
            """,
            (notebook_id,),
        )
        return [dict(r) for r in cur.fetchall()]
