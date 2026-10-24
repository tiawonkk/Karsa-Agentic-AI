"""Deterministic dataset cleaner for the Notebook (no LLM, no network).

Preview first, apply second: `clean_dataframe` returns the cleaned frame plus a step-by-step report; nothing touches
the original file. Raw rows never go to an LLM: only the compact profile text (`profile_text`) is indexed as a source.
"""
from __future__ import annotations

import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

import numpy as np
import pandas as pd

from backend.core.config import settings
from backend.modules.notebook.store import NotebookError

MISSING_TOKENS = {"", "-", "--", "n/a", "na", "nan", "null", "none", "nil", "tidak ada", "?", "#n/a", "kosong"}
DATE_HINTS = ("tanggal", "tgl", "date", "waktu", "time", "tahun_bulan")
_DATE_LIKE = re.compile(r"^\s*\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?\s*$")
MAX_ROWS = 500_000


@dataclass
class CleanOptions:
    normalize_headers: bool = True
    strip_text: bool = True
    missing_tokens: bool = True
    drop_empty: bool = True
    drop_duplicates: bool = True
    coerce_numeric: bool = True
    parse_dates: bool = True
    # Imputation changes data, so it is OFF unless asked for.
    fill_missing: Literal["none", "median", "mode", "drop"] = "none"

    @staticmethod
    def from_dict(d: dict[str, Any] | None) -> "CleanOptions":
        d = d or {}
        known = {k: v for k, v in d.items() if k in CleanOptions.__dataclass_fields__}
        opts = CleanOptions(**known)
        if opts.fill_missing not in ("none", "median", "mode", "drop"):
            raise NotebookError("Opsi fill_missing harus none, median, mode, atau drop.")
        return opts


def load_dataset(path: Path | str) -> pd.DataFrame:
    p = Path(path)
    if not p.exists():
        raise NotebookError("File dataset tidak ditemukan.", "not_found")
    ext = p.suffix.lower()
    try:
        if ext == ".csv":
            try:
                df = pd.read_csv(p, dtype=str, keep_default_na=False, sep=None, engine="python", encoding="utf-8-sig")
            except UnicodeDecodeError:
                df = pd.read_csv(p, dtype=str, keep_default_na=False, sep=None, engine="python", encoding="latin-1")
        elif ext in (".xlsx", ".xls"):
            df = pd.read_excel(p, dtype=str, keep_default_na=False)
        else:
            raise NotebookError("Format dataset harus .csv atau .xlsx.")
    except NotebookError:
        raise
    except Exception as e:
        raise NotebookError(f"Dataset tidak bisa dibaca: {str(e)[:120]}")
    if len(df) > MAX_ROWS:
        raise NotebookError(f"Dataset terlalu besar untuk dibersihkan di sini (maksimal {MAX_ROWS:,} baris).")
    return df


def _snake(name: str, taken: set[str]) -> str:
    s = re.sub(r"[^0-9A-Za-z]+", "_", str(name).strip()).strip("_").lower() or "kolom"
    if s[0].isdigit():
        s = f"k_{s}"
    base, i = s, 2
    while s in taken:
        s, i = f"{base}_{i}", i + 1
    return s


def parse_number(value: str) -> float | None:
    """Parse '25.000', 'Rp 1.250.000', '12,5%', '1,234.56', '1.234,56'. Indonesian grouping is assumed for '1.234'."""
    s = str(value).strip()
    if not s:
        return None
    neg = s.startswith("(") and s.endswith(")") or s.startswith("-")
    s = re.sub(r"(?i)^\(?-?\s*(rp\.?|idr|usd|\$|€)?\s*", "", s).rstrip(")").rstrip("%").strip()
    if not re.fullmatch(r"[\d.,]+", s) or not re.search(r"\d", s):
        return None
    if "." in s and "," in s:
        dec = "." if s.rfind(".") > s.rfind(",") else ","
        grp = "," if dec == "." else "."
        s = s.replace(grp, "").replace(dec, ".")
    elif "," in s:
        s = s.replace(",", "") if re.fullmatch(r"\d{1,3}(,\d{3})+", s) else s.replace(",", ".")
    elif "." in s and re.fullmatch(r"\d{1,3}(\.\d{3})+", s):
        s = s.replace(".", "")  # Indonesian thousands separator
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def clean_dataframe(df: pd.DataFrame, opts: CleanOptions) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Apply the enabled steps in a fixed order; return (cleaned copy, report)."""
    df = df.copy()
    before = {"rows": int(df.shape[0]), "columns": int(df.shape[1])}
    steps: list[dict[str, Any]] = []
    columns_report: dict[str, dict[str, Any]] = {}

    def step(name: str, detail: str, count: int = 0) -> None:
        steps.append({"step": name, "detail": detail, "count": int(count)})

    # 1. headers -> snake_case
    if opts.normalize_headers:
        taken: set[str] = set()
        renames = {}
        for c in df.columns:
            new = _snake(c, taken)
            taken.add(new)
            if new != c:
                renames[c] = new
        df.columns = [renames.get(c, c) for c in df.columns]
        if renames:
            step("normalize_headers", "Nama kolom dibuat snake_case: " + ", ".join(f"{a}→{b}" for a, b in list(renames.items())[:6]), len(renames))
            for old, new in renames.items():
                columns_report.setdefault(new, {})["renamed_from"] = old

    obj_cols = list(df.columns)
    # 2. strip whitespace (incl. non-breaking spaces and collapsed inner spaces)
    if opts.strip_text:
        changed = 0
        for c in obj_cols:
            s = df[c].astype(str)
            cleaned = s.str.replace(" ", " ", regex=False).str.replace(r"\s+", " ", regex=True).str.strip()
            changed += int((cleaned != s).sum())
            df[c] = cleaned
        if changed:
            step("strip_text", "Spasi berlebih di awal/akhir/tengah teks dirapikan", changed)

    # 3. missing tokens -> NaN
    if opts.missing_tokens:
        total = 0
        for c in obj_cols:
            mask = df[c].astype(str).str.strip().str.lower().isin(MISSING_TOKENS)
            total += int(mask.sum())
            df.loc[mask, c] = np.nan
        if total:
            step("missing_tokens", "Penanda kosong ('-', 'N/A', 'null', '') dijadikan nilai kosong", total)

    # 4. empty rows / columns
    if opts.drop_empty:
        empty_cols = [c for c in df.columns if df[c].isna().all()]
        if empty_cols:
            df = df.drop(columns=empty_cols)
            step("drop_empty_columns", "Kolom kosong dihapus: " + ", ".join(map(str, empty_cols[:6])), len(empty_cols))
        n = len(df)
        df = df.dropna(how="all")
        if n - len(df):
            step("drop_empty_rows", "Baris yang seluruhnya kosong dihapus", n - len(df))

    # 5. numeric coercion (>=80% of non-empty values must parse)
    if opts.coerce_numeric:
        for c in list(df.columns):
            vals = df[c].dropna().astype(str)
            if vals.empty:
                continue
            parsed = vals.map(parse_number)
            if parsed.notna().mean() >= 0.8 and not vals.map(lambda v: bool(_DATE_LIKE.match(v))).mean() > 0.5:
                out = pd.Series(np.nan, index=df.index, dtype="float64")
                out.loc[vals.index] = parsed.astype("float64")
                bad = int(parsed.isna().sum())
                if (out.dropna() % 1 == 0).all():
                    out = out.astype("Int64")
                df[c] = out
                step("coerce_numeric", f"Kolom '{c}' diubah ke angka" + (f" ({bad} nilai tidak terbaca → kosong)" if bad else ""), int(parsed.notna().sum()))
                columns_report.setdefault(str(c), {})["type"] = "numeric"

    # 6. dates -> ISO (YYYY-MM-DD)
    if opts.parse_dates:
        for c in list(df.columns):
            if pd.api.types.is_numeric_dtype(df[c]):
                continue
            vals = df[c].dropna().astype(str)
            if vals.empty:
                continue
            looks = vals.map(lambda v: bool(_DATE_LIKE.match(v))).mean()
            hinted = any(h in str(c).lower() for h in DATE_HINTS)
            if looks >= 0.8 or (hinted and looks >= 0.5):
                parsed = pd.to_datetime(vals, dayfirst=True, errors="coerce")
                if parsed.notna().mean() >= 0.8:
                    out = pd.Series(np.nan, index=df.index, dtype="object")
                    out.loc[vals.index] = parsed.dt.strftime("%Y-%m-%d")
                    df[c] = out
                    step("parse_dates", f"Kolom '{c}' dinormalkan ke format YYYY-MM-DD (hari-bulan-tahun dibaca hari dulu)", int(parsed.notna().sum()))
                    columns_report.setdefault(str(c), {})["type"] = "date"

    # 7. duplicates
    if opts.drop_duplicates:
        n = len(df)
        df = df.drop_duplicates()
        if n - len(df):
            step("drop_duplicates", "Baris duplikat persis dihapus (baris pertama dipertahankan)", n - len(df))

    # 8. optional missing-value handling
    if opts.fill_missing != "none":
        if opts.fill_missing == "drop":
            n = len(df)
            df = df.dropna()
            step("drop_missing_rows", "Baris dengan nilai kosong dihapus", n - len(df))
        else:
            filled = 0
            for c in df.columns:
                miss = int(df[c].isna().sum())
                if not miss:
                    continue
                if pd.api.types.is_numeric_dtype(df[c]) and opts.fill_missing == "median":
                    df[c] = df[c].fillna(df[c].median())
                    filled += miss
                else:
                    mode = df[c].mode(dropna=True)
                    if not mode.empty:
                        df[c] = df[c].fillna(mode.iloc[0])
                        filled += miss
            step("fill_missing", f"Nilai kosong diisi ({opts.fill_missing}: median untuk angka, modus untuk teks)", filled)

    # 9. outliers: reported only, never modified (IQR rule)
    outliers: dict[str, int] = {}
    for c in df.columns:
        if pd.api.types.is_numeric_dtype(df[c]):
            col = pd.to_numeric(df[c], errors="coerce").dropna().astype(float)
            if len(col) >= 8:
                q1, q3 = col.quantile(0.25), col.quantile(0.75)
                iqr = q3 - q1
                if iqr > 0:
                    n_out = int(((col < q1 - 1.5 * iqr) | (col > q3 + 1.5 * iqr)).sum())
                    if n_out:
                        outliers[str(c)] = n_out
    if outliers:
        step("flag_outliers", "Pencilan (aturan IQR) hanya ditandai, tidak diubah: " + ", ".join(f"{k} ({v})" for k, v in list(outliers.items())[:5]), sum(outliers.values()))

    after = {"rows": int(df.shape[0]), "columns": int(df.shape[1])}
    missing_left = {str(c): int(n) for c, n in df.isna().sum().items() if n}
    report = {
        "before": before,
        "after": after,
        "steps": steps,
        "missing_remaining": missing_left,
        "outliers": outliers,
        "columns": columns_report,
        "options": asdict(opts),
    }
    return df, report


def preview(path: Path | str, options: dict[str, Any] | None = None) -> dict[str, Any]:
    """Dry run: the report plus 5 cleaned sample rows. The original file is untouched."""
    opts = CleanOptions.from_dict(options)
    cleaned, report = clean_dataframe(load_dataset(path), opts)
    sample = cleaned.head(5).astype(object).where(cleaned.head(5).notna(), None)
    report["sample"] = sample.to_dict(orient="records")
    report["columns_after"] = [str(c) for c in cleaned.columns]
    return report


def apply_clean(path: Path | str, options: dict[str, Any] | None = None, out_dir: Path | None = None) -> dict[str, Any]:
    """Write `<name>_clean.<ext>` (never overwrites; adds a timestamp if the name is taken). Original stays as is."""
    p = Path(path)
    opts = CleanOptions.from_dict(options)
    cleaned, report = clean_dataframe(load_dataset(p), opts)
    out_dir = out_dir or settings.outputs_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    ext = ".xlsx" if p.suffix.lower() in (".xlsx", ".xls") else ".csv"
    out = out_dir / f"{p.stem}_clean{ext}"
    if out.exists():
        out = out_dir / f"{p.stem}_clean_{time.strftime('%Y%m%d_%H%M%S')}{ext}"
    if ext == ".csv":
        cleaned.to_csv(out, index=False, encoding="utf-8")
    else:
        cleaned.to_excel(out, index=False)
    report["output_path"] = str(out)
    report["output_name"] = out.name
    return report


def profile_text(path: Path | str, max_columns: int = 40) -> str:
    """Compact text profile (columns, types, missing, numeric stats). This is what gets indexed and shown to the LLM."""
    p = Path(path)
    df = load_dataset(p)
    cleaned, _ = clean_dataframe(df, CleanOptions(fill_missing="none", drop_duplicates=False, drop_empty=False))
    lines = [
        f"Dataset: {p.name}",
        f"Jumlah baris: {len(cleaned)}; jumlah kolom: {cleaned.shape[1]}",
        f"Baris duplikat: {int(cleaned.duplicated().sum())}",
        "Kolom:",
    ]
    for c in list(cleaned.columns)[:max_columns]:
        s = cleaned[c]
        miss = int(s.isna().sum())
        if pd.api.types.is_numeric_dtype(s) and s.notna().any():
            num = pd.to_numeric(s, errors="coerce").astype(float)
            lines.append(
                f"- {c} (angka): min {num.min():g}, median {num.median():g}, rata-rata {num.mean():.4g}, maks {num.max():g}; kosong {miss}"
            )
        else:
            uniq = int(s.nunique(dropna=True))
            top = s.mode(dropna=True)
            hint = f"; paling sering '{str(top.iloc[0])[:40]}'" if not top.empty else ""
            lines.append(f"- {c} (teks, {uniq} nilai unik{hint}); kosong {miss}")
    if cleaned.shape[1] > max_columns:
        lines.append(f"... {cleaned.shape[1] - max_columns} kolom lain tidak ditampilkan")
    return "\n".join(lines)
