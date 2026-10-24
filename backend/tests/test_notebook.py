import io
import json
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.core.config import settings
from backend.core.database import initialize_master_database
from backend.modules.notebook import dataset_cleaner, service, store
from backend.modules.notebook.dataset_cleaner import CleanOptions, clean_dataframe, parse_number
from backend.modules.notebook.retrieval import chunk_text, rank, tokenize
from backend.modules.notebook.store import NotebookError

client = TestClient(app)

ML_TEXT = (
    "Pembelajaran mesin adalah cabang kecerdasan buatan yang memungkinkan komputer belajar dari data.\n\n"
    "Random forest adalah metode ensemble yang menggabungkan banyak pohon keputusan untuk meningkatkan akurasi.\n\n"
    "Dataset penelitian ini terdiri dari 1.200 baris data mahasiswa dengan 8 fitur akademik."
)
HEALTH_TEXT = "Konsumsi air putih yang cukup menjaga konsentrasi belajar. Kekurangan cairan menurunkan fokus."


@pytest.fixture()
def db(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    initialize_master_database(settings.master_db_path)
    return settings.master_db_path


# ----------------------------------------------------------------------------- retrieval


def test_chunk_text_respects_size_and_keeps_all_content():
    text = "\n\n".join(f"Paragraf nomor {i}. " + "kata " * 60 for i in range(12))
    chunks = chunk_text(text, size=500, overlap=50)
    assert len(chunks) > 3
    assert all(len(c) <= 700 for c in chunks)  # size + overlap tail
    joined = " ".join(chunks)
    assert "nomor 0." in joined and "nomor 11." in joined
    assert chunk_text("   ") == []


def test_bm25_ranks_the_relevant_chunk_first_and_ignores_stopwords():
    chunks = [{"text": t} for t in [ML_TEXT.split("\n\n")[1], HEALTH_TEXT, ML_TEXT.split("\n\n")[2]]]
    hits = rank("apa itu random forest?", chunks)
    assert hits and "Random forest" in hits[0]["text"]
    assert rank("xyzzy plugh", chunks) == []  # nothing matches -> nothing returned
    assert "yang" not in tokenize("yang adalah data the of")


# ----------------------------------------------------------------------------- store + ask


def test_notebook_store_roundtrip(db):
    nb = store.create_notebook("Skripsi ML", db_path=db)
    src = store.add_source(nb["id"], "ml.txt", "document", ML_TEXT, db_path=db)
    assert src["chunk_count"] >= 1
    assert store.get_notebook(nb["id"], db_path=db)["sources"][0]["name"] == "ml.txt"
    assert store.list_notebooks(db_path=db)[0]["source_count"] == 1
    with pytest.raises(NotebookError):
        store.add_source(nb["id"], "kosong", "text", "   ", db_path=db)
    with pytest.raises(NotebookError):
        store.get_notebook(999, db_path=db)
    store.remove_source(src["id"], db_path=db)
    assert store.load_chunks(nb["id"], db_path=db) == []
    store.delete_notebook(nb["id"], db_path=db)
    assert store.list_notebooks(db_path=db) == []


def _notebook_with_sources(db):
    nb = store.create_notebook("Riset", db_path=db)
    ml = store.add_source(nb["id"], "ml.txt", "document", ML_TEXT, db_path=db)
    health = store.add_source(nb["id"], "kesehatan.txt", "document", HEALTH_TEXT, db_path=db)
    return nb, ml, health


def test_ask_is_grounded_and_returns_only_cited_excerpts(db):
    nb, ml, _ = _notebook_with_sources(db)
    seen = {}

    def fake_llm(system, user):
        seen["system"], seen["user"] = system, user
        return "Random forest menggabungkan banyak pohon keputusan [1]."

    res = service.ask(nb["id"], "Apa itu random forest?", llm_fn=fake_llm, db_path=db)
    assert res["mode"] == "llm"
    assert "HANYA berdasarkan" in seen["system"]
    assert "KUTIPAN SUMBER" in seen["user"] and "random forest" in seen["user"].lower()
    assert [c["n"] for c in res["citations"]] == [1]
    assert res["citations"][0]["source"] == "ml.txt"


def test_ask_without_relevant_source_does_not_call_the_llm(db):
    nb, _, _ = _notebook_with_sources(db)

    def boom(system, user):
        raise AssertionError("LLM must not be called when nothing matches")

    res = service.ask(nb["id"], "Siapa presiden pertama Amerika Serikat?", llm_fn=boom, db_path=db)
    assert res["mode"] == "no_match" and res["citations"] == []


def test_ask_falls_back_to_extractive_when_llm_fails(db):
    nb, _, _ = _notebook_with_sources(db)

    def down(system, user):
        raise RuntimeError("API key belum dipasang")

    res = service.ask(nb["id"], "random forest", llm_fn=down, db_path=db)
    assert res["mode"] == "extractive"
    assert "[1]" in res["answer"] and res["citations"]


def test_ask_requires_sources_and_a_question(db):
    nb = store.create_notebook("Kosong", db_path=db)
    with pytest.raises(NotebookError):
        service.ask(nb["id"], "apa?", llm_fn=lambda s, u: "x", db_path=db)
    with pytest.raises(NotebookError):
        service.ask(nb["id"], "  ", llm_fn=lambda s, u: "x", db_path=db)


# ----------------------------------------------------------------------------- paper draft


PAPER_JSON = json.dumps(
    {
        "title": "Penerapan Random Forest pada Data Mahasiswa",
        "abstract": "Penelitian ini membahas random forest [1].",
        "introduction": "Pembelajaran mesin memungkinkan komputer belajar dari data [1].",
        "methods": "Dataset terdiri dari 1.200 baris dan 8 fitur [1].",
        "results": "Bagian ini perlu data tambahan dari penulis.",
        "discussion": "Konsentrasi belajar dipengaruhi hidrasi [2].",
    }
)


def test_generate_paper_with_llm_builds_references_for_cited_sources(db):
    nb, _, _ = _notebook_with_sources(db)
    paper = service.generate_paper(nb["id"], "random forest mahasiswa", llm_fn=lambda s, u: f"```json\n{PAPER_JSON}\n```", db_path=db)
    assert paper["mode"] == "llm"
    assert paper["title"].startswith("Penerapan Random Forest")
    assert set(paper["sections"]) == {"introduction", "methods", "results", "discussion"}
    assert any("ml.txt" in r for r in paper["references"])
    assert paper["markdown"].startswith("**Penerapan Random Forest")
    assert "## Daftar Sumber" in paper["markdown"]


def test_generate_paper_fallback_uses_real_excerpts_only(db):
    nb, _, _ = _notebook_with_sources(db)

    def down(system, user):
        raise RuntimeError("offline")

    paper = service.generate_paper(nb["id"], "random forest", llm_fn=down, db_path=db)
    assert paper["mode"] == "extractive"
    body = " ".join(paper["sections"].values())
    assert "Bahan dari sumber" in body and "[1]" in body
    assert "random forest" in body.lower()  # evidence comes from the source text, nothing invented


def test_export_paper_docx_creates_a_word_file_without_overwriting(db, tmp_path):
    import docx

    paper = {
        "title": "Judul Uji",
        "abstract": "Abstrak uji.",
        "sections": {"introduction": "Isi pendahuluan [1].", "methods": "m", "results": "r", "discussion": "d"},
        "references": ["[1] ml.txt"],
    }
    out = service.export_paper_docx(paper, out_dir=tmp_path / "out")
    f = Path(out["path"])
    assert f.exists() and f.suffix == ".docx"
    text = "\n".join(p.text for p in docx.Document(f).paragraphs)
    assert "Judul Uji" in text and "Isi pendahuluan [1]." in text and "[1] ml.txt" in text
    with pytest.raises(NotebookError):
        service.export_paper_docx({"title": "x", "sections": {}}, out_dir=tmp_path / "out")


def test_generate_study_outputs(db):
    nb, _, _ = _notebook_with_sources(db)
    res = service.generate_study(nb["id"], "briefing", llm_fn=lambda s, u: "Ringkasan [1][2]", db_path=db)
    assert res["mode"] == "llm" and {c["n"] for c in res["citations"]} == {1, 2}
    with pytest.raises(NotebookError):
        service.generate_study(nb["id"], "podcast", llm_fn=lambda s, u: "x", db_path=db)


# ----------------------------------------------------------------------------- dataset cleaner


MESSY = (
    "Nama Siswa ,Nilai UTS,Gaji,Tanggal Lahir,Catatan,Kosong\n"
    " Budi ,85,Rp 1.250.000,12/03/2001,-,\n"
    "Budi,85,Rp 1.250.000,12/03/2001,N/A,\n"
    "Siti,90,Rp 2.000.000,05/11/2000,ok,\n"
    ",,,,,\n"
    "Ani,1000,Rp 900.000,20/01/2002,ok,\n"
    "Dedi,88,Rp 1.100.000,07/07/2001,ok,\n"
    "Eka,86,Rp 1.050.000,08/08/2001,ok,\n"
    "Fitri,87,Rp 1.000.000,09/09/2001,ok,\n"
    "Gita,89,Rp 1.150.000,10/10/2001,ok,\n"
    "Hadi,84,Rp 1.200.000,11/11/2001,ok,\n"
)


def _messy_df() -> pd.DataFrame:
    return pd.read_csv(io.StringIO(MESSY), dtype=str, keep_default_na=False)


def test_parse_number_handles_indonesian_and_english_formats():
    assert parse_number("Rp 1.250.000") == 1250000
    assert parse_number("1.234,56") == 1234.56
    assert parse_number("1,234.56") == 1234.56
    assert parse_number("12,5%") == 12.5
    assert parse_number("(500)") == -500
    assert parse_number("abc") is None and parse_number("") is None


def test_clean_dataframe_applies_each_step_and_reports_it():
    out, rep = clean_dataframe(_messy_df(), CleanOptions())
    assert list(out.columns) == ["nama_siswa", "nilai_uts", "gaji", "tanggal_lahir", "catatan"]  # headers, empty column gone
    assert out["nama_siswa"].iloc[0] == "Budi"  # trimmed
    assert int(out["gaji"].iloc[0]) == 1250000  # Rp 1.250.000 -> number
    assert out["tanggal_lahir"].iloc[0] == "2001-03-12"  # day-first ISO
    assert len(out) == 8  # duplicate Budi + fully empty row removed
    assert out["catatan"].isna().iloc[0]  # '-' became missing
    steps = {s["step"] for s in rep["steps"]}
    assert {"normalize_headers", "strip_text", "missing_tokens", "drop_empty_columns", "drop_empty_rows",
            "coerce_numeric", "parse_dates", "drop_duplicates", "flag_outliers"} <= steps
    assert rep["outliers"]["nilai_uts"] == 1  # 1000 is flagged (IQR) but never changed
    assert int(out["nilai_uts"].max()) == 1000
    assert rep["before"]["rows"] == 10 and rep["after"]["rows"] == 8


def test_imputation_is_opt_in():
    out_default, _ = clean_dataframe(_messy_df(), CleanOptions())
    assert out_default["catatan"].isna().sum() == 1  # left empty, not silently filled
    out_fill, rep = clean_dataframe(_messy_df(), CleanOptions(fill_missing="mode"))
    assert out_fill["catatan"].isna().sum() == 0
    assert any(s["step"] == "fill_missing" for s in rep["steps"])
    out_drop, _ = clean_dataframe(_messy_df(), CleanOptions(fill_missing="drop"))
    assert len(out_drop) == 7


def test_preview_does_not_touch_the_original_and_apply_writes_a_new_file(tmp_path):
    src = tmp_path / "siswa.csv"
    src.write_text(MESSY, encoding="utf-8")
    original = src.read_bytes()

    rep = dataset_cleaner.preview(src, {})
    assert len(rep["sample"]) == 5 and rep["after"]["rows"] == 8
    assert src.read_bytes() == original

    out_dir = tmp_path / "outputs"
    res = dataset_cleaner.apply_clean(src, {}, out_dir=out_dir)
    cleaned = pd.read_csv(res["output_path"])
    assert res["output_name"] == "siswa_clean.csv" and len(cleaned) == 8
    assert src.read_bytes() == original
    res2 = dataset_cleaner.apply_clean(src, {}, out_dir=out_dir)  # second run must not overwrite the first
    assert res2["output_name"] != res["output_name"] and Path(res["output_path"]).exists()

    with pytest.raises(NotebookError):
        CleanOptions.from_dict({"fill_missing": "magic"})
    with pytest.raises(NotebookError):
        dataset_cleaner.load_dataset(tmp_path / "ada.parquet")


def test_dataset_profile_text_is_compact_and_has_no_raw_rows(tmp_path):
    src = tmp_path / "siswa.csv"
    src.write_text(MESSY, encoding="utf-8")
    text = dataset_cleaner.profile_text(src)
    assert "Jumlah baris" in text and "nilai_uts (angka)" in text
    assert "Budi" not in text.replace("paling sering 'Budi'", "")  # no raw row dump
    assert len(text) < 2500


# ----------------------------------------------------------------------------- API


def test_notebook_api_end_to_end(db, monkeypatch):
    monkeypatch.setattr(service, "default_llm", lambda system, user: "Jawaban dari sumber [1].")

    nb = client.post("/api/v1/notebooks", json={"title": "Skripsi"}).json()
    nid = nb["id"]
    assert client.post("/api/v1/notebooks", json={"title": ""}).status_code == 422

    # document source (text) + file source (txt) + dataset source (csv)
    assert client.post(f"/api/v1/notebooks/{nid}/sources/text", json={"title": "ml", "text": ML_TEXT}).status_code == 200
    up = client.post(f"/api/v1/notebooks/{nid}/sources/file", files={"file": ("catatan.txt", HEALTH_TEXT.encode(), "text/plain")})
    assert up.status_code == 200 and up.json()["kind"] == "document"
    ds = client.post(f"/api/v1/notebooks/{nid}/sources/file", files={"file": ("siswa.csv", MESSY.encode(), "text/csv")})
    assert ds.status_code == 200 and ds.json()["kind"] == "dataset"
    bad = client.post(f"/api/v1/notebooks/{nid}/sources/file", files={"file": ("lagu.mp3", b"abc", "audio/mpeg")})
    assert bad.status_code == 400

    detail = client.get(f"/api/v1/notebooks/{nid}").json()
    assert [s["kind"] for s in detail["sources"]] == ["text", "document", "dataset"]

    ans = client.post(f"/api/v1/notebooks/{nid}/ask", json={"question": "apa itu random forest"}).json()
    assert ans["mode"] == "llm" and ans["citations"]

    # dataset cleaning: preview, then apply and index the cleaned file as a new source
    sid = detail["sources"][2]["id"]
    prev = client.post(f"/api/v1/notebooks/sources/{sid}/clean/preview", json={"options": {}}).json()
    assert prev["after"]["rows"] == 8 and prev["sample"]
    applied = client.post(f"/api/v1/notebooks/sources/{sid}/clean/apply", json={"options": {}, "add_to_notebook": True}).json()
    assert applied["output_name"].endswith("_clean.csv") and applied["added_source"]["kind"] == "dataset"
    dl = client.get(applied["download_url"])
    assert dl.status_code == 200 and b"nama_siswa" in dl.content
    assert client.get("/api/v1/files/outputs/..%2F..%2Fsecret.txt").status_code == 404
    text_src = detail["sources"][0]["id"]
    assert client.post(f"/api/v1/notebooks/sources/{text_src}/clean/preview", json={"options": {}}).status_code == 400

    # paper draft -> docx download
    monkeypatch.setattr(service, "default_llm", lambda system, user: PAPER_JSON)
    paper = client.post(f"/api/v1/notebooks/{nid}/generate", json={"kind": "paper_draft", "topic": "random forest"}).json()
    assert paper["kind"] == "paper_draft" and paper["references"]
    exp = client.post(f"/api/v1/notebooks/{nid}/export/docx", json={"paper": paper}).json()
    assert exp["filename"].endswith(".docx")
    assert client.get(exp["download_url"]).status_code == 200

    assert client.post(f"/api/v1/notebooks/{nid}/generate", json={"kind": "podcast"}).status_code == 422
    assert client.get("/api/v1/notebooks/9999").status_code == 404
    assert client.delete(f"/api/v1/notebooks/{nid}").json() == {"status": "deleted"}


def test_default_llm_falls_back_to_the_next_tier_when_the_first_fails(monkeypatch):
    calls = []

    class FakeModel:
        def __init__(self, tier):
            self.tier = tier

        def invoke(self, messages):
            calls.append(self.tier)
            if self.tier == "tier3_reasoning":
                raise RuntimeError("401 invalid key")

            class R:
                content = "dari tier utilitas"

            return R()

    class FakeRouter:
        def get_chat_model(self, tier, module_name, provider=None, model=None):
            return FakeModel(tier)

    import backend.core.llm_router as llm_router

    monkeypatch.setattr(llm_router, "router", FakeRouter())
    assert service.default_llm("sys", "user") == "dari tier utilitas"
    assert calls == ["tier3_reasoning", "tier1_utility"]

    class AllDown(FakeRouter):
        def get_chat_model(self, tier, module_name, provider=None, model=None):
            raise RuntimeError(f"{tier} down")

    monkeypatch.setattr(llm_router, "router", AllDown())
    with pytest.raises(RuntimeError):
        service.default_llm("sys", "user")


def test_default_llm_tries_other_gemini_models_when_the_tiers_are_out_of_quota(monkeypatch):
    tried = []

    class Quota:
        content = "dari model cadangan"

    class FakeModel:
        def __init__(self, name):
            self.name = name

        def invoke(self, messages):
            tried.append(self.name)
            if self.name != "gemini-3.1-flash-lite":
                raise RuntimeError("429 RESOURCE_EXHAUSTED")
            return Quota()

    class FakeRouter:
        def get_chat_model(self, tier, module_name, provider=None, model=None):
            return FakeModel(model or tier)

    import backend.core.llm_router as llm_router

    monkeypatch.setattr(llm_router, "router", FakeRouter())
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    assert service.default_llm("sys", "user") == "dari model cadangan"
    assert tried == ["tier3_reasoning", "tier1_utility", "gemini-3.5-flash", "gemini-3.1-flash-lite"]

    monkeypatch.setattr(settings, "gemini_api_key", None)  # no Gemini key: no extra attempts
    tried.clear()
    with pytest.raises(RuntimeError):
        service.default_llm("sys", "user")
    assert tried == ["tier3_reasoning", "tier1_utility"]
