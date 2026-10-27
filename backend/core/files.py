"""Real file uploads for the agent workspaces (PRD documents, datasets, receipts, chat attachments).

Files are copied into `~/.karsa/uploads/files/<kind>/`. Paths sent back by the browser are only trusted when they
resolve inside that folder (`resolve_upload`), so an API caller cannot point the cleaner at arbitrary files.
"""

from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Any

from backend.core.config import settings

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_PRD_CHARS = 60_000

ALLOWED: dict[str, tuple[str, ...]] = {
    "prd": (".pdf", ".docx", ".md", ".txt"),
    "dataset": (".csv", ".xlsx", ".xls", ".json"),
    "notebook": (".pdf", ".docx", ".pptx", ".txt", ".md"),
    "receipt": (".png", ".jpg", ".jpeg", ".webp"),
    "chat": (".pdf", ".docx", ".pptx", ".txt", ".md", ".csv", ".xlsx", ".xls", ".json", ".png", ".jpg", ".jpeg", ".webp"),
}


class UploadError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def root() -> Path:
    return settings.uploads_dir / "files"


def safe_name(name: str) -> str:
    n = Path(str(name or "berkas")).name
    n = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", n).strip(" .") or "berkas"
    return n[:120]


def save_upload(kind: str, filename: str, data: bytes) -> Path:
    if kind not in ALLOWED:
        raise UploadError("Jenis unggahan tidak dikenal.", 422)
    if not data:
        raise UploadError("File kosong.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise UploadError("Ukuran file maksimal 50 MB.", 413)
    name = safe_name(filename)
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED[kind]:
        raise UploadError(f"Format {ext or 'ini'} tidak didukung di sini. Gunakan: {', '.join(ALLOWED[kind])}.", 415)
    folder = root() / kind
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / name
    if target.exists():
        target = folder / f"{target.stem}_{time.strftime('%Y%m%d_%H%M%S')}{ext}"
    target.write_bytes(data)
    return target


def resolve_upload(path: str) -> Path:
    """A previously uploaded file; anything outside the upload folder is refused."""
    p = Path(str(path or "")).expanduser()
    try:
        p = p.resolve()
    except OSError:
        raise UploadError("Path tidak valid.", 422)
    base = root().resolve()
    if base not in p.parents or not p.is_file():
        raise UploadError("File tidak ditemukan di daftar unggahan Karsa.", 404)
    return p


def prd_summary(text: str) -> dict[str, Any]:
    """Headline view of a PRD: title, section headings and size (deterministic, no model)."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    headings = [re.sub(r"^#+\s*", "", ln) for ln in lines if re.match(r"^#{1,3}\s+\S", ln)]
    if not headings:  # PDF/DOCX text has no markdown marks: short Title-Case/numbered lines are the likely headings
        headings = [ln for ln in lines if len(ln) <= 70 and (re.match(r"^\d+(\.\d+)*[.)]?\s+\S", ln) or ln.isupper())][:20]
    title = headings[0] if headings else (lines[0][:80] if lines else "")
    return {"title": title, "headings": headings[:30], "chars": len(text), "lines": len(lines)}


def extract_prd(path: Path) -> dict[str, Any]:
    from backend.modules.study_daily.tools import extract_text_from_file

    try:
        text = extract_text_from_file(path)
    except Exception as e:
        raise UploadError(f"Dokumen PRD tidak bisa dibaca: {str(e)[:120]}", 422)
    if not text.strip():
        raise UploadError("Dokumen tidak berisi teks yang bisa diekstrak (mungkin hasil scan/gambar).", 422)
    truncated = len(text) > MAX_PRD_CHARS
    text = text[:MAX_PRD_CHARS]
    return {"text": text, "truncated": truncated, "summary": prd_summary(text)}


def dataset_preview(path: Path, rows: int = 10) -> dict[str, Any]:
    """Real numbers from the original file: shape, dtypes, missing values, duplicates, first rows."""
    import pandas as pd

    ext = path.suffix.lower()
    try:
        if ext == ".csv":
            try:
                df = pd.read_csv(path, sep=None, engine="python", encoding="utf-8-sig")
            except UnicodeDecodeError:
                df = pd.read_csv(path, sep=None, engine="python", encoding="latin-1")
        elif ext in (".xlsx", ".xls"):
            df = pd.read_excel(path)
        else:
            df = pd.read_json(path)
    except Exception as e:
        raise UploadError(f"Dataset tidak bisa dibaca: {str(e)[:120]}", 422)
    head = df.head(rows).astype(object).where(df.head(rows).notna(), None)
    cols = [
        {"name": str(c), "dtype": str(df[c].dtype), "missing": int(df[c].isna().sum()), "unique": int(df[c].nunique(dropna=True))}
        for c in df.columns
    ]
    return {
        "rows": int(len(df)),
        "columns": int(df.shape[1]),
        "missing_total": int(df.isna().sum().sum()),
        "duplicates": int(df.duplicated().sum()),
        "column_info": cols,
        "head": [{str(k): (None if v is None else str(v)) for k, v in r.items()} for r in head.to_dict(orient="records")],
    }


def clean_dataset(path: Path, options: dict[str, Any] | None, out_dir: Path, formats: tuple[str, ...] = ("csv", "xlsx")) -> dict[str, Any]:
    """Clean the original (never modified) and write `<name>_clean.csv/.xlsx` into `out_dir` without overwriting."""
    from backend.modules.notebook import dataset_cleaner as dc

    opts = dc.CleanOptions.from_dict(options)
    cleaned, report = dc.clean_dataframe(dc.load_dataset(path), opts)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    written: list[dict[str, str]] = []
    for fmt in formats:
        ext = ".xlsx" if fmt == "xlsx" else ".csv"
        out = out_dir / f"{path.stem}_clean{ext}"
        if out.exists():
            out = out_dir / f"{path.stem}_clean_{stamp}{ext}"
        if ext == ".csv":
            cleaned.to_csv(out, index=False, encoding="utf-8")
        else:
            cleaned.to_excel(out, index=False)
        written.append({"format": fmt, "path": str(out), "name": out.name})
    sample = cleaned.head(10).astype(object).where(cleaned.head(10).notna(), None)
    report["files"] = written
    report["sample"] = [{str(k): (None if v is None else str(v)) for k, v in r.items()} for r in sample.to_dict(orient="records")]
    report["columns_after"] = [str(c) for c in cleaned.columns]
    return report
