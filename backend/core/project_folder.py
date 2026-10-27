"""The user's active project folder: where agents write apps, cleaned datasets and papers.

The folder is a real absolute path on this computer. It is stored in `system_settings['project.folder']` and is only
ever changed by the user (typing a path, the native folder dialog, or "buat folder baru").
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from backend.core.config import settings
from backend.core.database import get_system_setting, set_system_setting

KEY = "project.folder"
FORBIDDEN_ROOTS = ("windows", "program files", "program files (x86)", "programdata", "system32")


class FolderError(ValueError):
    pass


def validate_folder(path: str | Path, must_exist: bool = True) -> Path:
    if not path or not str(path).strip():
        raise FolderError("Path folder belum diisi.")
    p = Path(str(path).strip().strip('"')).expanduser()
    if not p.is_absolute():
        raise FolderError("Path harus lengkap, mis. D:\\Proyek\\TokoKu.")
    p = p.resolve()
    if p.parent == p:
        raise FolderError("Root drive tidak boleh dipakai sebagai folder project.")
    if len(p.parts) > 1 and p.parts[1].lower() in FORBIDDEN_ROOTS:
        raise FolderError("Folder sistem tidak boleh dipakai sebagai folder project.")
    repo_root = Path(__file__).resolve().parents[2]
    for protected in (repo_root, settings.data_dir.resolve()):
        if p == protected or protected in p.parents:
            raise FolderError("Pilih folder di luar proyek Karsa dan folder data Karsa.")
    if must_exist and not p.is_dir():
        raise FolderError("Folder tidak ditemukan.")
    return p


def get_folder() -> str | None:
    """The active folder, or None when none is set or it no longer exists."""
    raw = get_system_setting(KEY)
    if not raw:
        return None
    try:
        return str(validate_folder(raw))
    except FolderError:
        return None


def set_folder(path: str | Path) -> str:
    p = validate_folder(path)
    set_system_setting(KEY, str(p))
    return str(p)


def clear_folder() -> None:
    set_system_setting(KEY, "")


def safe_folder_name(name: str) -> str:
    n = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", str(name or "")).strip(" .")
    n = re.sub(r"\s+", "_", n)[:60]
    if not n:
        raise FolderError("Nama folder baru belum diisi.")
    return n


def create_subfolder(name: str, parent: str | Path | None = None) -> str:
    """Make `<parent>/<name>` (parent defaults to the active folder) and make it the active folder."""
    base = validate_folder(parent) if parent else None
    if base is None:
        cur = get_folder()
        if not cur:
            raise FolderError("Pilih folder induk dulu, lalu buat folder baru di dalamnya.")
        base = Path(cur)
    target = validate_folder(base / safe_folder_name(name), must_exist=False)
    target.mkdir(parents=True, exist_ok=True)
    return set_folder(target)


def pick_folder_dialog(initial: str | None = None, timeout: int = 300) -> str | None:
    """Open the native Windows folder dialog on this computer and return the chosen absolute path (None if cancelled)."""
    if sys.platform != "win32":
        raise FolderError("Dialog folder asli hanya tersedia di Windows. Ketik path-nya langsung.")
    start = ""
    if initial and Path(initial).is_dir():
        start = "$f.SelectedPath = '" + str(initial).replace("'", "''") + "';"
    script = (
        "Add-Type -AssemblyName System.Windows.Forms;"
        "$f = New-Object System.Windows.Forms.FolderBrowserDialog;"
        "$f.Description = 'Pilih folder project Karsa'; $f.ShowNewFolderButton = $true;" + start +
        "$top = New-Object System.Windows.Forms.Form; $top.TopMost = $true; $top.ShowInTaskbar = $false;"
        "$top.StartPosition = 'CenterScreen'; $top.Size = New-Object System.Drawing.Size(0,0); $top.Show();"
        "if ($f.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($f.SelectedPath) }"
        "; $top.Close()"
    )
    try:
        res = subprocess.run(
            ["powershell", "-NoProfile", "-STA", "-WindowStyle", "Hidden", "-Command", script],
            capture_output=True, text=True, timeout=timeout, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except subprocess.TimeoutExpired:
        raise FolderError("Dialog folder tidak dijawab.")
    except OSError as e:
        raise FolderError(f"Dialog folder tidak bisa dibuka: {str(e)[:100]}")
    out = (res.stdout or "").strip()
    return out or None


def list_dirs(path: str | None) -> dict:
    """Sub-folders of `path` (or the drive roots when empty), for a typed-path fallback."""
    if not path:
        roots = [f"{c}:\\" for c in "CDEFGHIJKLMNOPQRSTUVWXYZ" if os.path.exists(f"{c}:\\")] if sys.platform == "win32" else ["/"]
        return {"path": "", "parent": None, "dirs": roots}
    p = Path(path).expanduser()
    if not p.is_absolute() or not p.is_dir():
        raise FolderError("Folder tidak ditemukan.")
    dirs = []
    try:
        for c in sorted(p.iterdir(), key=lambda x: x.name.lower()):
            if c.is_dir() and not c.name.startswith((".", "$")):
                dirs.append(str(c))
    except OSError:
        raise FolderError("Folder ini tidak bisa dibaca.")
    return {"path": str(p), "parent": str(p.parent) if p.parent != p else None, "dirs": dirs[:200]}


def open_in_explorer(path: str | Path) -> None:
    p = validate_folder(path)
    if sys.platform == "win32":
        os.startfile(str(p))  # noqa: S606 - a folder the user chose
    else:
        subprocess.Popen(["xdg-open", str(p)])


def open_in_vscode(path: str | Path) -> None:
    p = validate_folder(path)
    exe = shutil.which("code") or shutil.which("code.cmd")
    if not exe:
        raise FolderError("VS Code (perintah `code`) tidak ditemukan di PATH.")
    subprocess.Popen([exe, str(p)], creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
