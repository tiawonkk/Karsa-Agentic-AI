from fastapi.testclient import TestClient

from backend.api import main as api_main
from backend.core.context import compact_history, estimate_tokens


def turns(n: int, size: int = 200):
    return [{"role": "user" if i % 2 == 0 else "assistant", "content": f"pesan {i} " + "x" * size} for i in range(n)]


def test_short_history_is_untouched():
    out = compact_history(turns(3, 20))
    assert out.count("\n") == 2 and "Ringkasan" not in out


def test_long_history_is_compacted_under_budget_and_keeps_the_latest_turns():
    msgs = turns(80, 400)  # ~8000 tokens
    out = compact_history(msgs, max_tokens=3000, keep_recent=6)
    assert estimate_tokens(out) <= 3000
    assert "Ringkasan percakapan sebelumnya" in out
    assert "pesan 79 " in out and "pesan 74 " in out  # recent turns verbatim


def test_oversized_recent_turns_are_trimmed_not_dropped():
    out = compact_history(turns(6, 9000), max_tokens=3000, keep_recent=6)
    assert estimate_tokens(out) <= 3200 and out.count("\n") == 5


def test_built_ui_is_served_but_api_keeps_priority(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<html>karsa-ui</html>")
    # fresh app copy of the mount so the test does not leak into other tests
    from fastapi import FastAPI

    probe = FastAPI()
    monkeypatch.setattr(api_main, "app", probe)

    @probe.get("/api/ping")
    def ping():
        return {"ok": True}

    assert api_main.mount_ui(tmp_path) is True
    c = TestClient(probe)
    assert c.get("/api/ping").json() == {"ok": True}
    assert "karsa-ui" in c.get("/").text
    assert api_main.mount_ui(tmp_path / "missing") is False
