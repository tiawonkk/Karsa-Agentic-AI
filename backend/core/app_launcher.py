"""
Native Windows Application Indexer & Launcher.
Scans Windows Start Menu directories, parses shortcuts (.lnk),
provides fast in-memory fuzzy search (<10ms), and launches applications deterministically.
"""

import os
import glob
from pathlib import Path
from typing import List, Dict, Any, Optional
import logging

logger = logging.getLogger("karsa.app_launcher")


class WindowsAppIndexer:
    """In-memory indexer for installed Windows applications."""

    def __init__(self):
        self._apps: List[Dict[str, Any]] = []
        self._indexed = False
        self._shell = None

    def _get_shell(self):
        if self._shell is None:
            try:
                import win32com.client
                self._shell = win32com.client.Dispatch("WScript.Shell")
            except Exception as e:
                logger.warning(f"Failed to initialize WScript.Shell: {e}")
                self._shell = False
        return self._shell if self._shell is not False else None

    def refresh_index(self) -> int:
        """Scan Start Menu directories and build in-memory application index."""
        apps: List[Dict[str, Any]] = []
        seen_names = set()

        search_dirs = [
            Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / r"Microsoft\Windows\Start Menu\Programs",
            Path(os.environ.get("APPDATA", "")) / r"Microsoft\Windows\Start Menu\Programs",
        ]

        shell = self._get_shell()

        for base_dir in search_dirs:
            if not base_dir.exists():
                continue

            for lnk_path in base_dir.rglob("*.lnk"):
                name = lnk_path.stem.strip()
                lower_name = name.lower()

                # Filter out uninstaller and help shortcuts
                if (
                    lower_name.startswith("uninstall")
                    or lower_name.startswith("help")
                    or "documentation" in lower_name
                    or "readme" in lower_name
                ):
                    continue

                if lower_name in seen_names:
                    continue
                seen_names.add(lower_name)

                target_path = str(lnk_path)
                if shell:
                    try:
                        shortcut = shell.CreateShortcut(str(lnk_path))
                        if shortcut.TargetPath and os.path.exists(shortcut.TargetPath):
                            target_path = shortcut.TargetPath
                    except Exception:
                        pass

                # Derive Category / Icon hint
                category = "utility"
                if any(x in lower_name for x in ["code", "studio", "pycharm", "git", "terminal"]):
                    category = "development"
                elif any(x in lower_name for x in ["chrome", "edge", "firefox", "browser"]):
                    category = "browser"
                elif any(x in lower_name for x in ["word", "excel", "powerpoint", "office"]):
                    category = "office"
                elif any(x in lower_name for x in ["spotify", "music", "vlc", "media"]):
                    category = "media"

                apps.append({
                    "name": name,
                    "target_path": target_path,
                    "lnk_path": str(lnk_path),
                    "category": category,
                })

        # Add common system developer fallbacks if not discovered
        fallbacks = [
            {"name": "Visual Studio Code", "target_path": "code", "category": "development"},
            {"name": "Google Chrome", "target_path": "chrome", "category": "browser"},
            {"name": "Spotify", "target_path": "spotify", "category": "media"},
            {"name": "Windows Terminal", "target_path": "wt", "category": "development"},
            {"name": "Calculator", "target_path": "calc", "category": "utility"},
            {"name": "Notepad", "target_path": "notepad", "category": "utility"},
        ]
        for fb in fallbacks:
            if fb["name"].lower() not in seen_names:
                apps.append({
                    "name": fb["name"],
                    "target_path": fb["target_path"],
                    "lnk_path": "",
                    "category": fb["category"],
                })
                seen_names.add(fb["name"].lower())

        self._apps = sorted(apps, key=lambda a: a["name"].lower())
        self._indexed = True
        logger.info(f"Indexed {len(self._apps)} Windows applications.")
        return len(self._apps)

    def search(self, query: str, limit: int = 15) -> List[Dict[str, Any]]:
        """Fuzzy search indexed applications by name or category (<10ms)."""
        if not self._indexed:
            self.refresh_index()

        q = query.lower().strip()
        if not q:
            return self._apps[:limit]

        # Score matching: Exact prefix > substring in name > match in category
        scored = []
        for app in self._apps:
            name_lower = app["name"].lower()
            if name_lower.startswith(q):
                score = 100 - len(name_lower)
                scored.append((score, app))
            elif q in name_lower:
                score = 50 - len(name_lower)
                scored.append((score, app))
            elif q in app.get("category", ""):
                score = 10
                scored.append((score, app))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [item[1] for item in scored[:limit]]

    def launch(self, path_or_target: str) -> Dict[str, Any]:
        """Launch an application on Windows."""
        try:
            if hasattr(os, "startfile") and (os.path.exists(path_or_target) or path_or_target.endswith(".lnk")):
                os.startfile(path_or_target)
            else:
                import subprocess
                subprocess.Popen(path_or_target, shell=True)
            return {"status": "launched", "path": path_or_target}
        except Exception as e:
            logger.error(f"Failed to launch app {path_or_target}: {e}")
            return {"status": "error", "error": str(e)}


# Global singleton instance
app_indexer = WindowsAppIndexer()
