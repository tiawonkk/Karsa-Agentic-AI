"""Coding help in a user's folder: read/explain, change a file with human approval, run tests, and every way it can go wrong."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.core.llm_router import router
from backend.modules.datascience_code import workspace as ws

client = TestClient(app)
NEW_CODE = "def add(a, b):\n    return a + b\n"
OLD_CODE = "def add(a, b):\n    return a - b  # bug\n"


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "proj"
    (root / "pkg").mkdir(parents=True)
    (root / "node_modules").mkdir()
    (root / "main.py").write_text(OLD_CODE, encoding="utf-8")
    (root / "pkg" / "util.py").write_text("X = 1\n", encoding="utf-8")
    (root / "node_modules" / "lib.js").write_text("x", encoding="utf-8")
    (root / ".env").write_text("API_KEY=rahasia\n", encoding="utf-8")
    (root / "data.bin").write_bytes(b"\x00\x01")
    return root


# ============================================================================= pure helpers
def test_workspace_root_errors(tmp_path):
    with pytest.raises(ws.WorkspaceError, match="belum diatur"):
        ws.workspace_root(None)
    with pytest.raises(ws.WorkspaceError, match="tidak ditemukan"):
        ws.workspace_root(str(tmp_path / "nope"))


def test_reading_is_limited_to_safe_files_inside_the_workspace(project, tmp_path):
    root = ws.workspace_root(str(project))
    assert ws.read_code_file(root, "main.py")[1] == OLD_CODE
    assert ws.read_code_file(root, "pkg/util.py")[1] == "X = 1\n"
    outside = tmp_path / "rahasia.py"
    outside.write_text("x", encoding="utf-8")
    for bad, why in [
        ("../rahasia.py", "di luar"), (str(outside), "di luar"), (".env", "rahasia"), ("node_modules/lib.js", "dilewati"),
        ("data.bin", "tidak didukung"), ("tidak_ada.py", "tidak ditemukan"), ("", "kosong"),
    ]:
        with pytest.raises(ws.WorkspaceError, match=why):
            ws.read_code_file(root, bad)


def test_big_and_binary_files_are_refused(project):
    root = ws.workspace_root(str(project))
    (project / "besar.py").write_text("x = 1\n" * 60_000, encoding="utf-8")
    with pytest.raises(ws.WorkspaceError, match="terlalu besar"):
        ws.read_code_file(root, "besar.py")
    (project / "latin.py").write_bytes("caf\xe9 = 1".encode("latin-1"))
    with pytest.raises(ws.WorkspaceError, match="UTF-8"):
        ws.read_code_file(root, "latin.py")


def test_file_listing_skips_junk_and_secrets(project):
    assert ws.list_workspace_files(ws.workspace_root(str(project))) == ["main.py", "pkg/util.py"]


def test_code_block_extraction_and_diff():
    assert ws.extract_code_block("Ini perbaikannya:\n```python\nx = 1\n```\nSelesai") == "x = 1\n"
    assert ws.extract_code_block("tidak ada kode di sini") is None
    assert ws.extract_code_block("```\n\n```") is None
    d = ws.make_diff(OLD_CODE, NEW_CODE, "main.py")
    assert "-    return a - b  # bug" in d and "+    return a + b" in d


def test_backup_keeps_the_first_original_even_after_two_patches(project):
    target = project / "main.py"
    ws.apply_patch_with_backup(target, NEW_CODE)
    ws.apply_patch_with_backup(target, NEW_CODE + "# v3\n")
    assert (project / "main.py.bak").read_text(encoding="utf-8") == OLD_CODE


# ============================================================================= through chat + approval
def chat(msg: str, workspace: Path | None, thread: str):
    body = {"message": msg, "thread_id": thread}
    if workspace:
        body["workspace_path"] = str(workspace)
    r = client.post("/api/v1/chat", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def pending(thread: str):
    return client.get(f"/api/v1/approvals/pending?thread_id={thread}").json()["pending_approvals"]


def decide(thread: str, action_id: str, decision: str):
    return client.post(f"/api/v1/threads/{thread}/resume", json={"action_id": action_id, "decision": decision}).json()


def fake_llm(monkeypatch, reply: str):
    monkeypatch.setattr(router, "invoke_text", lambda purpose, messages, **kw: reply)


def test_no_workspace_asks_for_one(monkeypatch):
    fake_llm(monkeypatch, "x")
    out = chat("@Code jelaskan main.py", None, "c1")
    assert "Folder kerja belum diatur" in out["text"]


def test_explain_a_file_uses_the_code_model(project, monkeypatch):
    seen = {}
    monkeypatch.setattr(router, "invoke_text", lambda purpose, messages, **kw: seen.update(purpose=purpose, prompt=messages[-1].content) or "Fungsi add mengurangi, itu bug.")
    out = chat("@Code jelaskan main.py", project, "c2")
    assert "mengurangi" in out["text"] and seen["purpose"] == "code" and "a - b" in seen["prompt"]


def test_explain_survives_an_ai_failure_and_still_shows_the_file(project, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("kuota habis")

    monkeypatch.setattr(router, "invoke_text", boom)
    out = chat("@Code jelaskan main.py", project, "c3")
    assert "AI belum bisa dipakai" in out["text"] and "a - b" in out["text"]


def test_fix_needs_approval_then_writes_with_a_backup(project, monkeypatch):
    fake_llm(monkeypatch, f"Perbaikan:\n```python\n{NEW_CODE}```\nOperatornya salah.")
    chat("@Code perbaiki main.py operator pengurangan jadi penjumlahan", project, "c4")
    p = pending("c4")
    assert len(p) == 1 and p[0]["action_name"] == "apply_code_patch"
    assert "+    return a + b" in p[0]["evidence"]["preview"]  # the human sees the exact diff
    assert (project / "main.py").read_text(encoding="utf-8") == OLD_CODE  # nothing written before the answer
    decide("c4", p[0]["action_id"], "approve")
    assert (project / "main.py").read_text(encoding="utf-8") == NEW_CODE
    assert (project / "main.py.bak").read_text(encoding="utf-8") == OLD_CODE


def test_reject_leaves_the_file_alone(project, monkeypatch):
    fake_llm(monkeypatch, f"```python\n{NEW_CODE}```")
    chat("@Code ubah main.py jadi penjumlahan", project, "c5")
    decide("c5", pending("c5")[0]["action_id"], "reject")
    assert (project / "main.py").read_text(encoding="utf-8") == OLD_CODE and not (project / "main.py.bak").exists()


def test_file_changed_while_waiting_makes_the_approval_stale(project, monkeypatch):
    fake_llm(monkeypatch, f"```python\n{NEW_CODE}```")
    chat("@Code perbaiki main.py", project, "c6")
    aid = pending("c6")[0]["action_id"]
    (project / "main.py").write_text("# aku edit sendiri sementara menunggu\n", encoding="utf-8")
    decide("c6", aid, "approve")
    assert (project / "main.py").read_text(encoding="utf-8").startswith("# aku edit sendiri")  # the AI did not clobber my edit


def test_model_that_returns_no_code_or_the_same_code_changes_nothing(project, monkeypatch):
    fake_llm(monkeypatch, "Maaf, aku tidak yakin harus mengubah apa.")
    assert "tidak memberi kode baru" in chat("@Code perbaiki main.py", project, "c7")["text"]
    fake_llm(monkeypatch, f"```python\n{OLD_CODE}```")
    assert "Tidak ada perubahan" in chat("@Code perbaiki main.py", project, "c8")["text"]
    assert pending("c7") == [] and pending("c8") == []


def test_dangerous_targets_are_refused_before_any_ai_call(project, monkeypatch):
    called = []
    monkeypatch.setattr(router, "invoke_text", lambda *a, **k: called.append(1) or "x")
    assert "rahasia" in chat("@Code jelaskan .env", project, "c9")["text"]
    assert "di luar folder kerja" in chat("@Code perbaiki ../x.py", project, "c10")["text"]
    assert called == []  # a secret file's content never reached the model


def test_run_tests_needs_approval_and_runs_in_the_workspace_not_in_karsa(project):
    (project / "test_ok.py").write_text("def test_ok():\n    assert 1 + 1 == 2\n", encoding="utf-8")
    chat("@Code jalankan test", project, "c11")
    p = pending("c11")
    assert p and p[0]["action_name"] == "run_shell_command" and p[0]["risk_level"] == "critical"
    out = decide("c11", p[0]["action_id"], "approve")
    assert "1 passed" in out["response"] and "proj" in out["response"]


def test_failing_tests_are_reported_as_failed(project):
    (project / "test_bad.py").write_text("def test_bad():\n    assert False\n", encoding="utf-8")
    chat("@Code jalankan test", project, "c12")
    out = decide("c12", pending("c12")[0]["action_id"], "approve")
    assert "failed" in out["response"].lower()


def test_rejecting_the_test_run_runs_nothing(project):
    (project / "test_ok.py").write_text("raise SystemExit('jangan jalan')\n", encoding="utf-8")
    chat("@Code jalankan test", project, "c13")
    out = decide("c13", pending("c13")[0]["action_id"], "reject")
    assert "dibatalkan" in out["response"]


# ============================================================================= chat panel modes
def test_code_mode_sends_plain_text_to_the_coding_module(project, monkeypatch):
    fake_llm(monkeypatch, "Fungsi add mengurangi.")
    r = client.post("/api/v1/chat", json={"message": "jelaskan main.py", "thread_id": "m1", "workspace_path": str(project), "mode": "code"})
    assert r.json()["active_module"] == "datascience_code" and "mengurangi" in r.json()["text"]


def test_research_mode_routes_to_research_and_unknown_modes_are_refused():
    r = client.post("/api/v1/chat", json={"message": "halo", "thread_id": "m2", "mode": "research"})
    assert r.status_code == 200  # greetings are still answered instantly
    assert client.post("/api/v1/chat", json={"message": "x", "mode": "hack"}).status_code == 422
