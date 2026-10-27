from __future__ import annotations

import calendar
import datetime
import re
from pathlib import Path
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field
from langchain_core.tools import tool

from backend.core.database import get_db_cursor
from backend.core.state import ToolError

TransactionCategory = Literal["makanan", "pelajaran", "kesehatan", "investment", "kesenangan"]

VALID_CATEGORIES: list[TransactionCategory] = [
    "makanan",
    "pelajaran",
    "kesehatan",
    "investment",
    "kesenangan",
]


def format_rupiah(amount: int) -> str:
    """Format integer amount to Indonesian Rupiah standard format e.g. 25000 -> 'Rp 25.000'."""
    return f"Rp {amount:,}".replace(",", ".")

# Category keyword dictionaries for zero-token deterministic classification
CATEGORY_KEYWORDS: dict[TransactionCategory, list[str]] = {
    "makanan": [
        "makan", "nasi", "seblak", "geprek", "warteg", "mie", "indomie", "sarapan",
        "lunch", "dinner", "snack", "roti", "jajan", "bakso", "sate", "minum",
        "jus", "esteh", "es teh", "boba", "pecel", "ayam", "soto", "kantin",
        "gorengan", "martabak", "kue", "sayur", "buah", "kopi susu", "angkrigan"
    ],
    "pelajaran": [
        "buku", "kuliah", "fotokopi", "fotocopy", "alat tulis", "pulpen", "pensil",
        "print", "kursus", "sertifikasi", "ukt", "spp", "diktat", "modul", "ujian",
        "kertas", "praktikum", "seminar", "workshop", "webinar", "buku tulis", "binder"
    ],
    "kesehatan": [
        "obat", "vitamin", "tolak angin", "paracetamol", "panadol", "apotek",
        "dokter", "klinik", "perban", "betadine", "bodrex", "koyo", "minyak kayu putih",
        "masker", "sanitizer", "rumah sakit", "bpjs", "dentist", "gigi", "medis"
    ],
    "investment": [
        "reksadana", "deposito", "bibit", "bareksa", "saham", "investasi", "rdpu",
        "sukuk", "emas", "tabungan berjangka", "invest"
    ],
    "kesenangan": [
        "nongkrong", "kafe", "cafe", "ngopi", "bioskop", "cinema", "film", "game",
        "steam", "topup", "top up", "diamond", "mlbb", "netflix", "spotify",
        "konser", "jalan-jalan", "hobi", "staycation", "karaoke", "komik", "manga",
        "playstation", "ps5", "hangout"
    ],
}


def parse_indonesian_nominal(text: str) -> int | None:
    """Deterministic parser for informal Indonesian monetary amounts.
    
    Supports:
      - '25rb', '25 rb', '25k', '25 ribu' -> 25000
      - '2.5jt', '2,5jt', '2.5 jt', '2.5 juta', '2 juta' -> 2500000
      - 'Rp 50.000', 'rp 50000', 'Rp. 50.000' -> 50000
      - '50000', '150000' -> 50000, 150000
    
    Returns integer Rupiah or None if no valid nominal detected.
    """
    cleaned = text.lower().strip()

    # Pattern 1: Jutaan (e.g. 2.5jt, 2,5 jt, 3 juta, 1jt)
    match_jt = re.search(r"(\d+(?:[\.,]\d+)?)\s*(?:jt|juta)\b", cleaned)
    if match_jt:
        raw_num = match_jt.group(1).replace(",", ".")
        try:
            val = float(raw_num)
            return int(round(val * 1_000_000))
        except ValueError:
            pass

    # Pattern 2: Ribuan (e.g. 25rb, 25 rb, 25k, 120 ribu)
    match_rb = re.search(r"(\d+(?:[\.,]\d+)?)\s*(?:rb|k|ribu)\b", cleaned)
    if match_rb:
        raw_num = match_rb.group(1).replace(",", ".")
        try:
            val = float(raw_num)
            return int(round(val * 1_000))
        except ValueError:
            pass

    # Pattern 3: Explicit Rp formatted (e.g. Rp 50.000, Rp.50,000, rp 75000)
    match_rp = re.search(r"(?:rp\.?|idr)\s*([\d\.,]+)\b", cleaned)
    if match_rp:
        digits_only = re.sub(r"[^\d]", "", match_rp.group(1))
        if digits_only:
            try:
                val = int(digits_only)
                if val > 0:
                    return val
            except ValueError:
                pass

    # Pattern 4: Standalone numbers with 4+ digits (e.g. 15000, 250000, 50.000)
    match_num = re.search(r"\b(\d{1,3}(?:\.\d{3})+)\b", cleaned)
    if match_num:
        digits_only = match_num.group(1).replace(".", "")
        return int(digits_only)

    match_raw = re.search(r"\b(\d{4,9})\b", cleaned)
    if match_raw:
        return int(match_raw.group(1))

    return None


def classify_category_deterministic(text: str) -> TransactionCategory | None:
    """Classify expenditure category deterministically using keyword dictionary.
    
    Returns one of: 'makanan', 'pelajaran', 'kesehatan', 'investment', 'kesenangan' or None.
    """
    cleaned = text.lower()
    scores: dict[TransactionCategory, int] = {cat: 0 for cat in VALID_CATEGORIES}

    # Specific override rules: 'nongkrong' or 'kafe' scores for kesenangan
    if "kafe" in cleaned or "nongkrong" in cleaned or "hangout" in cleaned:
        scores["kesenangan"] += 5

    for cat, keywords in CATEGORY_KEYWORDS.items():
        for kw in keywords:
            # Word boundary matching where appropriate
            if re.search(r"\b" + re.escape(kw) + r"\b", cleaned):
                scores[cat] += 2
            elif kw in cleaned:
                scores[cat] += 1

    best_cat, best_score = max(scores.items(), key=lambda item: item[1])
    return best_cat if best_score > 0 else None


def extract_transaction_intent(text: str) -> tuple[int | None, TransactionCategory | None, str]:
    """Extract nominal, category, and description from a student's expense statement.
    
    Example: 'beli seblak 25rb di kantin' -> (25000, 'makanan', 'seblak di kantin')
    """
    nominal = parse_indonesian_nominal(text)
    category = classify_category_deterministic(text) or "makanan"
    
    # Extract clean description by stripping nominal and common prefix words
    desc = text.strip()
    desc = re.sub(r"(?i)\b(?:beli|bayar|jajan|belanja|pesan|buat|untuk)\b", "", desc)
    desc = re.sub(r"(?i)(?:rp\.?|idr)?\s*\d+(?:[\.,]\d+)?\s*(?:rb|k|ribu|jt|juta|rupiah)?", "", desc)
    desc = re.sub(r"\s+", " ", desc).strip(" ,.-")
    
    if not desc:
        desc = f"Pengeluaran {category}"

    return nominal, category, desc


def calculate_daily_safe_spend(
    remaining_makanan: int,
    remaining_kesenangan: int,
    remaining_days: int,
) -> int:
    """Compute student Daily Safe Spend deterministically:
    
    Daily Safe Spend = (Sisa Alokasi makanan + Sisa Alokasi kesenangan) / Sisa Hari
    """
    effective_days = max(1, remaining_days)
    spendable = max(0, remaining_makanan) + max(0, remaining_kesenangan)
    return int(spendable // effective_days)


def get_current_period() -> str:
    """Get current period string in YYYY-MM format."""
    now = datetime.datetime.now()
    return now.strftime("%Y-%m")


def get_remaining_days_in_month() -> int:
    """Calculate remaining days in current month including today."""
    now = datetime.datetime.now()
    _, total_days = calendar.monthrange(now.year, now.month)
    return max(1, total_days - now.day + 1)


def get_or_create_monthly_budget(
    period: str | None = None,
    default_capital: int = 2_000_000,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Retrieve or initialize default monthly budget for the period."""
    if not period:
        period = get_current_period()

    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            SELECT id, period, total_capital_idr, alloc_makanan, alloc_pelajaran,
                   alloc_kesehatan, alloc_investment, alloc_kesenangan
            FROM monthly_budget
            WHERE period = ?;
            """,
            (period,),
        )
        row = cursor.fetchone()
        if row:
            return dict(row)

        # Initialize default conservative student budget (50% makanan, 20% kuliah, 10% kesehatan, 10% investasi, 10% senang)
        alloc_makanan = int(default_capital * 0.50)
        alloc_pelajaran = int(default_capital * 0.20)
        alloc_kesehatan = int(default_capital * 0.10)
        alloc_investment = int(default_capital * 0.10)
        alloc_kesenangan = default_capital - (alloc_makanan + alloc_pelajaran + alloc_kesehatan + alloc_investment)

        cursor.execute(
            """
            INSERT INTO monthly_budget (
                period, total_capital_idr, alloc_makanan, alloc_pelajaran,
                alloc_kesehatan, alloc_investment, alloc_kesenangan
            ) VALUES (?, ?, ?, ?, ?, ?, ?);
            """,
            (
                period,
                default_capital,
                alloc_makanan,
                alloc_pelajaran,
                alloc_kesehatan,
                alloc_investment,
                alloc_kesenangan,
            ),
        )
        cursor.execute("SELECT * FROM monthly_budget WHERE period = ?;", (period,))
        new_row = cursor.fetchone()
        return dict(new_row) if new_row else {}


def record_transaction_in_db(
    amount_idr: int,
    category: TransactionCategory,
    description: str,
    merchant: str | None = None,
    source: Literal["text", "ocr", "manual"] = "text",
    used_llm: int = 0,
    period: str | None = None,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Persist an expenditure into financial_transactions table."""
    if amount_idr <= 0:
        raise ValueError("Nominal transaksi harus lebih besar dari 0.")
    if amount_idr > 1_000_000_000:
        raise ValueError("Nominal terlalu besar (maksimal Rp 1.000.000.000).")

    if category not in VALID_CATEGORIES:
        raise ValueError(f"Kategori tidak valid: {category}. Harus salah satu dari {VALID_CATEGORIES}")

    now = datetime.datetime.now()
    if not period:
        period = now.strftime("%Y-%m")
    txn_date = now.strftime("%Y-%m-%d %H:%M:%S")

    # Ensure budget row exists
    get_or_create_monthly_budget(period=period, db_path=db_path)

    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            INSERT INTO financial_transactions (
                period, txn_date, amount_idr, category, merchant,
                description, source, used_llm
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            """,
            (period, txn_date, amount_idr, category, merchant, description, source, used_llm),
        )
        txn_id = cursor.lastrowid

    return {
        "id": txn_id,
        "period": period,
        "txn_date": txn_date,
        "amount_idr": amount_idr,
        "category": category,
        "merchant": merchant,
        "description": description,
        "source": source,
    }


def get_budget_snapshot(
    period: str | None = None,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Generate budget report including category remaining balance & Daily Safe Spend."""
    if not period:
        period = get_current_period()

    budget = get_or_create_monthly_budget(period=period, db_path=db_path)
    remaining_days = get_remaining_days_in_month()

    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            SELECT category, COALESCE(SUM(amount_idr), 0) as total_spent
            FROM financial_transactions
            WHERE period = ?
            GROUP BY category;
            """,
            (period,),
        )
        spent_rows = cursor.fetchall()

    spent_by_category: dict[str, int] = {cat: 0 for cat in VALID_CATEGORIES}
    for r in spent_rows:
        spent_by_category[r["category"]] = int(r["total_spent"])

    alloc_makanan = budget.get("alloc_makanan", 0)
    alloc_pelajaran = budget.get("alloc_pelajaran", 0)
    alloc_kesehatan = budget.get("alloc_kesehatan", 0)
    alloc_investment = budget.get("alloc_investment", 0)
    alloc_kesenangan = budget.get("alloc_kesenangan", 0)
    total_capital = budget.get("total_capital_idr", 0)

    rem_makanan = alloc_makanan - spent_by_category["makanan"]
    rem_pelajaran = alloc_pelajaran - spent_by_category["pelajaran"]
    rem_kesehatan = alloc_kesehatan - spent_by_category["kesehatan"]
    rem_investment = alloc_investment - spent_by_category["investment"]
    rem_kesenangan = alloc_kesenangan - spent_by_category["kesenangan"]

    # Income (manual ledger) is spread over the categories in the same proportions as the budget
    from backend.modules.finance.ledger import income_total

    income = income_total(period, db_path)
    if income:
        shares = {
            "makanan": alloc_makanan, "pelajaran": alloc_pelajaran, "kesehatan": alloc_kesehatan,
            "investment": alloc_investment, "kesenangan": alloc_kesenangan,
        }
        base = sum(shares.values()) or 1
        extra = {k: income * v // base for k, v in shares.items()}
        extra["kesenangan"] += income - sum(extra.values())  # keep the sum exact
        alloc_makanan += extra["makanan"]
        alloc_pelajaran += extra["pelajaran"]
        alloc_kesehatan += extra["kesehatan"]
        alloc_investment += extra["investment"]
        alloc_kesenangan += extra["kesenangan"]
        rem_makanan = alloc_makanan - spent_by_category["makanan"]
        rem_pelajaran = alloc_pelajaran - spent_by_category["pelajaran"]
        rem_kesehatan = alloc_kesehatan - spent_by_category["kesehatan"]
        rem_investment = alloc_investment - spent_by_category["investment"]
        rem_kesenangan = alloc_kesenangan - spent_by_category["kesenangan"]

    total_spent = sum(spent_by_category.values())
    total_remaining = total_capital + income - total_spent

    daily_safe_spend = calculate_daily_safe_spend(rem_makanan, rem_kesenangan, remaining_days)

    return {
        "period": period,
        "total_capital_idr": total_capital,
        "total_income_idr": income,
        "total_spent_idr": total_spent,
        "total_remaining_idr": total_remaining,
        "remaining_days": remaining_days,
        "daily_safe_spend_idr": daily_safe_spend,
        "categories": {
            "makanan": {
                "allocated": alloc_makanan,
                "spent": spent_by_category["makanan"],
                "remaining": rem_makanan,
            },
            "pelajaran": {
                "allocated": alloc_pelajaran,
                "spent": spent_by_category["pelajaran"],
                "remaining": rem_pelajaran,
            },
            "kesehatan": {
                "allocated": alloc_kesehatan,
                "spent": spent_by_category["kesehatan"],
                "remaining": rem_kesehatan,
            },
            "investment": {
                "allocated": alloc_investment,
                "spent": spent_by_category["investment"],
                "remaining": rem_investment,
            },
            "kesenangan": {
                "allocated": alloc_kesenangan,
                "spent": spent_by_category["kesenangan"],
                "remaining": rem_kesenangan,
            },
        },
    }


def evaluate_investment_readiness(
    period: str | None = None,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Conservative student investment readiness analysis.
    
    Verifies cash flow safety and emergency cushion before allowing low-risk recommendations.
    Strictly forbids speculative assets (crypto, leveraged trading, penny stocks).
    """
    snapshot = get_budget_snapshot(period=period, db_path=db_path)
    daily_safe_spend = snapshot["daily_safe_spend_idr"]
    rem_makanan = snapshot["categories"]["makanan"]["remaining"]
    rem_investment = snapshot["categories"]["investment"]["remaining"]
    remaining_days = snapshot["remaining_days"]

    # Minimum threshold: student needs at least Rp 30.000/day for daily survival
    is_safe_daily = daily_safe_spend >= 30_000
    is_makanan_positive = rem_makanan > 0
    is_ready = is_safe_daily and is_makanan_positive and rem_investment > 0

    if not is_ready:
        reasons = []
        if daily_safe_spend < 30_000:
            reasons.append(f"Daily Safe Spend kamu ketat ({format_rupiah(daily_safe_spend)}/hari).")
        if rem_makanan <= 0:
            reasons.append("Alokasi makan bulanan sudah habis/minus.")
        if rem_investment <= 0:
            reasons.append("Alokasi dana investasi bulan ini sudah terpakai penuh.")

        recommendation = (
            "⚠️ **Belum Disarankan Berinvestasi Saat Ini.**\n"
            + " ".join(reasons)
            + "\n💡 Prioritaskan likuiditas untuk kebutuhan makan harian dan dana darurat hingga akhir bulan."
        )
        return {
            "is_ready": False,
            "readiness_score": "not_recommended",
            "daily_safe_spend_idr": daily_safe_spend,
            "available_investment_capital_idr": max(0, rem_investment),
            "recommendation": recommendation,
            "allowed_instruments": [],
        }

    recommendation = (
        f"✅ **Kondisi Keuangan Aman untuk Investasi Konservatif.**\n"
        f"Daily Safe Spend kamu terjaga di {format_rupiah(daily_safe_spend)}/hari ({remaining_days} hari tersisa). "
        f"Alokasi investasi yang tersedia: **{format_rupiah(rem_investment)}**.\n\n"
        "Rekomendasi instrumen rendah risiko & likuid untuk mahasiswa:\n"
        "1. **Reksadana Pasar Uang (RDPU):** Sangat likuid, tanpa biaya admin, stabil untuk dana jangka pendek (Bibit / Bareksa).\n"
        "2. **Deposito Bank Digital:** Bunga terukur dengan tenor fleksibel (1–3 bulan).\n"
        "⛔ *Hindari instrumen spekulatif (kripto / saham gorengan) untuk dana modal mahasiswa.*"
    )

    return {
        "is_ready": True,
        "readiness_score": "conservative_ready",
        "daily_safe_spend_idr": daily_safe_spend,
        "available_investment_capital_idr": rem_investment,
        "recommendation": recommendation,
        "allowed_instruments": ["Reksadana Pasar Uang (RDPU)", "Deposito Bank Digital"],
    }


def update_monthly_capital_in_db(
    new_total_capital_idr: int,
    period: str | None = None,
    alloc_makanan_pct: float = 0.50,
    alloc_pelajaran_pct: float = 0.20,
    alloc_kesehatan_pct: float = 0.10,
    alloc_investment_pct: float = 0.10,
    alloc_kesenangan_pct: float = 0.10,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Execute update of total monthly capital and redistribute allocations (High Risk)."""
    if new_total_capital_idr <= 0:
        raise ValueError("Modal bulanan baru harus lebih besar dari 0.")

    if not period:
        period = get_current_period()

    alloc_m = int(new_total_capital_idr * alloc_makanan_pct)
    alloc_p = int(new_total_capital_idr * alloc_pelajaran_pct)
    alloc_k = int(new_total_capital_idr * alloc_kesehatan_pct)
    alloc_i = int(new_total_capital_idr * alloc_investment_pct)
    alloc_s = new_total_capital_idr - (alloc_m + alloc_p + alloc_k + alloc_i)

    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            INSERT INTO monthly_budget (
                period, total_capital_idr, alloc_makanan, alloc_pelajaran,
                alloc_kesehatan, alloc_investment, alloc_kesenangan, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            ON CONFLICT(period) DO UPDATE SET
                total_capital_idr = excluded.total_capital_idr,
                alloc_makanan = excluded.alloc_makanan,
                alloc_pelajaran = excluded.alloc_pelajaran,
                alloc_kesehatan = excluded.alloc_kesehatan,
                alloc_investment = excluded.alloc_investment,
                alloc_kesenangan = excluded.alloc_kesenangan,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
            """,
            (period, new_total_capital_idr, alloc_m, alloc_p, alloc_k, alloc_i, alloc_s),
        )

    return {
        "period": period,
        "total_capital_idr": new_total_capital_idr,
        "allocations": {
            "makanan": alloc_m,
            "pelajaran": alloc_p,
            "kesehatan": alloc_k,
            "investment": alloc_i,
            "kesenangan": alloc_s,
        },
    }


# LangChain Tool wrappers with Poka-Yoke schemas
class RecordTransactionArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount_idr: int = Field(description="Nominal pengeluaran dalam Rupiah (integer positif, contoh: 25000)")
    category: TransactionCategory = Field(description="Salah satu dari: 'makanan', 'pelajaran', 'kesehatan', 'investment', 'kesenangan'")
    description: str = Field(description="Deskripsi singkat transaksi, contoh: 'seblak level 3' atau 'buku kalkulus'")
    merchant: str | None = Field(default=None, description="Nama toko / merchant opsional")


@tool(args_schema=RecordTransactionArgs)
def record_transaction_tool(
    amount_idr: int,
    category: TransactionCategory,
    description: str,
    merchant: str | None = None,
) -> dict[str, Any]:
    """Catat pengeluaran mahasiswa ke dalam database dan perbarui saldo kategori."""
    try:
        res = record_transaction_in_db(
            amount_idr=amount_idr,
            category=category,
            description=description,
            merchant=merchant,
            source="manual",
            used_llm=1,
        )
        snapshot = get_budget_snapshot()
        return {
            "status": "success",
            "transaction": res,
            "daily_safe_spend_idr": snapshot["daily_safe_spend_idr"],
            "remaining_category_idr": snapshot["categories"][category]["remaining"],
        }
    except Exception as e:
        return ToolError(
            error_code="RECORD_TXN_FAILED",
            message=str(e),
            hint="Pastikan nominal > 0 dan kategori adalah salah satu dari 5 kategori resmi.",
        ).model_dump()


class BudgetSnapshotArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    period: str | None = Field(default=None, description="Periode anggaran format YYYY-MM. Default periode bulan ini.")


@tool(args_schema=BudgetSnapshotArgs)
def get_budget_snapshot_tool(period: str | None = None) -> dict[str, Any]:
    """Ambil ringkasan pagu anggaran, sisa saldo 5 kategori, dan kalkulasi Daily Safe Spend harian."""
    try:
        return get_budget_snapshot(period=period)
    except Exception as e:
        return ToolError(
            error_code="BUDGET_SNAPSHOT_FAILED",
            message=str(e),
            hint="Periksa apakah format periode YYYY-MM sesuai.",
        ).model_dump()


class InvestmentReadinessArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    period: str | None = Field(default=None, description="Periode evaluasi format YYYY-MM.")


@tool(args_schema=InvestmentReadinessArgs)
def evaluate_investment_readiness_tool(period: str | None = None) -> dict[str, Any]:
    """Evaluasi kesiapan investasi mahasiswa secara konservatif berdasarkan Daily Safe Spend dan likuiditas."""
    try:
        return evaluate_investment_readiness(period=period)
    except Exception as e:
        return ToolError(
            error_code="INVESTMENT_CHECK_FAILED",
            message=str(e),
            hint="Periksa ketersediaan data transaksi bulan ini.",
        ).model_dump()
