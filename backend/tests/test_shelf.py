"""Smart File Shelf: real upload, list, download (drag-out), text for the AI, delete."""
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.core import shelf

client = TestClient(app)


def up(name: str, data: bytes):
    return client.post("/api/v1/shelf/upload", files={"file": (name, data)})


def test_upload_list_download_roundtrip():
    r = up("catatan kuliah.txt", "Entropi adalah ukuran ketidakpastian.".encode())
    assert r.status_code == 200
    f = r.json()["file"]
    assert f["name"] == "catatan kuliah.txt" and f["type"] == "document" and f["size"] > 0 and f["exists"]
    assert any(x["id"] == f["id"] for x in client.get("/api/v1/shelf/files").json()["files"])
    d = client.get(f"/api/v1/shelf/files/{f['id']}/download")
    assert d.status_code == 200 and d.content.startswith(b"Entropi")
    assert "catatan" in d.headers["content-disposition"]


def test_text_for_ai_documents_and_datasets():
    f = up("bab1.md", b"# Bab 1\nIsi pendahuluan penelitian.").json()["file"]
    t = client.get(f"/api/v1/shelf/files/{f['id']}/text").json()
    assert "pendahuluan" in t["text"] and t["kind"] == "document"
    c = up("nilai.csv", b"nama,nilai\nA,80\nB,90\nC,\n").json()["file"]
    assert c["type"] == "dataset"
    p = client.get(f"/api/v1/shelf/files/{c['id']}/text").json()
    assert p["kind"] == "dataset" and "nilai" in p["text"] and "A,80" not in p["text"]  # a profile, never raw rows


def test_unreadable_types_say_so_honestly():
    img = up("foto.png", b"\x89PNG\r\n\x1a\nxx").json()["file"]
    assert img["type"] == "image"
    assert client.get(f"/api/v1/shelf/files/{img['id']}/text").status_code == 415
    other = up("arsip.zip", b"PK\x03\x04").json()["file"]
    assert client.get(f"/api/v1/shelf/files/{other['id']}/text").status_code == 415


def test_empty_and_unsafe_names_and_missing_ids():
    assert up("kosong.txt", b"").status_code == 400
    f = up("../../evil.txt", b"x").json()["file"]
    assert f["name"] == "evil.txt"  # never leaves the shelf folder
    assert client.get("/api/v1/shelf/files/99999/download").status_code == 404
    assert client.delete("/api/v1/shelf/files/99999").status_code == 404


def test_delete_removes_the_stored_copy():
    f = up("hapus.txt", b"sementara").json()["file"]
    path, _ = shelf.file_path_of(f["id"])
    assert path.exists()
    assert client.delete(f"/api/v1/shelf/files/{f['id']}").status_code == 200
    assert not path.exists()
    assert client.get(f"/api/v1/shelf/files/{f['id']}/download").status_code == 404


def test_size_cap(monkeypatch):
    monkeypatch.setattr(shelf, "MAX_SHELF_BYTES", 10)
    assert up("besar.txt", b"x" * 11).status_code == 413
