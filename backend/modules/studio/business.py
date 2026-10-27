"""@Business: from a raw idea to a Lean Canvas, a capital plan (RAB, COGS, BEP, ROI) and a PRD ready for the app builder.

The numbers are plain deterministic arithmetic on figures the user typed. The AI only drafts the canvas text, and without a
model the canvas is an honest empty template (never invented market data).
"""
from __future__ import annotations

import math
from typing import Any

from backend.core.llm_helpers import LLMFn, parse_json_loose
from backend.modules.studio.store import StudioError

CANVAS_BLOCKS = [
    ("problem", "Masalah"),
    ("customer_segments", "Segmen pelanggan"),
    ("unique_value", "Nilai unik"),
    ("solution", "Solusi"),
    ("channels", "Saluran"),
    ("revenue_streams", "Sumber pendapatan"),
    ("cost_structure", "Struktur biaya"),
    ("key_metrics", "Metrik kunci"),
    ("unfair_advantage", "Keunggulan sulit ditiru"),
]
MAX_IDR = 100_000_000_000_000  # 100 triliun: anything above is a typo


def _money(value: Any, label: str) -> int:
    try:
        v = int(round(float(value)))
    except (TypeError, ValueError):
        raise StudioError(f"{label} harus berupa angka.")
    if v < 0:
        raise StudioError(f"{label} tidak boleh negatif.")
    if v > MAX_IDR:
        raise StudioError(f"{label} terlalu besar, periksa jumlah nol.")
    return v


def _items(raw: Any, label: str, key: str = "cost_idr") -> list[dict[str, Any]]:
    out = []
    for it in raw or []:
        if not isinstance(it, dict) or not str(it.get("name", "")).strip():
            raise StudioError(f"Setiap baris {label} perlu nama.")
        out.append({"name": str(it["name"]).strip()[:80], key: _money(it.get(key, 0), f"Biaya {it['name']}")})
    return out


def capital_plan(inputs: dict[str, Any]) -> dict[str, Any]:
    """Capital needed, unit economics, break-even and payback from the user's figures.

    inputs: start_items [{name, cost_idr}] (RAB awal), monthly_fixed [{name, cost_idr}], unit_costs [{name, cost_idr}]
    (per unit, makes the COGS), price_idr (per unit), units_per_month, buffer_months (default 3), contingency_pct (default 10).
    """
    start = _items(inputs.get("start_items"), "RAB awal")
    fixed = _items(inputs.get("monthly_fixed"), "biaya tetap bulanan")
    unit = _items(inputs.get("unit_costs"), "biaya per unit")
    price = _money(inputs.get("price_idr", 0), "Harga jual")
    units = _money(inputs.get("units_per_month", 0), "Target penjualan per bulan")
    buffer_months = max(0, min(int(inputs.get("buffer_months", 3) or 0), 24))
    contingency_pct = max(0.0, min(float(inputs.get("contingency_pct", 10) or 0), 100.0))

    capex = sum(i["cost_idr"] for i in start)
    contingency = int(round(capex * contingency_pct / 100))
    opex = sum(i["cost_idr"] for i in fixed)
    cogs = sum(i["cost_idr"] for i in unit)
    margin = price - cogs
    margin_pct = round(margin / price * 100, 1) if price > 0 else None
    revenue = price * units
    variable = cogs * units
    profit = revenue - variable - opex
    working_capital = opex * buffer_months + variable  # buffer of fixed costs + the first month's stock
    needed = capex + contingency + working_capital

    notes: list[str] = []
    if price <= 0:
        notes.append("Harga jual belum diisi: BEP dan proyeksi belum bisa dihitung.")
    elif margin <= 0:
        notes.append("Harga jual di bawah atau sama dengan HPP: setiap penjualan merugi. Naikkan harga atau turunkan biaya per unit.")
    bep_units = math.ceil(opex / margin) if margin > 0 else None
    if margin > 0 and units and bep_units and bep_units > units:
        notes.append(f"Target {units} unit/bulan belum mencapai BEP ({bep_units} unit): usaha masih rugi pada target ini.")
    payback = round(needed / profit, 1) if profit > 0 and needed > 0 else None
    roi_12m = round((profit * 12 - needed) / needed * 100, 1) if needed > 0 and price > 0 else None
    if profit <= 0 and price > 0 and margin > 0:
        notes.append("Laba bulanan pada target ini nol atau negatif.")
    if needed == 0:
        notes.append("Belum ada biaya yang diisi.")

    return {
        "capex_idr": capex,
        "contingency_idr": contingency,
        "monthly_fixed_idr": opex,
        "cogs_per_unit_idr": cogs,
        "margin_per_unit_idr": margin,
        "margin_pct": margin_pct,
        "bep_units": bep_units,
        "bep_revenue_idr": bep_units * price if bep_units is not None else None,
        "revenue_month_idr": revenue,
        "profit_month_idr": profit,
        "working_capital_idr": working_capital,
        "total_capital_needed_idr": needed,
        "payback_months": payback,
        "roi_12m_pct": roi_12m,
        "notes": notes,
        "inputs": {"start_items": start, "monthly_fixed": fixed, "unit_costs": unit, "price_idr": price, "units_per_month": units, "buffer_months": buffer_months, "contingency_pct": contingency_pct},
    }


def empty_canvas() -> dict[str, str]:
    return {k: "" for k, _ in CANVAS_BLOCKS}


def lean_canvas(idea: str, llm_fn: LLMFn | None = None) -> dict[str, Any]:
    """A Lean Canvas plus short market and competitor notes. Without a model: an empty template to fill in, flagged."""
    idea = (idea or "").strip()
    if len(idea) < 10:
        raise StudioError("Tulis ide bisnismu minimal satu kalimat.")
    if llm_fn:
        try:
            raw = llm_fn(
                "Kamu konsultan bisnis untuk mahasiswa Indonesia. Dari ide yang diberikan, isi Lean Business Canvas dalam Bahasa Indonesia. "
                "Balas HANYA JSON dengan kunci: problem, customer_segments, unique_value, solution, channels, revenue_streams, "
                "cost_structure, key_metrics, unfair_advantage (masing-masing teks singkat 1-3 kalimat), market_notes, competitor_notes, "
                "assumptions (daftar string asumsi yang perlu diverifikasi). Jangan mengarang angka pasar; tulis 'perlu riset' jika tidak tahu.",
                idea,
            )
            data = parse_json_loose(raw)
            canvas = {k: str(data.get(k, "")).strip() for k, _ in CANVAS_BLOCKS}
            return {
                "canvas": canvas,
                "market_notes": str(data.get("market_notes", "")).strip(),
                "competitor_notes": str(data.get("competitor_notes", "")).strip(),
                "assumptions": [str(a) for a in (data.get("assumptions") or [])][:10],
                "used_llm": True,
            }
        except Exception as e:
            reason = str(e)[:200]
    else:
        reason = "Belum ada model AI yang tersambung."
    return {
        "canvas": empty_canvas(),
        "market_notes": "",
        "competitor_notes": "",
        "assumptions": [],
        "used_llm": False,
        "note": f"Kanvas belum diisi AI ({reason}). Isi sendiri tiap kotak, atau hubungkan model di Settings lalu buat ulang.",
    }


def business_to_prd(name: str, idea: str, canvas: dict[str, str] | None, plan: dict[str, Any] | None) -> str:
    """A PRD in markdown built deterministically from the idea, canvas and capital plan, ready for the app builder."""
    canvas = canvas or {}
    lines = [f"# PRD: {name}", "", "## Latar belakang", idea.strip(), ""]
    labels = dict(CANVAS_BLOCKS)
    filled = [(labels[k], v) for k, v in canvas.items() if k in labels and str(v).strip()]
    if filled:
        lines.append("## Ringkasan bisnis (Lean Canvas)")
        lines += [f"- **{lab}**: {val}" for lab, val in filled]
        lines.append("")
    if plan and plan.get("inputs"):
        inp = plan["inputs"]
        lines += [
            "## Model usaha",
            f"- Harga jual per unit: Rp {inp['price_idr']:,}".replace(",", "."),
            f"- Target penjualan: {inp['units_per_month']} unit per bulan",
            f"- Break-even: {plan['bep_units']} unit per bulan" if plan.get("bep_units") else "- Break-even: belum dapat dihitung",
            "",
        ]
    lines += [
        "## Tujuan produk",
        f"Membangun website atau aplikasi untuk menjalankan bisnis '{name}': menampilkan penawaran, menerima pesanan/kontak pelanggan, dan memberi pemilik ringkasan penjualan.",
        "",
        "## Fitur utama (versi pertama)",
        "- Halaman beranda yang menjelaskan nilai unik dan penawaran",
        "- Daftar produk/layanan dengan harga",
        "- Formulir pesanan atau kontak yang tersimpan",
        "- Halaman pemilik untuk melihat pesanan masuk",
        "",
        "## Kriteria selesai",
        "- Semua halaman bisa dibuka tanpa error",
        "- Formulir pesanan menyimpan data dan menampilkannya di halaman pemilik",
    ]
    return "\n".join(lines)
