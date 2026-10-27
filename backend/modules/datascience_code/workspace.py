"""Safe, deterministic helpers for working on a user's code folder (the "workspace").

Reading is limited to the workspace and to text files (no secrets, no giant files). Writing never happens here without
the caller having passed the human-approval gate; `apply_patch_with_backup` always keeps a `.bak` of the original.
"""
from __future__ import annotations

import difflib
import re
import sys
from pathlib import Path
from typing import Any

from backend.modules.datascience_code.tools import execute_sandboxed_command

MAX_FILE_BYTES = 200_000
CODE_EXTENSIONS = {
    ".py", ".ipynb", ".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".h", ".cpp", ".cs", ".go", ".rs", ".php", ".rb", ".kt",
    ".swift", ".sql", ".sh", ".bat", ".ps1", ".html", ".css", ".json", ".yaml", ".yml", ".toml", ".md", ".txt", ".r", ".m",
}
SKIP_DIRS = {".git", ".venv", "venv", "node_modules", "dist", "build", "target", "__pycache__", ".pytest_cache", ".idea", ".vscode"}
SECRET_NAMES = {".env", ".env.local", "id_rsa", "id_ed25519", "credentials", "credentials.json", "secrets.json"}
SECRET_SUFFIXES = {".pem", ".key", ".pfx", ".p12", ".kdbx"}


class WorkspaceError(ValueError):
    """A request about the workspace that cannot be honoured (message is shown to the user as is)."""


def workspace_root(path: str | None) -> Path:
    if not path or not str(path).strip():
        raise WorkspaceError("Folder kerja belum diatur. Isi “Folder kerja” di panel chat (mode Ngoding).")
    root = Path(path).expanduser()
    if not root.is_dir():
        raise WorkspaceError(f"Folder kerja tidak ditemukan: {path}")
    return root.resolve()


def resolve_in_workspace(root: Path, rel: str) -> Path:
    """The file `rel` inside `root`. Refuses anything outside (.., absolute paths, symlinks out), secrets and non-code files."""
    rel = rel.strip().strip("'\"`")
    if not rel:
        raise WorkspaceError("Nama file kosong.")
    target = (root / rel).resolve() if not Path(rel).is_absolute() else Path(rel).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        raise WorkspaceError("File itu di luar folder kerja, jadi tidak dibuka.")
    if any(part in SKIP_DIRS for part in target.relative_to(root).parts[:-1]):
        raise WorkspaceError("File itu ada di folder yang dilewati (mis. .git, node_modules).")
    if target.name.lower() in SECRET_NAMES or target.suffix.lower() in SECRET_SUFFIXES:
        raise WorkspaceError("File itu terlihat berisi rahasia (kunci/kredensial), jadi tidak dibuka.")
    if not target.is_file():
        raise WorkspaceError(f"File tidak ditemukan di folder kerja: {rel}")
    if target.suffix.lower() not in CODE_EXTENSIONS:
        raise WorkspaceError(f"Jenis file {target.suffix or '(tanpa ekstensi)'} tidak didukung untuk dibaca.")
    if target.stat().st_size > MAX_FILE_BYTES:
        raise WorkspaceError(f"File terlalu besar ({target.stat().st_size // 1024} KB, maksimal {MAX_FILE_BYTES // 1000} KB).")
    return target


def read_code_file(root: Path, rel: str) -> tuple[Path, str]:
    target = resolve_in_workspace(root, rel)
    try:
        return target, target.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise WorkspaceError("File itu bukan teks UTF-8, jadi tidak dibuka.")


def list_workspace_files(root: Path, limit: int = 40) -> list[str]:
    out: list[str] = []
    for p in sorted(root.rglob("*")):
        rel_parts = p.relative_to(root).parts
        if any(part in SKIP_DIRS for part in rel_parts[:-1]) or not p.is_file():
            continue
        if p.suffix.lower() in CODE_EXTENSIONS and p.name.lower() not in SECRET_NAMES and p.stat().st_size <= MAX_FILE_BYTES:
            out.append("/".join(rel_parts))
            if len(out) >= limit:
                break
    return out


def make_diff(old: str, new: str, name: str, max_lines: int = 120) -> str:
    lines = list(difflib.unified_diff(old.splitlines(), new.splitlines(), f"a/{name}", f"b/{name}", lineterm="", n=2))
    if len(lines) > max_lines:
        lines = lines[:max_lines] + [f"... (+{len(lines) - max_lines} baris lagi)"]
    return "\n".join(lines)


_FENCE = re.compile(r"```[a-zA-Z0-9_+-]*\n(.*?)```", re.DOTALL)


def extract_code_block(llm_text: str) -> str | None:
    """The replacement file the model wrote, from its (first) fenced block. None when it wrote no code."""
    m = _FENCE.search(llm_text)
    if not m:
        return None
    code = m.group(1)
    return code if code.strip() else None


def apply_patch_with_backup(target: Path, new_text: str) -> dict[str, Any]:
    backup = target.with_name(target.name + ".bak")
    if not backup.exists():  # keep the FIRST original: a second patch must not overwrite the only good copy
        backup.write_bytes(target.read_bytes())
    target.write_text(new_text, encoding="utf-8")
    return {"path": str(target), "backup": str(backup), "bytes": len(new_text.encode("utf-8"))}


def run_workspace_tests(root: Path, timeout_seconds: int = 90) -> dict[str, Any]:
    """pytest in the workspace (never the Karsa repo). The caller must have been approved to run it."""
    return execute_sandboxed_command([sys.executable, "-m", "pytest", "-q", "-x", "--no-header"], cwd=root, timeout_seconds=timeout_seconds)
