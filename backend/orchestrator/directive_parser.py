from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from backend.core.database import get_db_cursor
from backend.modules.finance.tools import (
    classify_category_deterministic,
    format_rupiah,
    get_budget_snapshot,
    parse_indonesian_nominal,
    record_transaction_in_db,
)
from backend.modules.study_daily.tools import (
    add_task_in_db,
    generate_skill_roadmap,
    list_tasks_from_db,
    parse_due_date_natural,
)

DirectiveType = Literal[
    "money", "todo", "study", "course", "search", "write", "data", "code", "screen"
]

DIRECTIVE_MODULE_MAP: dict[str, str] = {
    "money": "finance",
    "todo": "study_daily",
    "study": "study_daily",
    "course": "study_daily",
    "search": "research",
    "write": "writer",
    "data": "datascience_code",
    "code": "datascience_code",
    "screen": "screen_reader",
}

DIRECTIVE_REGEX = re.compile(
    r"^@(Money|Todo|Study|Course|Search|Write|Data|Code|Screen)\b\s*(.*)$",
    re.IGNORECASE | re.DOTALL,
)

COMMENT_SCAN_REGEX = re.compile(
    r"(?:#|//|<!--)\s*@(Money|Todo|Study|Course|Search|Write|Data|Code|Screen)\b\s*([^-\n]+?)(?:\s*-->|\r?\n|$)",
    re.IGNORECASE,
)


@dataclass
class ParsedDirective:
    raw_text: str
    is_directive: bool
    command: str | None = None
    argument: str = ""
    target_module: str | None = None
    action: str = "general"
    details: dict[str, Any] = field(default_factory=dict)
    execution_result: str | None = None


def parse_directive(text: str) -> ParsedDirective:
    """Parse text for `@Directive` commands at the start of a user message.
    
    Examples:
        @Money -25k makan siang nasi padang
        @Money +500k kiriman bulanan
        @Money modal 2000000
        @Money laporan
        @Todo deadline kumpul laprak jumat 17:00
        @Search paper agentic workflow
        @Data analisis sales_2026.csv
        @Screen jelaskan bagian ini
    """
    cleaned = text.strip()
    match = DIRECTIVE_REGEX.match(cleaned)
    if not match:
        return ParsedDirective(raw_text=text, is_directive=False)

    cmd = match.group(1).lower()
    arg = match.group(2).strip()
    target_mod = DIRECTIVE_MODULE_MAP.get(cmd, "supervisor")

    parsed = ParsedDirective(
        raw_text=text,
        is_directive=True,
        command=cmd,
        argument=arg,
        target_module=target_mod,
    )

    # 1. @Money Handling
    if cmd == "money":
        _parse_money_directive(arg, parsed)
    # 2. @Todo Handling
    elif cmd == "todo":
        _parse_todo_directive(arg, parsed)
    # 3. @Study & @Course Handling
    elif cmd in ("study", "course"):
        _parse_study_directive(cmd, arg, parsed)
    # 4. @Search Handling
    elif cmd == "search":
        parsed.action = "search_academic" if "paper" in arg.lower() else "search_general"
        parsed.details = {"query": arg}
    # 5. @Write Handling
    elif cmd == "write":
        parsed.action = "write_manuscript"
        parsed.details = {"topic_or_file": arg}
    # 6. @Data & @Code Handling
    elif cmd in ("data", "code"):
        parsed.action = "profile_dataset" if cmd == "data" else "execute_code"
        parsed.details = {"target": arg}
    # 7. @Screen Handling
    elif cmd == "screen":
        parsed.action = "screen_assist"
        parsed.details = {"query": arg or "analisis layar aktif"}

    return parsed


def _parse_money_directive(arg: str, parsed: ParsedDirective) -> None:
    lower_arg = arg.lower()
    if lower_arg == "laporan" or "rekap" in lower_arg or "safe spend" in lower_arg:
        parsed.action = "report"
        snap = get_budget_snapshot()
        parsed.details = snap
        parsed.execution_result = (
            f"📊 **Laporan Finansial & Safe Spend Bulan Ini**\n"
            f"• Sisa Saldo: **{format_rupiah(snap['total_remaining_idr'])}** / {format_rupiah(snap['total_capital_idr'])}\n"
            f"• Total Pengeluaran: **{format_rupiah(snap['total_spent_idr'])}**\n"
            f"• Sisa Waktu: **{snap['remaining_days']} hari lagi**\n"
            f"💡 **Daily Safe Spend Hari Ini:** **{format_rupiah(snap['daily_safe_spend_idr'])} / hari**"
        )
        return

    if _money_subcommand(lower_arg, parsed):
        return

    # Check for expense format: "-25k makan siang" or "25rb makan siang"
    is_income = arg.startswith("+")
    cleaned_num_text = arg.lstrip("+-").strip()

    if "modal" in lower_arg:
        parsed.action = "set_capital"
        nominal = parse_indonesian_nominal(cleaned_num_text.replace("modal", ""))
        parsed.details = {"new_capital": nominal, "requires_hitl": True}
        if nominal:
            parsed.execution_result = f"Pengaturan Modal Pokok menjadi **{format_rupiah(nominal)}** memerlukan persetujuan HITL."
        return

    nominal = parse_indonesian_nominal(cleaned_num_text)
    if nominal:
        from backend.modules.finance import ledger

        if is_income:
            parsed.action = "log_income"
            label = re.sub(r"(?i)\b\d[\d.,]*\s*(?:rb|ribu|k|jt|juta|rupiah)?\b", "", cleaned_num_text).strip(" -,.") or None
            try:
                item = ledger.add_income(nominal, label, None)
            except ValueError as e:
                parsed.execution_result = f"⚠️ Pemasukan tidak dicatat: {e}"
                return
            snapshot = get_budget_snapshot()
            parsed.details = {"transaction": item, "snapshot": snapshot}
            parsed.execution_result = (
                f"✅ **Pemasukan Dicatat:** {format_rupiah(nominal)} ({item['label']})\n"
                f"• Sisa saldo bulan ini: {format_rupiah(snapshot['total_remaining_idr'])}\n"
                f"💡 **Daily Safe Spend:** {format_rupiah(snapshot['daily_safe_spend_idr'])} / hari"
            )
        else:
            # Expense
            category = classify_category_deterministic(cleaned_num_text) or "makanan"
            parsed.action = "log_expense"
            try:
                txn_res = record_transaction_in_db(
                    amount_idr=nominal,
                    category=category,
                    description=cleaned_num_text,
                    source="text",
                    used_llm=0,
                )
            except ValueError as e:
                parsed.execution_result = f"⚠️ Pengeluaran tidak dicatat: {e}"
                return
            snapshot = get_budget_snapshot()
            rem_cat = snapshot["categories"].get(category, {}).get("remaining", 0)
            daily_safe = snapshot.get("daily_safe_spend_idr", 0)
            parsed.details = {
                "transaction": txn_res,
                "snapshot": snapshot,
                "remaining_in_category": rem_cat,
                "daily_safe_spend_idr": daily_safe,
            }
            parsed.execution_result = (
                f"✅ **Pengeluaran Dicatat:** {format_rupiah(nominal)} ({category})\n"
                f"• Deskripsi: {cleaned_num_text}\n"
                f"• Sisa Pagu {category}: {format_rupiah(rem_cat)}\n"
                f"💡 **Daily Safe Spend:** {format_rupiah(daily_safe)} / hari"
            )


_MONEY_HELP = (
    "💰 **Cara memakai @Money**\n"
    "• `@Money -25k makan siang` catat pengeluaran\n"
    "• `@Money +500k uang saku` catat pemasukan\n"
    "• `@Money riwayat` lihat 5 catatan terakhir\n"
    "• `@Money hapus terakhir` batalkan catatan terakhir\n"
    "• `@Money ubah terakhir 30k` atau `ubah terakhir kategori kesenangan`\n"
    "• `@Money laporan` ringkasan bulan ini"
)


def _entry_line(e: dict[str, Any]) -> str:
    sign = "+" if e["kind"] == "income" else "-"
    cat = f" ({e['category']})" if e.get("category") else ""
    return f"• #{e['kind'][0].upper()}{e['id']} {e['txn_date'][:10]} {sign}{format_rupiah(e['amount_idr'])} {e['label']}{cat}"


def _last_entry() -> dict[str, Any] | None:
    from backend.modules.finance import ledger

    return ledger.last_entry()


def _money_subcommand(lower_arg: str, parsed: ParsedDirective) -> bool:
    """riwayat / hapus terakhir / ubah terakhir ...; returns True when it handled the text."""
    from backend.modules.finance import ledger

    if not lower_arg or lower_arg in ("bantuan", "help"):
        parsed.action = "money_help"
        parsed.execution_result = _MONEY_HELP
        return True
    if lower_arg in ("riwayat", "daftar", "history"):
        parsed.action = "money_history"
        items = ledger.list_ledger(limit=5)
        parsed.execution_result = (
            "🧾 **5 Catatan Terakhir**\n" + "\n".join(_entry_line(e) for e in items) if items else "Belum ada catatan uang bulan ini."
        )
        return True
    if lower_arg in ("hapus terakhir", "batal", "undo", "batalkan terakhir"):
        parsed.action = "money_delete_last"
        last = _last_entry()
        if not last:
            parsed.execution_result = "Tidak ada catatan untuk dihapus."
            return True
        ledger.delete_entry(last["kind"], last["id"])
        parsed.execution_result = f"🗑️ Dihapus: {_entry_line(last)[2:]}\n• Saldo dikembalikan seperti sebelum catatan ini."
        return True
    if lower_arg.startswith(("ubah terakhir", "koreksi")):
        parsed.action = "money_edit_last"
        last = _last_entry()
        if not last:
            parsed.execution_result = "Tidak ada catatan untuk diubah."
            return True
        rest = lower_arg.replace("ubah terakhir", "").replace("koreksi", "").strip()
        fields: dict[str, Any] = {}
        cat_match = re.search(r"kategori\s+(\w+)", rest)
        if cat_match:
            if last["kind"] == "income":
                parsed.execution_result = "⚠️ Pemasukan tidak punya kategori."
                return True
            fields["category"] = cat_match.group(1)
            rest = rest.replace(cat_match.group(0), "").strip()
        nominal = parse_indonesian_nominal(rest) if rest else None
        if nominal:
            fields["amount_idr"] = nominal
        if not fields:
            parsed.execution_result = "Mau diubah jadi apa? Contoh: `@Money ubah terakhir 30k` atau `@Money ubah terakhir kategori kesenangan`."
            return True
        try:
            new = ledger.update_entry(last["kind"], last["id"], fields)
        except ValueError as e:
            parsed.execution_result = f"⚠️ Tidak diubah: {e}"
            return True
        parsed.execution_result = f"✏️ Diubah: {_entry_line(new)[2:]}"
        return True
    return False


_TODO_HELP = (
    "✅ **Cara memakai @Todo**\n"
    "• `@Todo laprak kimia besok sore` atau `@Todo tambah laprak kimia` buat tugas\n"
    "• `@Todo daftar` lihat tugas yang belum selesai\n"
    "• `@Todo selesai 3` atau `@Todo selesai laprak` centang\n"
    "• `@Todo hapus 3` hapus\n"
    "• `@Todo ubah 3 judul baru` ganti judul, `@Todo prioritas 3 1` ganti prioritas (1 kritis - 4 santai)"
)


def _find_task(ref: str) -> tuple[dict[str, Any] | None, str | None]:
    """A task by id or by a unique piece of its title. Returns (task, problem message)."""
    from backend.modules.study_daily.tools import list_tasks_from_db

    pending = list_tasks_from_db(status="todo")
    ref = ref.strip().lstrip("#")
    if ref.isdigit():
        for t in pending:
            if t["id"] == int(ref):
                return t, None
        return None, f"Tugas #{ref} tidak ditemukan (mungkin sudah selesai atau dihapus)."
    hits = [t for t in pending if ref.lower() in t["title"].lower()]
    if len(hits) == 1:
        return hits[0], None
    if not hits:
        return None, f"Tidak ada tugas yang cocok dengan “{ref}”."
    return None, "Ada beberapa yang cocok, pakai nomornya:\n" + "\n".join(f"• #{t['id']} {t['title']}" for t in hits[:6])


def _todo_subcommand(arg: str, parsed: ParsedDirective) -> bool:
    from backend.modules.study_daily.tools import complete_task_in_db, delete_task_in_db, list_tasks_from_db, update_task_in_db

    low = arg.lower().strip()
    if not low or low in ("bantuan", "help"):
        parsed.action = "todo_help"
        parsed.execution_result = _TODO_HELP
        return True
    if low in ("daftar", "list", "lihat"):
        parsed.action = "todo_list"
        rows = list_tasks_from_db(status="todo")[:8]
        parsed.execution_result = (
            "📋 **Tugas Belum Selesai**\n" + "\n".join(f"• #{t['id']} {t['title']}" + (f" (⏰ {t['due_at']})" if t.get("due_at") else "") for t in rows)
            if rows
            else "Tidak ada tugas yang menunggu. 🎉"
        )
        return True

    m = re.match(r"(?i)^(selesai|centang|done)\s+(.+)$", arg.strip())
    if m:
        parsed.action = "todo_complete"
        task, problem = _find_task(m.group(2))
        if not task:
            parsed.execution_result = f"⚠️ {problem}"
            return True
        complete_task_in_db(task["id"])
        parsed.execution_result = f"☑️ Selesai: **{task['title']}** (tetap terlihat 24 jam, bisa dibatalkan dari widget Todo)."
        return True
    m = re.match(r"(?i)^(hapus|buang)\s+(.+)$", arg.strip())
    if m:
        parsed.action = "todo_delete"
        task, problem = _find_task(m.group(2))
        if not task:
            parsed.execution_result = (
                f"⚠️ {problem}\nUntuk membuat tugas berjudul “{arg.strip()}”, ketik: `@Todo tambah {arg.strip()}`"
            )
            return True
        delete_task_in_db(task["id"])
        parsed.execution_result = f"🗑️ Tugas dihapus: **{task['title']}**"
        return True
    m = re.match(r"(?i)^ubah\s+#?(\d+)\s+(.+)$", arg.strip())
    if m:
        parsed.action = "todo_edit"
        task, problem = _find_task(m.group(1))
        if not task:
            parsed.execution_result = f"⚠️ {problem}"
            return True
        try:
            new = update_task_in_db(task["id"], {"title": m.group(2)})
        except ValueError as e:
            parsed.execution_result = f"⚠️ Tidak diubah: {e}"
            return True
        parsed.execution_result = f"✏️ Judul diubah: **{new['title']}**"
        return True
    m = re.match(r"(?i)^prioritas\s+#?(\d+)\s+(\d)$", arg.strip())
    if m:
        parsed.action = "todo_priority"
        task, problem = _find_task(m.group(1))
        if not task:
            parsed.execution_result = f"⚠️ {problem}"
            return True
        try:
            new = update_task_in_db(task["id"], {"priority": int(m.group(2))})
        except ValueError as e:
            parsed.execution_result = f"⚠️ Tidak diubah: {e}"
            return True
        parsed.execution_result = f"🎯 **{new['title']}** sekarang kuadran {new['quadrant']}."
        return True
    return False


def _parse_todo_directive(arg: str, parsed: ParsedDirective) -> None:
    if _todo_subcommand(arg, parsed):
        return
    arg = re.sub(r"(?i)^tambah\s+", "", arg.strip())
    parsed.action = "create_task"
    due_dt = parse_due_date_natural(arg)
    due_str = due_dt.strftime("%Y-%m-%d %H:%M:%S") if due_dt else None
    try:
        res = add_task_in_db(title=arg, due_at=due_str)
    except ValueError as e:
        parsed.execution_result = f"⚠️ Tugas tidak disimpan: {e}"
        return
    parsed.details = res
    due_display = f"Deadline: **{due_str}**" if due_str else "Tanpa deadline spesifik"
    parsed.execution_result = (
        f"✅ **Tugas Disimpan ke Eisenhower Matrix!**\n"
        f"📌 **{arg}**\n"
        f"⏰ {due_display}\n"
        f"🎯 Kuadran: **{res.get('quadrant', 'Q2_SCHEDULE')}**"
    )


def _parse_study_directive(cmd: str, arg: str, parsed: ParsedDirective) -> None:
    if cmd == "course":
        parsed.action = "skill_roadmap"
        res = generate_skill_roadmap(arg, register_as_tasks=True)
        parsed.details = res
        plan = res.get("roadmap", {})
        weeks = plan.get("weeks", [])
        week_lines = []
        for w in weeks[:4]:
            week_lines.append(f"• Minggu {w.get('week', '?')}: **{w.get('title', '')}** — {w.get('goal', '')}")

        parsed.execution_result = (
            f"🗺️ **Roadmap Belajar 4 Minggu: {arg.title()}**\n\n"
            + "\n".join(week_lines)
            + f"\n\n✅ 4 Milestone telah otomatis didaftarkan ke @Todo kamu!"
        )
    else:
        parsed.action = "summarize_document"
        parsed.details = {"document": arg}


def scan_workspace_comments(
    workspace_dir: str | Path,
    extensions: list[str] | None = None,
    max_findings: int = 50,
) -> list[dict[str, Any]]:
    """Scan workspace code and document files for inline directives like `# @Search`, `// @Todo`.
    
    Skips build artifacts, `.git`, `node_modules`, and `.venv`.
    """
    root = Path(workspace_dir)
    if not root.exists() or not root.is_dir():
        return []

    target_exts = set(
        extensions
        or [
            ".py",
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".html",
            ".md",
            ".css",
            ".json",
            ".sql",
        ]
    )

    skip_dirs = {
        ".git",
        ".venv",
        "node_modules",
        "dist",
        "build",
        "target",
        "__pycache__",
        ".pytest_cache",
        ".karsa",
    }

    findings: list[dict[str, Any]] = []

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in skip_dirs]
        for fname in filenames:
            ext = os.path.splitext(fname)[1].lower()
            if ext not in target_exts:
                continue

            fpath = Path(dirpath) / fname
            try:
                content = fpath.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue

            lines = content.splitlines()
            for line_idx, line in enumerate(lines):
                match = COMMENT_SCAN_REGEX.search(line)
                if match:
                    cmd = match.group(1).lower()
                    arg = match.group(2).strip()

                    # Grab up to 4 following lines as context
                    context_lines = lines[line_idx + 1 : line_idx + 5]
                    rel_path = str(fpath.relative_to(root)).replace("\\", "/")

                    findings.append({
                        "file": rel_path,
                        "line": line_idx + 1,
                        "command": f"@{cmd.capitalize()}",
                        "directive": cmd,
                        "argument": arg,
                        "target_module": DIRECTIVE_MODULE_MAP.get(cmd, "supervisor"),
                        "raw_line": line.strip(),
                        "context": "\n".join(context_lines),
                    })

                    if len(findings) >= max_findings:
                        return findings

    return findings
