"""Research search and dataset cleaning, tested with the messy situations real students run into."""
import io
from pathlib import Path

import httpx
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.core.database import get_db_cursor
from backend.modules.research_writer import research_tools as rt

client = TestClient(app)

ARXIV_XML = """<feed><entry><id>http://arxiv.org/abs/2401.00001v1</id><title>Graph  Neural
 Networks</title><summary>We study GNNs.</summary><published>2024-01-02T00:00:00Z</published>
<author><name>A. One</name></author><author><name>B. Two</name></author>
<link title="pdf" href="http://arxiv.org/pdf/2401.00001v1"/></entry></feed>"""
CROSSREF_JSON = {"message": {"items": [{"title": ["Deep Learning"], "DOI": "10.1/abc", "author": [{"given": "C", "family": "Three"}],
                                        "issued": {"date-parts": [[2020]]}, "URL": "https://doi.org/10.1/abc"}]}}


def fake_fetch(arxiv=None, crossref=None):
    """Replace the network: each source can return a body or raise ResearchSearchError."""

    def _f(url: str):
        which = "arxiv" if "arxiv.org" in url else "crossref"
        outcome = arxiv if which == "arxiv" else crossref
        if isinstance(outcome, Exception):
            raise outcome
        if which == "arxiv":
            return httpx.Response(200, text=outcome if outcome is not None else "<feed></feed>")
        return httpx.Response(200, json=outcome if outcome is not None else {"message": {"items": []}})

    return _f


# ============================================================================= research
def test_arxiv_results_are_parsed_and_cached(monkeypatch):
    monkeypatch.setattr(rt, "_fetch", fake_fetch(arxiv=ARXIV_XML))
    papers = rt.search_and_cache_papers("graph neural network", "arxiv", 3)
    assert len(papers) == 1 and papers[0]["title"] == "Graph Neural Networks"  # newlines/double spaces collapsed
    assert papers[0]["authors"] == "A. One, B. Two" and papers[0]["publication_year"] == 2024
    with get_db_cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM academic_papers;")
        assert cur.fetchone()[0] == 1


def test_searching_twice_does_not_duplicate_cached_papers(monkeypatch):
    monkeypatch.setattr(rt, "_fetch", fake_fetch(arxiv=ARXIV_XML))
    rt.search_and_cache_papers("gnn", "arxiv", 3)
    rt.search_and_cache_papers("gnn", "arxiv", 3)
    with get_db_cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM academic_papers;")
        assert cur.fetchone()[0] == 1


def test_no_results_is_reported_as_no_results_never_a_made_up_paper(monkeypatch):
    monkeypatch.setattr(rt, "_fetch", fake_fetch())  # both sources answer, with nothing
    assert rt.search_and_cache_papers("asdkjhasd qwe", "arxiv", 3) == []
    with get_db_cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM academic_papers;")
        assert cur.fetchone()[0] == 0  # the old code cached an invented "Comprehensive Survey" here


def test_arxiv_down_falls_back_to_crossref(monkeypatch):
    monkeypatch.setattr(rt, "_fetch", fake_fetch(arxiv=rt.ResearchSearchError("sumber membalas HTTP 503"), crossref=CROSSREF_JSON))
    papers = rt.search_and_cache_papers("deep learning", "arxiv", 3)
    assert papers and papers[0]["source"] == "crossref" and papers[0]["doi"] == "10.1/abc"


def test_both_sources_down_is_an_honest_error(monkeypatch):
    err = rt.ResearchSearchError("tidak bisa menghubungi sumber (ConnectError)")
    monkeypatch.setattr(rt, "_fetch", fake_fetch(arxiv=err, crossref=err))
    with pytest.raises(rt.ResearchSearchError, match="gagal"):
        rt.search_and_cache_papers("x y", "arxiv", 3)
    out = rt.search_papers_tool.invoke({"query": "x y", "source": "arxiv", "max_results": 2})
    assert out.get("status") != "success"  # the tool tells the model it failed instead of inventing results


def test_blank_and_unknown_sources():
    with pytest.raises(ValueError):
        rt.search_and_cache_papers("   ", "arxiv", 3)
    with pytest.raises(ValueError):
        rt.search_and_cache_papers("x", "google", 3)  # type: ignore[arg-type]


def test_garbage_response_is_an_error_not_a_crash(monkeypatch):
    monkeypatch.setattr(rt, "_fetch", lambda url: httpx.Response(200, text="<html>bukan json</html>"))
    with pytest.raises(rt.ResearchSearchError):
        rt.query_crossref_api("topik", 3)
    assert rt.query_arxiv_api("topik", 3) == []  # no <entry> in the page: nothing found, not a crash


def test_fetch_follows_the_arxiv_redirect_and_names_http_errors(monkeypatch):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if request.url.scheme == "http":
            return httpx.Response(301, headers={"location": str(request.url).replace("http://", "https://")})
        return httpx.Response(429 if "limit" in str(request.url) else 200, text="<feed></feed>")

    transport = httpx.MockTransport(handler)
    real_client = httpx.Client
    monkeypatch.setattr(rt.httpx, "Client", lambda **kw: real_client(transport=transport, **kw))
    assert rt._fetch("http://export.arxiv.org/api/query?x=1").status_code == 200  # redirect followed (it used to give up -> 0 papers)
    assert calls[0].startswith("http://") and calls[-1].startswith("https://")
    with pytest.raises(rt.ResearchSearchError, match="membatasi"):
        rt._fetch("https://export.arxiv.org/api/query?limit=1")


def test_research_chat_flow_reports_errors_and_empty_results(monkeypatch):
    from langchain_core.messages import HumanMessage

    from backend.modules.base_module import ModuleContext
    from backend.modules.research_writer.module import ResearchModule

    graph = ResearchModule().build_graph(ModuleContext(session_thread_id="t"))
    monkeypatch.setattr(rt, "_fetch", fake_fetch())
    empty = graph.invoke({"messages": [HumanMessage(content="carikan paper arxiv tentang zzzxqk")]})["messages"][-1].content
    assert "Tidak ada paper yang cocok" in empty
    err = rt.ResearchSearchError("offline")
    monkeypatch.setattr(rt, "_fetch", fake_fetch(arxiv=err, crossref=err))
    down = graph.invoke({"messages": [HumanMessage(content="carikan paper arxiv tentang gnn")]})["messages"][-1].content
    assert "Pencarian paper gagal" in down


# ============================================================================= data cleaning (through the real API)
MESSY = (
    "Nama Siswa , Nilai UTS,Tanggal Lahir ,Uang Saku,Kota\n"
    "  Budi ,85,2004-03-05,Rp 1.500.000,Jakarta\n"
    "Siti,N/A,05/04/2003,\"Rp 2.000.000\",bandung\n"
    "  Budi ,85,2004-03-05,Rp 1.500.000,Jakarta\n"      # exact duplicate
    ",,,,\n"                                           # empty row
    "Andi,78,2004-07-30,-,Surabaya\n"
    "Dewi,abc,2002-12-01,Rp 900.000,  \n"
)


def make_notebook_with(tmp_path: Path, name: str, data: bytes) -> int:
    nid = client.post("/api/v1/notebooks", json={"title": "Data"}).json().get("id")
    nid = nid or client.get("/api/v1/notebooks").json()["notebooks"][0]["id"]
    r = client.post(f"/api/v1/notebooks/{nid}/sources/file", files={"file": (name, io.BytesIO(data), "text/csv")})
    assert r.status_code == 200, r.text
    return nid


def first_source_id(nid: int) -> int:
    nb = client.get(f"/api/v1/notebooks/{nid}").json()
    return nb["sources"][0]["id"]


def test_messy_csv_preview_does_not_touch_the_file_and_reports_what_it_would_do(tmp_path):
    nid = make_notebook_with(tmp_path, "nilai.csv", MESSY.encode())
    sid = first_source_id(nid)
    prev = client.post(f"/api/v1/notebooks/sources/{sid}/clean/preview", json={"options": {}})
    assert prev.status_code == 200, prev.text
    rep = prev.json()
    text = str(rep).lower()
    assert "duplik" in text or "duplicate" in text
    assert client.get(f"/api/v1/notebooks/{nid}").json()["sources"][0]["id"] == sid  # preview created nothing


def test_apply_writes_a_new_clean_file_and_keeps_the_original(tmp_path):
    nid = make_notebook_with(tmp_path, "nilai.csv", MESSY.encode())
    sid = first_source_id(nid)
    r = client.post(f"/api/v1/notebooks/sources/{sid}/clean/apply", json={"options": {}})
    assert r.status_code == 200, r.text
    out_path = Path(r.json().get("output_path") or r.json().get("path") or r.json()["file"]["path"])
    assert out_path.exists() and out_path.name.endswith("_clean.csv") and "nilai" in out_path.name
    cleaned = pd.read_csv(out_path)
    assert list(cleaned.columns)[:2] == ["nama_siswa", "nilai_uts"]  # headers normalised
    assert len(cleaned) == 4  # duplicate and empty row dropped; 4 distinct people remain
    assert cleaned["nama_siswa"].str.strip().tolist()[0] == "Budi"
    assert cleaned["nilai_uts"].isna().sum() == 1  # "N/A" became missing; nothing was filled with a made-up value
    assert "abc" in cleaned["nilai_uts"].astype(str).tolist()  # the typo is kept (not destroyed) ...
    assert any("nilai_uts" in w["detail"] for w in r.json()["warnings"])  # ... and the user is told about it
    assert cleaned["uang_saku"].dropna().tolist() == [1500000.0, 2000000.0, 900000.0]  # "Rp 1.500.000" -> number
    original = Path(client.get(f"/api/v1/notebooks/{nid}").json()["sources"][0].get("path") or "")
    if original.exists():
        assert "Nama Siswa" in original.read_text(encoding="utf-8")  # the source file is untouched


def test_filling_missing_values_is_opt_in(tmp_path):
    nid = make_notebook_with(tmp_path, "nilai.csv", MESSY.encode())
    sid = first_source_id(nid)
    r = client.post(f"/api/v1/notebooks/sources/{sid}/clean/apply", json={"options": {"fill_missing": "median"}})
    assert r.status_code == 200
    out = Path(r.json().get("output_path") or r.json().get("path") or r.json()["file"]["path"])
    assert pd.read_csv(out)["nilai_uts"].isna().sum() == 0
    assert client.post(f"/api/v1/notebooks/sources/{sid}/clean/preview", json={"options": {"fill_missing": "bogus"}}).status_code in (400, 422)


@pytest.mark.parametrize(
    "name,data",
    [
        ("kosong.csv", b""),
        ("header_saja.csv", b"a,b,c\n"),
        ("satu_kolom.csv", b"nilai\n1\n2\n2\n"),
        ("titik_koma.csv", b"nama;nilai\nBudi;90\nSiti;80\n"),
        ("bom.csv", "﻿nama,nilai\nBudi,90\n".encode("utf-8")),
    ],
)
def test_unusual_csv_files_never_crash_the_server(tmp_path, name, data):
    nid = client.post("/api/v1/notebooks", json={"title": "Aneh"}).json().get("id")
    nid = nid or client.get("/api/v1/notebooks").json()["notebooks"][0]["id"]
    r = client.post(f"/api/v1/notebooks/{nid}/sources/file", files={"file": (name, io.BytesIO(data), "text/csv")})
    assert r.status_code in (200, 400, 413, 422), r.text  # a clear answer, never a 500
    if r.status_code == 200:
        sid = first_source_id(nid)
        for action in ("preview", "apply"):
            assert client.post(f"/api/v1/notebooks/sources/{sid}/clean/{action}", json={"options": {}}).status_code in (200, 400, 422)


def test_cleaning_a_source_that_is_gone_or_not_a_dataset():
    assert client.post("/api/v1/notebooks/sources/9999/clean/preview", json={"options": {}}).status_code == 404
    assert client.post("/api/v1/notebooks/sources/9999/clean/apply", json={"options": {}}).status_code == 404


def test_semicolon_csv_is_read_as_columns_not_one_column(tmp_path):
    from backend.modules.notebook.dataset_cleaner import load_dataset

    f = tmp_path / "id.csv"
    f.write_bytes(b"nama;nilai\nBudi;90\nSiti;80\n")
    df = load_dataset(f)
    assert list(df.columns) == ["nama", "nilai"] and len(df) == 2
