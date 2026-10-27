"""SQLite access for the Studio hub (projects/business ideas) and the PRD-to-App builds."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from backend.core.database import get_db_cursor


class StudioError(ValueError):
    def __init__(self, message: str, code: str = "bad_request") -> None:
        super().__init__(message)
        self.code = code


def _loads(raw: str | None, default: Any) -> Any:
    try:
        return json.loads(raw) if raw else default
    except ValueError:
        return default


def _project(row: Any) -> dict[str, Any]:
    d = dict(row)
    d["data"] = _loads(d.get("data"), {})
    return d


def _clean_name(name: str) -> str:
    n = " ".join((name or "").split())
    if not n:
        raise StudioError("Nama tidak boleh kosong.")
    if len(n) > 120:
        raise StudioError("Nama maksimal 120 karakter.")
    return n


# ------------------------------------------------------------------------------------------------ projects
def create_project(kind: str, name: str, topic: str | None = None, data: dict[str, Any] | None = None, db_path: Path | str | None = None) -> dict[str, Any]:
    if kind not in ("project", "business"):
        raise StudioError("Jenis harus project atau business.")
    with get_db_cursor(db_path) as cur:
        cur.execute(
            "INSERT INTO studio_projects (kind, name, topic, data) VALUES (?, ?, ?, ?);",
            (kind, _clean_name(name), (topic or "").strip()[:2000] or None, json.dumps(data or {})),
        )
        cur.execute("SELECT * FROM studio_projects WHERE id = ?;", (cur.lastrowid,))
        return _project(cur.fetchone())


def get_project(project_id: int, db_path: Path | str | None = None) -> dict[str, Any]:
    with get_db_cursor(db_path) as cur:
        cur.execute("SELECT * FROM studio_projects WHERE id = ?;", (project_id,))
        row = cur.fetchone()
    if not row:
        raise StudioError("Proyek tidak ditemukan.", "not_found")
    return _project(row)


def list_projects(kind: str | None = None, db_path: Path | str | None = None) -> list[dict[str, Any]]:
    with get_db_cursor(db_path) as cur:
        if kind:
            cur.execute("SELECT * FROM studio_projects WHERE kind = ? ORDER BY updated_at DESC, id DESC;", (kind,))
        else:
            cur.execute("SELECT * FROM studio_projects ORDER BY updated_at DESC, id DESC;")
        return [_project(r) for r in cur.fetchall()]


def update_project_data(project_id: int, patch: dict[str, Any], db_path: Path | str | None = None) -> dict[str, Any]:
    """Merge `patch` into the stored document (top-level keys)."""
    cur_data = get_project(project_id, db_path)["data"]
    cur_data.update(patch)
    with get_db_cursor(db_path) as cur:
        cur.execute(
            "UPDATE studio_projects SET data = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?;",
            (json.dumps(cur_data), project_id),
        )
    return get_project(project_id, db_path)


def delete_project(project_id: int, db_path: Path | str | None = None) -> None:
    with get_db_cursor(db_path) as cur:
        cur.execute("DELETE FROM studio_projects WHERE id = ?;", (project_id,))
        if cur.rowcount == 0:
            raise StudioError("Proyek tidak ditemukan.", "not_found")


# ------------------------------------------------------------------------------------------------ app builds
def _build(row: Any) -> dict[str, Any]:
    d = dict(row)
    d["plan"] = _loads(d.get("plan"), {})
    d["log"] = _loads(d.get("log"), [])
    return d


def create_build(name: str, prd: str, target_dir: str, source_project_id: int | None = None, db_path: Path | str | None = None) -> dict[str, Any]:
    prd = (prd or "").strip()
    if len(prd) < 20:
        raise StudioError("PRD terlalu pendek: tulis minimal tujuan, fitur utama, dan pengguna.")
    if len(prd) > 60_000:
        raise StudioError("PRD maksimal 60.000 karakter.")
    with get_db_cursor(db_path) as cur:
        cur.execute(
            "INSERT INTO app_builds (name, prd, target_dir, source_project_id) VALUES (?, ?, ?, ?);",
            (_clean_name(name), prd, target_dir, source_project_id),
        )
        cur.execute("SELECT * FROM app_builds WHERE id = ?;", (cur.lastrowid,))
        return _build(cur.fetchone())


def get_build(build_id: int, db_path: Path | str | None = None) -> dict[str, Any]:
    with get_db_cursor(db_path) as cur:
        cur.execute("SELECT * FROM app_builds WHERE id = ?;", (build_id,))
        row = cur.fetchone()
    if not row:
        raise StudioError("Build tidak ditemukan.", "not_found")
    return _build(row)


def list_builds(db_path: Path | str | None = None) -> list[dict[str, Any]]:
    with get_db_cursor(db_path) as cur:
        cur.execute("SELECT * FROM app_builds ORDER BY updated_at DESC, id DESC;")
        return [_build(r) for r in cur.fetchall()]


def save_build(build_id: int, *, status: str | None = None, plan: dict[str, Any] | None = None, log_entry: dict[str, Any] | None = None, db_path: Path | str | None = None) -> dict[str, Any]:
    b = get_build(build_id, db_path)
    log = b["log"]
    if log_entry:
        log.append(log_entry)
    with get_db_cursor(db_path) as cur:
        cur.execute(
            "UPDATE app_builds SET status = ?, plan = ?, log = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?;",
            (status or b["status"], json.dumps(plan if plan is not None else b["plan"]), json.dumps(log[-200:]), build_id),
        )
    return get_build(build_id, db_path)


def delete_build(build_id: int, db_path: Path | str | None = None) -> None:
    with get_db_cursor(db_path) as cur:
        cur.execute("DELETE FROM app_builds WHERE id = ?;", (build_id,))
        if cur.rowcount == 0:
            raise StudioError("Build tidak ditemukan.", "not_found")
