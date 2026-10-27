"""The "Hari Ini" brief: one calm screen that joins tasks, money and water, plus at most 3 helpful nudges.

Pure functions (data in, dict out) so the rules are unit-testable. Every nudge comes from real data and a fixed rule;
nothing is invented, and an empty state is reported as an empty state.
"""
from __future__ import annotations

import datetime
from typing import Any

MAX_NUDGES = 3


def greeting(now: datetime.datetime) -> str:
    h = now.hour
    if h < 4:
        return "Masih terjaga? Jangan lupa istirahat"
    if h < 11:
        return "Selamat pagi"
    if h < 15:
        return "Selamat siang"
    if h < 18:
        return "Selamat sore"
    return "Selamat malam"


def _idr(n: int) -> str:
    return "Rp " + f"{int(n):,}".replace(",", ".")


def build_nudges(
    now: datetime.datetime,
    tasks: list[dict[str, Any]],
    budget: dict[str, Any],
    water: dict[str, Any],
    snoozed: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Rules in priority order; snoozed ones are skipped; at most MAX_NUDGES are returned."""
    snoozed = snoozed or {}
    out: list[dict[str, Any]] = []

    def add(nid: str, tone: str, text: str, action: str | None = None, label: str | None = None) -> None:
        until = snoozed.get(nid)
        if until and until > now.isoformat():
            return
        out.append({"id": nid, "tone": tone, "text": text, "action": action, "action_label": label})

    pending = [t for t in tasks if t.get("status", "todo") != "done"]
    overdue = [t for t in pending if t.get("hours_left") is not None and t["hours_left"] < 0]
    soon = [t for t in pending if t.get("hours_left") is not None and 0 <= t["hours_left"] <= 24]

    if overdue:
        add("overdue", "warn", f"{len(overdue)} tugas sudah lewat tenggat, mulai dari “{overdue[0]['title']}”.", "pomodoro", "Fokus 25 menit")
    if soon:
        t = min(soon, key=lambda x: x["hours_left"])
        add("due_soon", "warn", f"“{t['title']}” jatuh tempo kurang dari {max(1, round(t['hours_left']))} jam lagi.", "pomodoro", "Fokus 25 menit")

    capital = budget.get("total_capital_idr") or 0
    days_left = budget.get("remaining_days") or 0
    if capital > 0 and days_left > 0:
        remaining_pct = budget.get("total_remaining_idr", 0) / capital * 100
        # days in this month, derived from today's date
        first_next = (now.replace(day=28) + datetime.timedelta(days=4)).replace(day=1)
        dim = (first_next - datetime.timedelta(days=1)).day
        time_pct = days_left / dim * 100
        if remaining_pct + 25 < time_pct:
            add(
                "money_low",
                "warn",
                f"Uangmu tinggal {round(remaining_pct)}% padahal masih {days_left} hari. Aman belanja maksimal {_idr(budget.get('daily_safe_spend_idr', 0))} per hari.",
                "finance",
                "Lihat keuangan",
            )

    target = water.get("target_ml") or 0
    if target > 0 and now.hour >= 12 and water.get("total_ml", 0) < target * 0.25:
        add("water_low", "info", f"Baru minum {water.get('total_ml', 0)} ml dari {target} ml. Segelas dulu?", "water", "Catat minum")

    if not pending:
        add("no_tasks", "info", "Belum ada tugas. Tambahkan satu supaya hari ini punya arah.", "todo", "Tambah tugas")

    return out[:MAX_NUDGES]


def build_today(
    now: datetime.datetime,
    tasks: list[dict[str, Any]],
    budget: dict[str, Any],
    water: dict[str, Any],
    snoozed: dict[str, str] | None = None,
) -> dict[str, Any]:
    pending = [t for t in tasks if t.get("status", "todo") != "done"]
    pending.sort(key=lambda t: (t.get("hours_left") is None, t.get("hours_left") if t.get("hours_left") is not None else 0))
    return {
        "greeting": greeting(now),
        "tasks": {
            "pending_count": len(pending),
            "focus": [
                {"id": t["id"], "title": t["title"], "hours_left": t.get("hours_left"), "due_at": t.get("due_at")}
                for t in pending[:3]
            ],
        },
        "money": {
            "daily_safe_spend_idr": budget.get("daily_safe_spend_idr", 0),
            "total_remaining_idr": budget.get("total_remaining_idr", 0),
            "total_capital_idr": budget.get("total_capital_idr", 0),
            "remaining_days": budget.get("remaining_days", 0),
        },
        "water": {"total_ml": water.get("total_ml", 0), "target_ml": water.get("target_ml", 0)},
        "nudges": build_nudges(now, tasks, budget, water, snoozed),
    }
