"""Manual ledger: expenses AND income, with full create / read / update / delete.

Expenses live in `financial_transactions` (5 fixed categories); income lives in `financial_income`. Income is spread over
the 5 categories with the same proportions as the monthly budget, so it raises every category's room and the Daily Safe
Spend (see `get_budget_snapshot`). All inputs are validated here so the API and the notch commands behave the same.
"""
from __future__ import annotations

import datetime
from pathlib import Path
from typing import Any, Literal

from backend.core.database import get_db_cursor
from backend.modules.finance.tools import VALID_CATEGORIES, get_or_create_monthly_budget

Kind = Literal["expense", "income"]
MAX_AMOUNT_IDR = 1_000_000_000
MIN_YEAR = 2000


def clean_amount(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("Nominal harus berupa angka rupiah.")
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if not isinstance(value, int):
        raise ValueError("Nominal harus bilangan bulat rupiah (tanpa desimal).")
    if value <= 0:
        raise ValueError("Nominal harus lebih besar dari 0.")
    if value > MAX_AMOUNT_IDR:
        raise ValueError("Nominal terlalu besar (maksimal Rp 1.000.000.000).")
    return value


def clean_date(value: str | None, now: datetime.datetime | None = None) -> str:
    """'YYYY-MM-DD' (noon) or 'YYYY-MM-DD HH:MM[:SS]' -> 'YYYY-MM-DD HH:MM:SS'. Tomorrow at most; never before 2000."""
    now = now or datetime.datetime.now()
    if value is None or not str(value).strip():
        return now.strftime("%Y-%m-%d %H:%M:%S")
    text = str(value).strip().replace("T", " ")
    dt: datetime.datetime | None = None
    for fmt, date_only in (("%Y-%m-%d %H:%M:%S", False), ("%Y-%m-%d %H:%M", False), ("%Y-%m-%d", True)):
        try:
            dt = datetime.datetime.strptime(text, fmt)
            if date_only:
                dt = dt.replace(hour=12)
            break
        except ValueError:
            continue
    if dt is None:
        raise ValueError("Format tanggal harus YYYY-MM-DD.")
    if dt.year < MIN_YEAR:
        raise ValueError("Tanggal terlalu lama.")
    if dt > now + datetime.timedelta(days=1):
        raise ValueError("Tanggal tidak boleh di masa depan.")
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def clean_text(value: Any, limit: int, label: str) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).split())
    if len(text) > limit:
        raise ValueError(f"{label} maksimal {limit} karakter.")
    return text or None


def _period_of(txn_date: str) -> str:
    return txn_date[:7]


def add_expense(
    amount_idr: Any,
    category: str,
    description: str | None = None,
    merchant: str | None = None,
    txn_date: str | None = None,
    source: Literal["text", "ocr", "manual"] = "manual",
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    amount = clean_amount(amount_idr)
    if category not in VALID_CATEGORIES:
        raise ValueError(f"Kategori harus salah satu dari {', '.join(VALID_CATEGORIES)}.")
    when = clean_date(txn_date)
    period = _period_of(when)
    get_or_create_monthly_budget(period=period, db_path=db_path)
    with get_db_cursor(db_path) as cur:
        cur.execute(
            """
            INSERT INTO financial_transactions (period, txn_date, amount_idr, category, merchant, description, source)
            VALUES (?, ?, ?, ?, ?, ?, ?);
            """,
            (period, when, amount, category, clean_text(merchant, 80, "Nama toko"), clean_text(description, 200, "Catatan") or "", source),
        )
        return get_entry("expense", cur.lastrowid, db_path, _cursor=cur)


def add_income(
    amount_idr: Any,
    label: str | None = None,
    note: str | None = None,
    txn_date: str | None = None,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    amount = clean_amount(amount_idr)
    when = clean_date(txn_date)
    period = _period_of(when)
    get_or_create_monthly_budget(period=period, db_path=db_path)
    with get_db_cursor(db_path) as cur:
        cur.execute(
            "INSERT INTO financial_income (period, txn_date, amount_idr, label, note) VALUES (?, ?, ?, ?, ?);",
            (period, when, amount, clean_text(label, 60, "Sumber") or "Pemasukan", clean_text(note, 200, "Catatan")),
        )
        return get_entry("income", cur.lastrowid, db_path, _cursor=cur)


def _row_to_entry(kind: str, r: Any) -> dict[str, Any]:
    d = dict(r)
    if kind == "expense":
        return {"kind": "expense", "id": d["id"], "txn_date": d["txn_date"], "period": d["period"], "amount_idr": d["amount_idr"],
                "category": d["category"], "label": d.get("merchant") or d.get("description") or d["category"],
                "merchant": d.get("merchant"), "description": d.get("description"), "source": d.get("source")}
    return {"kind": "income", "id": d["id"], "txn_date": d["txn_date"], "period": d["period"], "amount_idr": d["amount_idr"],
            "category": None, "label": d.get("label") or "Pemasukan", "merchant": None, "description": d.get("note"), "source": "manual"}


def _table(kind: str) -> str:
    if kind == "expense":
        return "financial_transactions"
    if kind == "income":
        return "financial_income"
    raise ValueError("Jenis harus 'expense' atau 'income'.")


def get_entry(kind: str, entry_id: int, db_path: Path | str | None = None, _cursor: Any = None) -> dict[str, Any]:
    table = _table(kind)

    def fetch(cur: Any) -> dict[str, Any]:
        cur.execute(f"SELECT * FROM {table} WHERE id = ?;", (entry_id,))
        row = cur.fetchone()
        if row is None:
            raise LookupError(f"{'Pengeluaran' if kind == 'expense' else 'Pemasukan'} #{entry_id} tidak ditemukan.")
        return _row_to_entry(kind, row)

    if _cursor is not None:
        return fetch(_cursor)
    with get_db_cursor(db_path) as cur:
        return fetch(cur)


def list_ledger(
    period: str | None = None,
    kind: str | None = None,
    limit: int = 100,
    db_path: Path | str | None = None,
) -> list[dict[str, Any]]:
    """Newest first, expenses and income together (or one kind)."""
    if kind not in (None, "expense", "income"):
        raise ValueError("Jenis harus 'expense' atau 'income'.")
    if period is not None and not (len(period) == 7 and period[4] == "-" and period[:4].isdigit() and period[5:].isdigit()):
        raise ValueError("Periode harus berformat YYYY-MM.")
    limit = max(1, min(int(limit), 500))
    out: list[dict[str, Any]] = []
    with get_db_cursor(db_path) as cur:
        for k in ("expense", "income"):
            if kind and kind != k:
                continue
            sql = f"SELECT * FROM {_table(k)}"
            params: list[Any] = []
            if period:
                sql += " WHERE period = ?"
                params.append(period)
            sql += " ORDER BY txn_date DESC, id DESC LIMIT ?;"
            params.append(limit)
            cur.execute(sql, params)
            out.extend(_row_to_entry(k, r) for r in cur.fetchall())
    out.sort(key=lambda e: (e["txn_date"], e["id"]), reverse=True)
    return out[:limit]


def update_entry(kind: str, entry_id: int, fields: dict[str, Any], db_path: Path | str | None = None) -> dict[str, Any]:
    """Change only the fields that were sent. Unknown fields are refused; nothing is written when validation fails."""
    table = _table(kind)
    allowed = {"amount_idr", "category", "merchant", "description", "date"} if kind == "expense" else {"amount_idr", "label", "note", "date"}
    unknown = set(fields) - allowed
    if unknown:
        raise ValueError(f"Kolom tidak dikenal: {', '.join(sorted(unknown))}.")
    if not fields:
        raise ValueError("Tidak ada yang diubah.")
    sets: list[str] = []
    params: list[Any] = []
    for key, val in fields.items():
        if key == "amount_idr":
            sets.append("amount_idr = ?"), params.append(clean_amount(val))
        elif key == "category":
            if val not in VALID_CATEGORIES:
                raise ValueError(f"Kategori harus salah satu dari {', '.join(VALID_CATEGORIES)}.")
            sets.append("category = ?"), params.append(val)
        elif key == "date":
            when = clean_date(val)
            sets.append("txn_date = ?"), params.append(when)
            sets.append("period = ?"), params.append(_period_of(when))
        elif key == "merchant":
            sets.append("merchant = ?"), params.append(clean_text(val, 80, "Nama toko"))
        elif key == "description":
            sets.append("description = ?"), params.append(clean_text(val, 200, "Catatan") or "")
        elif key == "label":
            sets.append("label = ?"), params.append(clean_text(val, 60, "Sumber") or "Pemasukan")
        elif key == "note":
            sets.append("note = ?"), params.append(clean_text(val, 200, "Catatan"))
    get_entry(kind, entry_id, db_path)  # 404 before any write
    if "period = ?" in sets:
        get_or_create_monthly_budget(period=params[sets.index("period = ?")], db_path=db_path)
    with get_db_cursor(db_path) as cur:
        cur.execute(f"UPDATE {table} SET {', '.join(sets)} WHERE id = ?;", [*params, entry_id])
        return get_entry(kind, entry_id, db_path, _cursor=cur)


def delete_entry(kind: str, entry_id: int, db_path: Path | str | None = None) -> dict[str, Any]:
    table = _table(kind)
    removed = get_entry(kind, entry_id, db_path)
    with get_db_cursor(db_path) as cur:
        cur.execute(f"DELETE FROM {table} WHERE id = ?;", (entry_id,))
    return removed


def last_entry(db_path: Path | str | None = None) -> dict[str, Any] | None:
    """The most recently CREATED entry (not the latest date): what a person means by "undo the last one"."""
    with get_db_cursor(db_path) as cur:
        cur.execute(
            """
            SELECT kind, id FROM (
                SELECT 'expense' AS kind, id, created_at FROM financial_transactions
                UNION ALL
                SELECT 'income' AS kind, id, created_at FROM financial_income
            ) ORDER BY created_at DESC, id DESC LIMIT 1;
            """
        )
        row = cur.fetchone()
    return get_entry(row["kind"], row["id"], db_path) if row else None


def income_total(period: str, db_path: Path | str | None = None) -> int:
    with get_db_cursor(db_path) as cur:
        cur.execute("SELECT COALESCE(SUM(amount_idr), 0) AS t FROM financial_income WHERE period = ?;", (period,))
        return int(cur.fetchone()["t"])
