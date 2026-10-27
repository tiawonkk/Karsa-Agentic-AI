"""Smart File Shelf: a temporary tray for any file (drag in, drag out, hand to the AI).

Files are copied to ~/.karsa/uploads/shelf and tracked in `shelf_files`. Reading text for the AI is deterministic
(documents via the study extractor, datasets as a compact profile, images are not read here).
"""
from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Any

from backend.core.config import settings
from backend.core.database import add_shelf_file, get_db_cursor, list_shelf_files, remove_shelf_file

MAX_SHELF_BYTES = 50 * 1024 * 1024
MAX_SHELF_FILES = 60
TEXT_EXTS = {".txt", ".md", ".pdf", ".docx", ".pptx"}
DATASET_EXTS = {".csv", ".xlsx", ".xls"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


class ShelfError(Exception):
    def __init__(self, message: str, code: str = "bad_request") -> None:
        super().__init__(message)
        self.code = code


def shelf_dir() -> Path:
    d = settings.uploads_dir / "shelf"
    d.mkdir(parents=True, exist_ok=True)
    return d


def safe_name(name: str) -> str:
    base = Path(name or "file").name
    base = re.sub(r"[^\w.\- ()]", "_", base).strip(" .") or "file"
    return base[:120]


def kind_of(name: str) -> str:
    ext = Path(name).suffix.lower()
    if ext in IMAGE_EXTS:
        return "image"
    if ext in DATASET_EXTS:
        return "dataset"
    if ext in TEXT_EXTS:
        return "document"
    return "other"


def _public(row: dict[str, Any]) -> dict[str, Any]:
    p = Path(row["file_path"])
    size = p.stat().st_size if p.exists() else 0
    return {
        "id": row["id"],
        "name": row["file_name"],
        "type": row["file_type"],
        "size": size,
        "added_at": row["added_at"],
        "exists": p.exists(),
    }


def add_bytes(filename: str, data: bytes) -> dict[str, Any]:
    if not data:
        raise ShelfError("File kosong.")
    if len(data) > MAX_SHELF_BYTES:
        raise ShelfError("Ukuran file maksimal 50 MB.", "too_large")
    if len(list_shelf_files(limit=MAX_SHELF_FILES + 1)) >= MAX_SHELF_FILES:
        raise ShelfError(f"Laci penuh ({MAX_SHELF_FILES} file). Hapus beberapa dulu.", "full")
    name = safe_name(filename)
    target = shelf_dir() / name
    if target.exists():
        target = shelf_dir() / f"{target.stem}_{time.strftime('%H%M%S')}{target.suffix}"
    target.write_bytes(data)
    row = add_shelf_file(file_path=str(target), file_name=name, file_type=kind_of(name))
    return _public(row if "file_path" in row else {**row, "file_path": str(target), "file_name": name, "file_type": kind_of(name)})


def list_files(limit: int = 60) -> list[dict[str, Any]]:
    return [_public(r) for r in list_shelf_files(limit=limit)]


def get_row(shelf_id: int) -> dict[str, Any]:
    with get_db_cursor() as cursor:
        cursor.execute("SELECT * FROM shelf_files WHERE id = ?;", (shelf_id,))
        row = cursor.fetchone()
    if not row:
        raise ShelfError("File tidak ada di laci.", "not_found")
    return dict(row)


def file_path_of(shelf_id: int) -> tuple[Path, str]:
    row = get_row(shelf_id)
    p = Path(row["file_path"])
    if not p.exists():
        raise ShelfError("File sudah tidak ada di disk.", "not_found")
    return p, row["file_name"]


def remove(shelf_id: int) -> bool:
    try:
        row = get_row(shelf_id)
    except ShelfError:
        return False
    p = Path(row["file_path"])
    try:
        # only ever delete inside the shelf folder, whatever the row says
        if p.exists() and shelf_dir().resolve() in p.resolve().parents:
            p.unlink()
    except OSError:
        pass
    return remove_shelf_file(shelf_id)


def extract_text(shelf_id: int, limit: int = 6000) -> dict[str, Any]:
    """Text the AI can read from a shelf file; datasets give a compact profile (never raw rows)."""
    p, name = file_path_of(shelf_id)
    ext = p.suffix.lower()
    if ext in DATASET_EXTS:
        from backend.modules.notebook import dataset_cleaner

        text = dataset_cleaner.profile_text(p)
        kind = "dataset"
    elif ext in TEXT_EXTS:
        from backend.modules.study_daily.tools import extract_text_from_file

        try:
            text = extract_text_from_file(p)
        except Exception as e:
            raise ShelfError(f"Dokumen tidak bisa dibaca: {str(e)[:120]}")
        kind = "document"
    elif ext in IMAGE_EXTS:
        raise ShelfError("Gambar belum bisa dibaca di sini. Jatuhkan ke Finance jika itu struk.", "unsupported")
    else:
        raise ShelfError("Format ini tidak bisa dibaca AI. Tersedia: PDF, DOCX, PPTX, TXT, MD, CSV, XLSX.", "unsupported")
    text = text.strip()
    if not text:
        raise ShelfError("File tidak berisi teks yang bisa dibaca (mungkin hasil scan).", "empty")
    return {"name": name, "kind": kind, "text": text[:limit], "truncated": len(text) > limit, "chars": len(text)}
