import io
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.api.main import app
from backend.core.config import settings
from backend.core.database import get_db_cursor, initialize_master_database
from backend.modules.finance import receipt_ocr
from backend.modules.finance.receipt_ocr import (
    ReceiptOCRError,
    parse_receipt_json,
    prepare_image,
    scan_receipt,
)

client = TestClient(app)


def _png_bytes(size=(64, 64)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, "white").save(buf, format="PNG")
    return buf.getvalue()


GOOD_JSON = json.dumps(
    {
        "merchant": "Indomaret",
        "date": "2026-10-20",
        "total_idr": 47500,
        "items": [
            {"name": "Roti Tawar", "qty": 1, "price_idr": 17500},
            {"name": "Susu UHT", "qty": 2, "price_idr": 15000},
        ],
        "category": "makanan",
    }
)


def test_parse_receipt_json_happy_path():
    r = parse_receipt_json(GOOD_JSON)
    assert r["total_idr"] == 47500
    assert r["merchant"] == "Indomaret"
    assert r["date"] == "2026-10-20"
    assert r["category"] == "makanan"
    assert len(r["items"]) == 2
    assert r["description"].startswith("Struk Indomaret")


def test_parse_receipt_json_strips_code_fences_and_formats_amounts():
    raw = '```json\n{"merchant": "Apotek K24", "total_idr": "Rp 35.000", "items": [{"name": "Paracetamol", "qty": 1, "price_idr": 35000}]}\n```'
    r = parse_receipt_json(raw)
    assert r["total_idr"] == 35000
    assert r["category"] == "kesehatan"  # deterministic classifier beats the model's missing suggestion


def test_parse_receipt_json_drops_decimal_cents():
    assert parse_receipt_json('{"total_idr": "25.000,00", "items": []}')["total_idr"] == 25000


def test_parse_receipt_json_falls_back_to_item_sum_when_total_missing():
    raw = json.dumps(
        {"total_idr": None, "items": [{"name": "Nasi Goreng", "qty": 2, "price_idr": 15000}]}
    )
    assert parse_receipt_json(raw)["total_idr"] == 30000


def test_parse_receipt_json_invalid_category_falls_back_to_makanan():
    r = parse_receipt_json('{"total_idr": 10000, "category": "elektronik", "items": []}')
    assert r["category"] == "makanan"


@pytest.mark.parametrize(
    "raw",
    ["", "bukan json", "[1, 2]", '{"total_idr": null, "items": []}', '{"total_idr": -5, "items": []}'],
)
def test_parse_receipt_json_rejects_unusable_output(raw):
    with pytest.raises(ReceiptOCRError):
        parse_receipt_json(raw)


def test_prepare_image_validates_and_downsizes():
    jpeg = prepare_image(_png_bytes((3200, 2000)))
    with Image.open(io.BytesIO(jpeg)) as img:
        assert img.format == "JPEG"
        assert max(img.size) <= receipt_ocr.MAX_DIMENSION

    with pytest.raises(ReceiptOCRError) as e:
        prepare_image(b"ini bukan gambar")
    assert e.value.code == "invalid_image"

    with pytest.raises(ReceiptOCRError) as e:
        prepare_image(b"")
    assert e.value.code == "invalid_image"

    with pytest.raises(ReceiptOCRError) as e:
        prepare_image(b"\x00" * (receipt_ocr.MAX_RECEIPT_BYTES + 1))
    assert e.value.code == "too_large"


def test_scan_receipt_logs_tokens_and_does_not_record_transaction(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    initialize_master_database(settings.master_db_path)

    result = scan_receipt(_png_bytes(), vision_fn=lambda jpeg: (GOOD_JSON, 900, 120))
    assert result["total_idr"] == 47500

    with get_db_cursor() as cur:
        cur.execute("SELECT tokens_in, tokens_out FROM token_logs WHERE module = 'finance_receipt_ocr';")
        row = cur.fetchone()
        assert (row["tokens_in"], row["tokens_out"]) == (900, 120)
        cur.execute("SELECT COUNT(*) FROM financial_transactions;")
        assert cur.fetchone()[0] == 0  # preview only: confirmation is a separate step


def test_call_gemini_vision_requires_api_key(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "gemini_api_key", None)
    initialize_master_database(settings.master_db_path)
    with pytest.raises(ReceiptOCRError) as e:
        receipt_ocr.call_gemini_vision(b"jpeg")
    assert e.value.code == "no_api_key"


def test_api_receipt_scan_then_confirm(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    initialize_master_database(settings.master_db_path)
    monkeypatch.setattr(receipt_ocr, "call_gemini_vision", lambda jpeg: (GOOD_JSON, 500, 80))

    scan = client.post(
        "/api/v1/finance/receipt/scan",
        files={"file": ("struk.png", _png_bytes(), "image/png")},
    )
    assert scan.status_code == 200
    body = scan.json()
    assert body["status"] == "preview"
    receipt = body["receipt"]
    assert receipt["total_idr"] == 47500

    confirm = client.post(
        "/api/v1/finance/receipt/confirm",
        json={
            "total_idr": receipt["total_idr"],
            "category": receipt["category"],
            "merchant": receipt["merchant"],
            "description": receipt["description"],
        },
    )
    assert confirm.status_code == 200
    assert confirm.json()["status"] == "recorded"

    with get_db_cursor() as cur:
        cur.execute("SELECT amount_idr, source, used_llm, merchant FROM financial_transactions;")
        row = cur.fetchone()
        assert (row["amount_idr"], row["source"], row["used_llm"], row["merchant"]) == (
            47500, "ocr", 1, "Indomaret",
        )


def test_api_receipt_error_mapping(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "gemini_api_key", None)
    initialize_master_database(settings.master_db_path)

    bad = client.post(
        "/api/v1/finance/receipt/scan",
        files={"file": ("x.txt", b"bukan gambar", "text/plain")},
    )
    assert bad.status_code == 400

    no_key = client.post(
        "/api/v1/finance/receipt/scan",
        files={"file": ("struk.png", _png_bytes(), "image/png")},
    )
    assert no_key.status_code == 503

    bad_cat = client.post(
        "/api/v1/finance/receipt/confirm",
        json={"total_idr": 1000, "category": "elektronik"},
    )
    assert bad_cat.status_code == 422
