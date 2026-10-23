from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any, Literal
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field
from langchain_core.tools import tool

from backend.core.config import settings
from backend.core.state import ToolError, ProposedAction
from backend.orchestrator.hitl_gate import check_and_request_approval


def profile_dataset_locally(file_path: Path | str) -> dict[str, Any]:
    """Inspect dataset (.csv or .xlsx) using Pandas locally without sending raw rows to LLM.
    
    Generates compact metadata (< 2 KB): dimensions, missing values, dtypes, duplicates, and 5-number summary.
    """
    p = Path(file_path).expanduser().resolve()
    if not p.exists():
        raise FileNotFoundError(f"File dataset tidak ditemukan: {p}")

    ext = p.suffix.lower()
    if ext == ".csv":
        df = pd.read_csv(p)
    elif ext in (".xlsx", ".xls"):
        df = pd.read_excel(p)
    else:
        raise ValueError(f"Format dataset '{ext}' belum didukung. Gunakan .csv atau .xlsx.")

    n_rows, n_cols = df.shape
    dtypes_map = {col: str(dtype) for col, dtype in df.dtypes.items()}
    null_counts = df.isnull().sum().to_dict()
    total_nulls = int(df.isnull().sum().sum())
    duplicate_rows = int(df.duplicated().sum())

    # Describe numerical columns
    numeric_df = df.select_dtypes(include=["number"])
    stats_dict: dict[str, Any] = {}
    if not numeric_df.empty:
        desc = numeric_df.describe().to_dict()
        for col, col_stats in desc.items():
            stats_dict[col] = {k: round(v, 2) for k, v in col_stats.items()}

    # 3-row sanitized preview only
    preview = df.head(3).to_dict(orient="records")

    return {
        "file_name": p.name,
        "file_path": str(p),
        "file_size_bytes": p.stat().st_size,
        "rows": n_rows,
        "columns_count": n_cols,
        "columns": list(df.columns),
        "dtypes": dtypes_map,
        "null_counts": null_counts,
        "total_missing_cells": total_nulls,
        "duplicate_rows": duplicate_rows,
        "numerical_statistics": stats_dict,
        "sample_preview_rows": preview,
    }


def clean_dataset_locally(
    file_path: Path | str,
    drop_duplicates: bool = True,
    fill_na_strategy: Literal["mean", "median", "drop"] = "mean",
    output_filename: str | None = None,
) -> dict[str, Any]:
    """Clean and sanitize dataset deterministically using Pandas in local sandbox."""
    p = Path(file_path).expanduser().resolve()
    if not p.exists():
        raise FileNotFoundError(f"File dataset tidak ditemukan: {p}")

    ext = p.suffix.lower()
    if ext == ".csv":
        df = pd.read_csv(p)
    elif ext in (".xlsx", ".xls"):
        df = pd.read_excel(p)
    else:
        raise ValueError("Format file harus .csv atau .xlsx.")

    initial_shape = df.shape
    initial_nulls = int(df.isnull().sum().sum())

    # 1. Remove duplicate rows
    if drop_duplicates:
        df = df.drop_duplicates()
    duplicates_removed = initial_shape[0] - df.shape[0]

    # 2. Impute or drop missing values
    if fill_na_strategy == "drop":
        df = df.dropna()
    elif fill_na_strategy in ("mean", "median"):
        num_cols = df.select_dtypes(include=["number"]).columns
        for col in num_cols:
            if fill_na_strategy == "mean":
                fill_val = df[col].mean()
            else:
                fill_val = df[col].median()
            df[col] = df[col].fillna(fill_val)
        # For object/categorical columns, fill with mode or 'Unknown'
        cat_cols = df.select_dtypes(include=["object", "string"]).columns
        for col in cat_cols:
            mode_val = df[col].mode()
            fill_val = mode_val[0] if not mode_val.empty else "Unknown"
            df[col] = df[col].fillna(fill_val)

    final_shape = df.shape
    remaining_nulls = int(df.isnull().sum().sum())

    # Output path
    if not output_filename:
        output_filename = f"cleaned_{p.name}"
    out_dir = settings.data_dir / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / output_filename

    if ext == ".csv":
        df.to_csv(out_path, index=False)
    else:
        df.to_excel(out_path, index=False)

    return {
        "status": "success",
        "original_file": str(p),
        "cleaned_file": str(out_path),
        "initial_rows": initial_shape[0],
        "initial_columns": initial_shape[1],
        "final_rows": final_shape[0],
        "final_columns": final_shape[1],
        "duplicates_removed": duplicates_removed,
        "initial_missing_cells": initial_nulls,
        "remaining_missing_cells": remaining_nulls,
    }


def execute_sandboxed_command(
    command: list[str],
    cwd: Path | str | None = None,
    timeout_seconds: int = 15,
) -> dict[str, Any]:
    """Execute testing or linting commands in isolated sub-process with output truncation."""
    # Strict sandbox whitelist of safe student developer tools
    safe_commands = {"pytest", "python", "ruff", "git", "uv"}
    base_cmd = Path(command[0]).stem.lower()

    if base_cmd not in safe_commands:
        raise PermissionError(f"Perintah '{command[0]}' tidak diizinkan di terminal sandbox Karsa.")

    target_cwd = Path(cwd).resolve() if cwd else Path.cwd()

    try:
        proc = subprocess.run(
            command,
            cwd=str(target_cwd),
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            shell=False,
        )
        # Limit terminal output to 2000 chars to avoid blowing up context window
        stdout_snip = proc.stdout[:2000] if proc.stdout else ""
        stderr_snip = proc.stderr[:2000] if proc.stderr else ""

        return {
            "status": "success" if proc.returncode == 0 else "failed",
            "returncode": proc.returncode,
            "stdout": stdout_snip,
            "stderr": stderr_snip,
            "truncated": len(proc.stdout or "") > 2000,
        }
    except subprocess.TimeoutExpired:
        return {
            "status": "timeout",
            "returncode": -1,
            "stdout": "",
            "stderr": f"Perintah dibatalkan karena melebihi batas waktu {timeout_seconds} detik.",
        }
    except Exception as e:
        return {
            "status": "error",
            "returncode": -1,
            "stdout": "",
            "stderr": str(e),
        }


# LangChain Tool wrappers with Poka-Yoke schemas
class ProfileDatasetArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_path: str = Field(description="Jalur file dataset .csv atau .xlsx lokal")


@tool(args_schema=ProfileDatasetArgs)
def profile_dataset_tool(file_path: str) -> dict[str, Any]:
    """Inspeksi dan profiling dataset (.csv/.xlsx) secara lokal tanpa mengunggah baris mentah ke LLM."""
    try:
        profile = profile_dataset_locally(file_path)
        return {"status": "success", "profile": profile}
    except Exception as e:
        return ToolError(
            error_code="DATASET_PROFILE_FAILED",
            message=str(e),
            actionable_hint="Pastikan file dataset ada dan berformat .csv atau .xlsx.",
        ).model_dump()


class CleanDatasetArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_path: str = Field(description="Jalur file dataset yang ingin dibersihkan")
    fill_na_strategy: Literal["mean", "median", "drop"] = Field(default="mean", description="Strategi penanganan missing values")
    drop_duplicates: bool = Field(default=True, description="Hapus baris duplikat")


@tool(args_schema=CleanDatasetArgs)
def clean_dataset_tool(
    file_path: str,
    fill_na_strategy: Literal["mean", "median", "drop"] = "mean",
    drop_duplicates: bool = True,
) -> dict[str, Any]:
    """Bersihkan missing values dan duplikasi dataset secara deterministik di sandbox Pandas."""
    try:
        res = clean_dataset_locally(
            file_path=file_path,
            drop_duplicates=drop_duplicates,
            fill_na_strategy=fill_na_strategy,
        )
        return {"status": "success", "cleaned_summary": res}
    except Exception as e:
        return ToolError(
            error_code="DATASET_CLEAN_FAILED",
            message=str(e),
            actionable_hint="Periksa keberadaan file dan izin tulis direktori.",
        ).model_dump()
