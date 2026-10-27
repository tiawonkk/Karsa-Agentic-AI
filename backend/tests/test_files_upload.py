"""Real uploads (PRD, dataset), the active project folder and the folder endpoints."""
import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.core import project_folder as pf

client = TestClient(app)


def up(kind, name, data):
    return client.post("/api/v1/files/upload", data={"kind": kind}, files={"file": (name, io.BytesIO(data))})


def test_prd_markdown_is_extracted_with_outline():
    r = up("prd", "prd.md", b"# PRD TokoKu\n\n## Tujuan\n- jual\n\n## Fitur\n- katalog\n")
    assert r.status_code == 200
    j = r.json()
    assert "Fitur" in j["text"] and j["summary"]["title"] == "PRD TokoKu" and "Tujuan" in j["summary"]["headings"]


def test_prd_docx_is_extracted():
    import docx

    d = docx.Document()
    d.add_paragraph("Dokumen PRD aplikasi kasir dengan fitur stok dan laporan harian.")
    buf = io.BytesIO()
    d.save(buf)
    r = up("prd", "prd.docx", buf.getvalue())
    assert r.status_code == 200 and "kasir" in r.json()["text"]


def test_rejects_wrong_format_and_empty():
    assert up("prd", "x.exe", b"MZ").status_code == 415
    assert up("dataset", "x.csv", b"").status_code == 400
    assert up("nope", "x.csv", b"a").status_code == 422


def test_dataset_preview_has_real_numbers():
    csv = b"nama,umur,kota\nA,20,X\nB,,Y\nB,,Y\nC,30,\n"
    j = up("dataset", "d.csv", csv).json()["preview"]
    assert (j["rows"], j["columns"]) == (4, 3)
    assert j["duplicates"] == 1 and j["missing_total"] == 3
    assert len(j["head"]) == 4 and {c["name"] for c in j["column_info"]} == {"nama", "umur", "kota"}


def test_dataset_xlsx_and_json_preview():
    import pandas as pd

    buf = io.BytesIO()
    pd.DataFrame({"a": [1, 2], "b": ["x", None]}).to_excel(buf, index=False)
    assert up("dataset", "d.xlsx", buf.getvalue()).json()["preview"]["rows"] == 2
    assert up("dataset", "d.json", b'[{"a":1},{"a":2},{"a":3}]').json()["preview"]["rows"] == 3


def test_clean_writes_csv_and_xlsx_into_project_folder(tmp_path, monkeypatch):
    folder = tmp_path / "RisetData"
    folder.mkdir()
    monkeypatch.setattr(pf, "validate_folder", lambda p, must_exist=True: Path(p))
    assert client.put("/api/v1/project/folder", json={"path": str(folder)}).status_code == 200
    path = up("dataset", "d.csv", b"nama,umur\nA,20\nA,20\nB,\n").json()["path"]
    r = client.post("/api/v1/files/dataset/clean", json={"path": path})
    assert r.status_code == 200
    j = r.json()
    assert j["in_project_folder"] and j["saved_in"] == str(folder)
    names = sorted(f["name"] for f in j["files"])
    assert names == ["d_clean.csv", "d_clean.xlsx"] and all((folder / n).exists() for n in names)


def test_clean_refuses_paths_outside_uploads(tmp_path):
    outside = tmp_path / "secret.csv"
    outside.write_text("a\n1\n")
    r = client.post("/api/v1/files/dataset/clean", json={"path": str(outside)})
    assert r.status_code == 404


def test_project_folder_validation_and_create(tmp_path, monkeypatch):
    assert client.put("/api/v1/project/folder", json={"path": "relatif/folder"}).status_code == 400
    assert client.put("/api/v1/project/folder", json={"path": r"C:WindowsSystem32"}).status_code == 400
    assert client.put("/api/v1/project/folder", json={"path": str(Path(__file__).parents[2])}).status_code == 400  # inside Karsa itself
    monkeypatch.setattr(pf, "validate_folder", lambda p, must_exist=True: Path(p))
    base = tmp_path / "Proyek"
    base.mkdir()
    assert client.put("/api/v1/project/folder", json={"path": str(base)}).json()["path"] == str(base)
    r = client.post("/api/v1/project/folder/create", json={"name": "Toko Ku: v1?"})
    assert r.status_code == 200 and (base / "Toko_Ku_v1").is_dir()
    assert client.get("/api/v1/project/folder").json()["path"] == str(base / "Toko_Ku_v1")


def test_pick_folder_uses_native_dialog_and_handles_cancel(tmp_path, monkeypatch):
    monkeypatch.setattr(pf, "validate_folder", lambda p, must_exist=True: Path(p))
    monkeypatch.setattr(pf, "pick_folder_dialog", lambda initial=None, timeout=300: None)
    assert client.post("/api/v1/system/pick-folder").json() == {"path": None, "cancelled": True}
    chosen = tmp_path / "Dipilih"
    chosen.mkdir()
    monkeypatch.setattr(pf, "pick_folder_dialog", lambda initial=None, timeout=300: str(chosen))
    assert client.post("/api/system/pick-folder").json()["path"] == str(chosen)


def test_open_folder_needs_a_folder_and_calls_the_opener(tmp_path, monkeypatch):
    assert client.post("/api/v1/system/open-folder", json={}).status_code == 400
    monkeypatch.setattr(pf, "validate_folder", lambda p, must_exist=True: Path(p))
    opened = []
    monkeypatch.setattr(pf, "open_in_explorer", lambda p: opened.append(("e", p)))
    monkeypatch.setattr(pf, "open_in_vscode", lambda p: opened.append(("v", p)))
    client.post("/api/v1/system/open-folder", json={"path": str(tmp_path)})
    client.post("/api/v1/system/open-folder", json={"path": str(tmp_path), "app": "vscode"})
    assert [k for k, _ in opened] == ["e", "v"]


def test_list_dirs(tmp_path):
    (tmp_path / "a").mkdir()
    (tmp_path / ".hidden").mkdir()
    j = client.get("/api/v1/system/list-dirs", params={"path": str(tmp_path)}).json()
    assert str(tmp_path / "a") in j["dirs"] and not any(".hidden" in d for d in j["dirs"])
