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
        if is_income:
            parsed.action = "log_income"
            parsed.details = {"amount": nominal, "description": cleaned_num_text}
            parsed.execution_result = f"✅ Pemasukan **{format_rupiah(nominal)}** berhasil dicatat."
        else:
            # Expense
            category = classify_category_deterministic(cleaned_num_text) or "makanan"
            parsed.action = "log_expense"
            txn_res = record_transaction_in_db(
                amount_idr=nominal,
                category=category,
                description=cleaned_num_text,
                source="text",
                used_llm=0,
            )
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


def _parse_todo_directive(arg: str, parsed: ParsedDirective) -> None:
    parsed.action = "create_task"
    due_dt = parse_due_date_natural(arg)
    due_str = due_dt.strftime("%Y-%m-%d %H:%M:%S") if due_dt else None
    res = add_task_in_db(title=arg, due_at=due_str)
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
