"""Notebook extras (URL sources, scanned-PDF OCR, audio overview, quiz) and the one-click ML-ready dataset export."""
import io
import json

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from backend.api.main import app
from backend.modules.notebook import extras, ml_export, service, store
from backend.modules.notebook.store import NotebookError

client = TestClient(app)

PAGE = """<html><head><title>Entropi dan Informasi</title><style>.x{}</style></head><body>
<nav>Menu Beranda Kontak</nav><script>alert(1)</script>
<article><h1>Entropi</h1><p>Entropi adalah ukuran ketidakpastian dalam sebuah sistem informasi. Semakin acak sebuah sumber, semakin besar entropinya.</p>
<p>Claude Shannon memperkenalkan konsep ini pada tahun 1948 untuk mengukur banyaknya informasi dalam sebuah pesan yang dikirim lewat saluran komunikasi.</p></article>
<footer>Hak cipta</footer></body></html>"""


@pytest.fixture(autouse=True)
def no_real_models(monkeypatch):
    monkeypatch.setattr("backend.api.automation.llm_available", lambda: False)


@pytest.fixture
def nb():
    return store.create_notebook("Uji")["id"]


def seeded_nb():
    nid = store.create_notebook("Bahan")["id"]
    store.add_source(nid, "bab1.txt", "document", "Entropi adalah ukuran ketidakpastian dalam sebuah sistem informasi. Teorema Shannon menyatakan batas kompresi data tanpa kehilangan. "
                     "Redundansi adalah bagian pesan yang dapat dihilangkan tanpa mengubah makna. Kode Huffman memberi simbol sering muncul kata kode yang lebih pendek.")
    return nid


# ----------------------------------------------------------------------------------------------- URL sources
def test_html_to_text_drops_scripts_menus_and_footers():
    title, text = extras.html_to_text(PAGE)
    assert title == "Entropi dan Informasi"
    assert "ukuran ketidakpastian" in text and "alert" not in text and "Menu Beranda" not in text and "Hak cipta" not in text


def test_url_source_is_added_and_searchable(nb, monkeypatch):
    monkeypatch.setattr(extras, "check_public_url", lambda u: u)
    src = extras.add_url_source(nb, "https://contoh.test/entropi", fetch=lambda u: ("text/html; charset=utf-8", PAGE))
    assert src["name"].startswith("Entropi dan Informasi") and src["kind"] == "text"
    chunks = store.load_chunks(nb)
    assert any("Shannon" in c["text"] for c in chunks) and any("Sumber: https://contoh.test/entropi" in c["text"] for c in chunks)


def test_private_and_bad_urls_are_refused():
    for bad in ("http://localhost:8765/api/v1/health", "http://127.0.0.1/x", "http://192.168.1.1/", "http://169.254.169.254/latest", "file:///etc/passwd", "ftp://x.test/a", "javascript:alert(1)", ""):
        with pytest.raises(NotebookError):
            extras.check_public_url(bad)


def test_thin_or_binary_pages_are_rejected_honestly(nb, monkeypatch):
    monkeypatch.setattr(extras, "check_public_url", lambda u: u)
    with pytest.raises(NotebookError, match="hampir tidak berisi teks"):
        extras.add_url_source(nb, "https://a.test", fetch=lambda u: ("text/html", "<html><body><div id=app></div></body></html>"))
    with pytest.raises(NotebookError, match="tidak didukung"):
        extras.add_url_source(nb, "https://a.test/x.zip", fetch=lambda u: ("application/zip", "PK"))


def test_url_endpoint_refuses_local_addresses(nb):
    r = client.post(f"/api/v1/notebooks/{nb}/sources/url", json={"url": "http://localhost:8765/api/v1/shelf/files"})
    assert r.status_code == 400 and "lokal" in r.json()["detail"]


# ----------------------------------------------------------------------------------------------- scanned PDF OCR
def scanned_pdf(tmp_path):
    img = Image.new("RGB", (600, 300), "white")
    ImageDraw.Draw(img).text((20, 20), "Catatan kuliah entropi", fill="black")
    p = tmp_path / "scan.pdf"
    img.save(p, "PDF")
    return p


def test_scanned_pdf_goes_through_ocr_and_is_indexed(nb, tmp_path):
    p = scanned_pdf(tmp_path)
    seen = []
    src = service.ingest_file(nb, p, "scan.pdf", ocr_fn=lambda jpeg: seen.append(len(jpeg)) or "Catatan kuliah entropi mengukur ketidakpastian informasi.")
    assert seen and src["kind"] == "document"
    assert any("ketidakpastian" in c["text"] for c in store.load_chunks(nb))
    assert any("OCR: 1 dari 1 halaman" in c["text"] for c in store.load_chunks(nb))


def test_scanned_pdf_without_a_key_explains_what_to_do(nb, tmp_path, monkeypatch):
    monkeypatch.setattr("backend.modules.finance.receipt_ocr._resolve_api_key", lambda: "")
    with pytest.raises(NotebookError, match="Pasang kunci Gemini"):
        service.ingest_file(nb, scanned_pdf(tmp_path), "scan.pdf")


# ----------------------------------------------------------------------------------------------- audio + quiz
def test_audio_overview_extractive_without_a_model():
    nid = seeded_nb()
    a = extras.audio_overview(nid, None)
    assert a["mode"] == "extractive" and a["segments"] and "Entropi" in a["segments"][0] and "tanpa AI" in a["title"]


def test_audio_overview_with_a_model():
    nid = seeded_nb()
    a = extras.audio_overview(nid, lambda s, u: json.dumps({"title": "Entropi singkat", "segments": ["Halo!", "Entropi itu ketidakpastian."]}))
    assert a["mode"] == "llm" and a["segments"][1].startswith("Entropi")


def test_empty_notebook_has_no_audio_or_quiz(nb):
    with pytest.raises(NotebookError):
        extras.audio_overview(nb, None)
    with pytest.raises(NotebookError):
        extras.generate_quiz(nb, 3, None)


def test_quiz_fallback_blanks_a_real_word_from_a_real_sentence():
    nid = seeded_nb()
    q = extras.generate_quiz(nid, 3, None)
    assert q["mode"] == "extractive" and 1 <= len(q["questions"]) <= 3
    for item in q["questions"]:
        assert "_____" in item["question"] and item["answer"] and item["answer"] not in item["question"]
        assert item["answer"] in store.load_chunks(nid)[0]["text"]


def test_quiz_with_a_model_drops_malformed_questions():
    nid = seeded_nb()
    good = {"question": "Apa itu entropi?", "options": ["A", "B", "C", "D"], "answer_index": 1, "explanation": "x", "source": "bab1.txt"}
    bad = {"question": "Rusak", "options": ["A", "B"], "answer_index": 5}
    q = extras.generate_quiz(nid, 5, lambda s, u: json.dumps({"questions": [good, bad]}))
    assert q["mode"] == "llm" and len(q["questions"]) == 1 and q["questions"][0]["answer_index"] == 1


def test_audio_and_quiz_endpoints():
    nid = seeded_nb()
    assert client.post(f"/api/v1/notebooks/{nid}/audio-overview").json()["segments"]
    assert client.post(f"/api/v1/notebooks/{nid}/quiz", json={"count": 2}).json()["questions"]
    assert client.post("/api/v1/notebooks/99999/quiz", json={}).status_code in (400, 404)


# ----------------------------------------------------------------------------------------------- ML-ready export
CSV = "Nama,Umur,Kota,Gaji,Lulus\nAni,20,Bandung,3000000,ya\nBudi,,Jakarta,4500000,tidak\nCici,22,Bandung,,ya\nDodi,24,Medan,5000000,ya\nAni,20,Bandung,3000000,ya\n"


def shelf_csv(name="mhs.csv", text=CSV):
    return client.post("/api/v1/shelf/upload", files={"file": (name, text.encode())}).json()["file"]["id"]


def test_ml_ready_cleans_imputes_encodes_scales_and_exports():
    sid = shelf_csv()
    r = client.post("/api/v1/studio/data/ml-ready", json={"shelf_id": sid, "target": "Lulus", "scale": "standard"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["rows"] == 4 and d["target"] == "lulus"  # one duplicate row removed, headers normalised
    assert any("diisi median" in s for s in d["steps"]) and any("One-hot" in s for s in d["steps"])
    assert d["label_mappings"]["lulus"] == {"tidak": 0, "ya": 1}
    got = client.get(d["downloads"]["ml_csv"])
    df = pd.read_csv(io.StringIO(got.text))
    assert not df.isna().any().any()  # ML-ready: no missing values
    assert "kota_Bandung" in df.columns and set(df["lulus"]) <= {0, 1}
    assert abs(df["gaji"].mean()) < 1e-9  # z-scored
    stats = pd.read_csv(io.StringIO(client.get(d["downloads"]["stats_csv"]).content.decode("utf-8-sig")))
    assert {"kolom", "rata_rata", "n_kosong"} <= set(stats.columns) and int(stats.loc[stats.kolom == "umur", "n_kosong"].iloc[0]) == 1  # stats describe the data before imputation
    assert client.get(d["downloads"]["stats_docx"]).status_code == 200
    svg = client.get(d["downloads"]["charts"][0])
    assert svg.status_code == 200 and "<svg" in svg.text and "<rect" in svg.text


def test_ml_ready_validation_errors():
    sid = shelf_csv("b.csv")
    assert client.post("/api/v1/studio/data/ml-ready", json={"shelf_id": sid, "target": "tidak_ada"}).status_code == 400
    assert client.post("/api/v1/studio/data/ml-ready", json={"shelf_id": sid, "scale": "log"}).status_code == 400
    assert client.post("/api/v1/studio/data/ml-ready", json={}).status_code == 422
    txt = client.post("/api/v1/shelf/upload", files={"file": ("a.txt", b"hai")}).json()["file"]["id"]
    assert client.post("/api/v1/studio/data/ml-ready", json={"shelf_id": txt}).status_code == 415
    assert client.post("/api/v1/studio/data/ml-ready", json={"shelf_id": 99999}).status_code == 404


def test_minmax_scale_and_label_encoding():
    out = ml_export.build_ml_ready(_write("mm.csv"), target=None, scale="minmax", encode="label")
    df = pd.read_csv(io.StringIO(client_get(out["files"]["ml_csv"])))
    assert df["gaji"].min() == 0 and df["gaji"].max() == 1 and "kota_Bandung" not in df.columns


def _write(name):
    from backend.core.config import settings

    p = settings.uploads_dir / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(CSV, encoding="utf-8")
    return p


def client_get(name):
    return client.get(f"/api/v1/files/outputs/{name}").text


def test_literature_endpoint_validates_and_returns_a_matrix(monkeypatch):
    from backend.modules.studio import literature

    papers = [{"source": "arxiv", "title": "RF on OULAD", "publication_year": 2024, "abstract": "random forest on the OULAD dataset, accuracy 90%"}]
    monkeypatch.setattr(literature, "search_all", lambda q, n: {"papers": papers, "errors": [{"source": "crossref", "error": "timeout"}]})
    assert client.post("/api/v1/studio/literature", json={"query": "ab"}).status_code == 422
    d = client.post("/api/v1/studio/literature", json={"query": "dropout"}).json()
    assert d["matrix"][0]["datasets"] == ["OULAD"] and d["errors"][0]["source"] == "crossref"
