"""@Project, @Business and @Notebook: quick-capture directives for the Studio. Zero LLM tokens.

Parsing is pure (it only fills `details`); `execute` performs the side effect once, from the supervisor's dispatch node.
"""
from __future__ import annotations

from typing import Any

STUDIO_COMMANDS = ("project", "business", "notebook")

HELP = {
    "project": (
        "**@Project** membuat proyek riset di Studio.\n"
        "- `@Project Prediksi DO mahasiswa | student dropout prediction` (nama | topik pencarian)\n"
        "- `@Project daftar` melihat proyek\n"
        "Lalu buka widget **Studio** > Proyek > Analisis untuk mencari literatur nyata dan menilai kebaruan."
    ),
    "business": (
        "**@Business** menyimpan ide bisnis di Studio.\n"
        "- `@Business Kedai kopi murah untuk mahasiswa di dekat kampus`\n"
        "- `@Business daftar` melihat ide\n"
        "Lalu buka widget **Studio** > Bisnis untuk Lean Canvas, hitung modal (RAB, HPP, BEP, ROI), dan lanjut ke pembuatan aplikasi."
    ),
    "notebook": (
        "**@Notebook** menambahkan halaman web ke Notebook.\n"
        "- `@Notebook https://contoh.com/artikel`\n"
        "Halaman dibaca lalu bisa kamu tanyakan dengan sitasi di widget Notebook."
    ),
}


def parse_args(cmd: str, arg: str) -> tuple[str, dict[str, Any]]:
    """(action, details) for a studio directive."""
    a = arg.strip()
    if not a or a.lower() in ("bantuan", "help"):
        return f"studio_{cmd}_help", {}
    if a.lower() in ("daftar", "list") and cmd != "notebook":
        return f"studio_{cmd}_list", {}
    if cmd == "project":
        name, _, topic = a.partition("|")
        return "studio_project_create", {"name": name.strip(), "topic": topic.strip()}
    if cmd == "business":
        return "studio_business_create", {"idea": a}
    return "studio_notebook_url", {"url": a.split()[0]}


def execute(action: str, details: dict[str, Any]) -> str:
    from backend.modules.studio import store
    from backend.modules.studio.store import StudioError

    try:
        if action.endswith("_help"):
            return HELP[action.split("_")[1]]
        if action.endswith("_list"):
            kind = action.split("_")[1]
            items = store.list_projects(kind)[:8]
            if not items:
                return f"Belum ada {'proyek' if kind == 'project' else 'ide bisnis'}. Ketik `@{kind.capitalize()}` untuk bantuan."
            return "\n".join(f"- #{p['id']} {p['name']}" for p in items)
        if action == "studio_project_create":
            name = details["name"]
            if not name:
                return HELP["project"]
            p = store.create_project("project", name, details.get("topic") or name)
            return f"Proyek **{p['name']}** dibuat (#{p['id']}). Buka widget **Studio** > Proyek > Analisis untuk mencari literatur dan menilai kebaruan."
        if action == "studio_business_create":
            idea = details["idea"]
            name = " ".join(idea.split()[:6])[:80]
            p = store.create_project("business", name, idea, {"idea": idea})
            return f"Ide bisnis **{p['name']}** disimpan (#{p['id']}). Buka widget **Studio** > Bisnis untuk Lean Canvas dan hitung modal."
        if action == "studio_notebook_url":
            from backend.modules.notebook import extras, store as nb_store

            notebooks = nb_store.list_notebooks()
            nb = notebooks[0] if notebooks else nb_store.create_notebook("Catatan Karsa")
            src = extras.add_url_source(nb["id"], details["url"])
            return f"Halaman **{src['name']}** ditambahkan ke notebook **{nb['title']}**. Tanyakan isinya di widget Notebook."
    except StudioError as e:
        return f"⚠️ {e}"
    except Exception as e:  # NotebookError and friends carry user-facing Indonesian messages
        return f"⚠️ {str(e)[:300]}"
    return HELP["project"]
