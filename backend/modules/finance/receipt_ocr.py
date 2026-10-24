from __future__ import annotations

import io
import json
import re
import time
from pathlib import Path
from typing import Any, Callable

from PIL import Image, UnidentifiedImageError

from backend.core.config import settings
from backend.core.database import get_system_setting
from backend.core.token_tracker import record_token_log
from backend.modules.finance.tools import (
    VALID_CATEGORIES,
    classify_category_deterministic,
    parse_indonesian_nominal,
)
from backend.screen_context.screen_reader import compress_image

MAX_RECEIPT_BYTES = 8 * 1024 * 1024
MAX_DIMENSION = 1600

RECEIPT_PROMPT = (
    "Kamu membaca foto struk belanja Indonesia. Balas HANYA JSON valid tanpa teks lain:\n"
    '{"merchant": string|null, "date": "YYYY-MM-DD"|null, "total_idr": integer|null, '
    '"items": [{"name": string, "qty": number, "price_idr": integer}], '
    f'"category": salah satu dari {list(VALID_CATEGORIES)}}}\n'
    "Aturan: total_idr adalah TOTAL AKHIR yang dibayar (setelah pajak/diskon) dalam rupiah bulat, "
    "tanpa titik/koma ribuan. Jika gambar bukan struk atau tidak terbaca, isi total_idr dengan null. "
    "Jangan mengarang angka."
)

# Injectable for tests: (jpeg_bytes) -> (raw_json_text, tokens_in, tokens_out)
VisionFn = Callable[[bytes], "tuple[str, int, int]"]


class ReceiptOCRError(Exception):
    """Raised with a user-facing (Indonesian) message; `code` maps to an HTTP status in the API."""

    def __init__(self, message: str, code: str = "unreadable") -> None:
        super().__init__(message)
        self.code = code


def _resolve_api_key() -> str:
    key = settings.gemini_api_key or get_system_setting("api_key.gemini", "") or ""
    return str(key).strip().strip('"')


def prepare_image(data: bytes) -> bytes:
    """Validate and downscale the upload to a compact JPEG (fewer vision tokens, no huge payloads)."""
    if not data:
        raise ReceiptOCRError("File gambar kosong.", "invalid_image")
    if len(data) > MAX_RECEIPT_BYTES:
        raise ReceiptOCRError("Ukuran foto struk maksimal 8 MB.", "too_large")
    try:
        with Image.open(io.BytesIO(data)) as img:
            img.load()
            jpeg, _, _ = compress_image(img, max_dimension=MAX_DIMENSION, jpeg_quality=80)
            return jpeg
    except (UnidentifiedImageError, OSError):
        raise ReceiptOCRError("File bukan gambar yang valid (gunakan JPG/PNG/WebP).", "invalid_image")


def call_gemini_vision(jpeg: bytes) -> tuple[str, int, int]:
    """Send the receipt image to Gemini and return (json_text, tokens_in, tokens_out)."""
    api_key = _resolve_api_key()
    if not api_key:
        raise ReceiptOCRError(
            "Kunci API Gemini belum dipasang. Tambahkan di Settings untuk membaca struk.", "no_api_key"
        )
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        resp = client.models.generate_content(
            model=settings.tier1_model,
            contents=[types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"), RECEIPT_PROMPT],
            config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0),
        )
    except ReceiptOCRError:
        raise
    except Exception as e:
        raise ReceiptOCRError(f"Gagal memanggil Gemini Vision: {str(e)[:160]}", "provider_error")

    usage = getattr(resp, "usage_metadata", None)
    tokens_in = int(getattr(usage, "prompt_token_count", 0) or 0)
    tokens_out = int(getattr(usage, "candidates_token_count", 0) or 0)
    return (resp.text or ""), tokens_in, tokens_out


def _coerce_idr(value: Any) -> int | None:
    """Turn a model-provided amount (int, float, or 'Rp 25.000') into whole rupiah, else None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(round(value)) if value > 0 else None
    if isinstance(value, str):
        if re.fullmatch(r"\s*(?:[Rr][Pp]\.?)?\s*[\d.,]+\s*", value):
            digits_only = re.sub(r"[^\d]", "", re.sub(r",\d{1,2}\s*$", "", value))  # drop ",00" decimals
            return int(digits_only) or None if digits_only else None
        return parse_indonesian_nominal(value)
    return None


def parse_receipt_json(raw: str) -> dict[str, Any]:
    """Validate Gemini's JSON into a normalized receipt dict; raises ReceiptOCRError if unusable."""
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        raise ReceiptOCRError("Balasan model tidak bisa dibaca sebagai struk. Coba foto yang lebih jelas.")
    if not isinstance(data, dict):
        raise ReceiptOCRError("Balasan model tidak bisa dibaca sebagai struk. Coba foto yang lebih jelas.")

    items: list[dict[str, Any]] = []
    for it in data.get("items") or []:
        if not isinstance(it, dict) or not str(it.get("name") or "").strip():
            continue
        price = _coerce_idr(it.get("price_idr")) or 0
        try:
            qty = float(it.get("qty") or 1)
        except (TypeError, ValueError):
            qty = 1.0
        items.append({"name": str(it["name"]).strip()[:80], "qty": qty if qty > 0 else 1.0, "price_idr": price})

    total = _coerce_idr(data.get("total_idr"))
    if total is None and items:
        # Deterministic fallback: sum line items when the model could not read the grand total
        total = int(round(sum(i["qty"] * i["price_idr"] for i in items))) or None
    if total is None:
        raise ReceiptOCRError("Total belanja tidak terbaca dari foto. Coba foto yang lebih jelas atau catat manual.")

    merchant = str(data.get("merchant") or "").strip()[:60] or None
    receipt_date = data.get("date") if isinstance(data.get("date"), str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", data["date"]) else None

    haystack = " ".join([merchant or ""] + [i["name"] for i in items])
    suggested = data.get("category")
    category = (
        classify_category_deterministic(haystack)
        or (suggested if suggested in VALID_CATEGORIES else None)
        or "makanan"
    )

    return {
        "merchant": merchant,
        "date": receipt_date,
        "total_idr": total,
        "items": items,
        "category": category,
        "description": build_description(merchant, items),
    }


def build_description(merchant: str | None, items: list[dict[str, Any]]) -> str:
    names = ", ".join(i["name"] for i in items[:3])
    if len(items) > 3:
        names += f", +{len(items) - 3} item"
    parts = [p for p in (merchant, names) if p]
    return "Struk " + " - ".join(parts) if parts else "Struk belanja"


def scan_receipt(
    image_bytes: bytes,
    vision_fn: VisionFn | None = None,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Read a receipt photo into a structured preview. Does NOT write a transaction."""
    jpeg = prepare_image(image_bytes)
    started = time.monotonic()
    raw, tokens_in, tokens_out = (vision_fn or call_gemini_vision)(jpeg)
    latency_ms = int((time.monotonic() - started) * 1000)

    if tokens_in or tokens_out:
        try:
            record_token_log(
                module="finance_receipt_ocr",
                provider="google",
                model_used=settings.tier1_model,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                latency_ms=latency_ms,
                db_path=db_path,
            )
        except Exception:
            pass  # usage logging must never block reading a receipt

    return parse_receipt_json(raw)
