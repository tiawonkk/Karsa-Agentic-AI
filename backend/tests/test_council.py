from pathlib import Path
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage

from backend.api import main as api_main
from backend.core.config import settings
from backend.core.council import needs_deep_reasoning, run_council
from backend.core.database import initialize_master_database


class FakeChat:
    def __init__(self, reply: str | Exception):
        self.reply = reply
        self.calls: list[list] = []

    def invoke(self, messages):
        self.calls.append(messages)
        if isinstance(self.reply, Exception):
            raise self.reply
        return AIMessage(content=self.reply)


def make_factory(replies: dict[str, str | Exception]):
    """Factory keyed by model name; records every created fake for inspection."""
    created: dict[str, FakeChat] = {}

    def factory(provider: str, model: str, temperature: float):
        chat = FakeChat(replies[model])
        created[model] = chat
        return chat

    factory.created = created  # type: ignore[attr-defined]
    return factory


def test_needs_deep_reasoning_heuristic():
    assert needs_deep_reasoning("jelaskan kenapa gradient descent konvergen")
    assert needs_deep_reasoning("x" * 700)
    assert not needs_deep_reasoning("apa itu ram")


def test_relay_chain_passes_draft_and_critique_to_gemini():
    factory = make_factory({
        settings.council_worker_model: "DRAF: 2+2=5",
        settings.council_reasoner_model: "<think>hitung ulang</think>Koreksi: 2+2=4",
        settings.council_synth_model: "Jawaban final: 4",
    })
    result = run_council("jelaskan 2+2", mode="relay", model_factory=factory)

    assert result["ok"] and result["mode"] == "relay"
    assert result["answer"] == "Jawaban final: 4"
    assert [s["role"] for s in result["steps"]] == ["worker", "reasoner", "synth"]

    synth_input = factory.created[settings.council_synth_model].calls[0][1].content
    assert "DRAF: 2+2=5" in synth_input
    assert "Koreksi: 2+2=4" in synth_input
    assert "hitung ulang" not in synth_input  # <think> trace stripped


def test_auto_mode_keeps_simple_questions_on_gemini_only():
    factory = make_factory({settings.council_synth_model: "Jawaban singkat"})
    result = run_council("apa itu ram", mode="auto", model_factory=factory)

    assert result["mode"] == "solo"
    assert len(result["steps"]) == 1
    assert settings.council_worker_model not in factory.created


def test_chain_degrades_when_local_models_are_offline():
    factory = make_factory({
        settings.council_worker_model: ConnectionError("ollama off"),
        settings.council_reasoner_model: ConnectionError("ollama off"),
        settings.council_synth_model: "Gemini tetap menjawab",
    })
    result = run_council("jelaskan kenapa langit biru", mode="relay", model_factory=factory)

    assert result["ok"]
    assert result["answer"] == "Gemini tetap menjawab"
    assert [s["status"] for s in result["steps"]] == ["error", "error", "ok"]


def test_all_models_failing_reports_not_ok():
    factory = make_factory({
        settings.council_synth_model: RuntimeError("no key"),
    })
    result = run_council("apa itu ram", mode="solo", model_factory=factory)
    assert not result["ok"]
    assert result["answer"] == ""


def test_api_dashboard_summary_and_provider_status(tmp_path: Path, monkeypatch):
    initialize_master_database(tmp_path / "karsa_master.db")
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    (tmp_path / "storage").mkdir(exist_ok=True)
    initialize_master_database()

    client = TestClient(api_main.app)

    summary = client.get("/api/v1/dashboard/summary").json()
    assert "daily_safe_spend_idr" in summary["finance"]
    assert summary["tasks"]["todo_count"] == 0

    providers = client.get("/api/v1/settings/providers").json()
    assert set(providers["keys"]) >= {"gemini_api_key", "deepseek_api_key"}
    assert providers["council"]["synth"]["name"] == "Gemini"


def test_api_keys_are_saved_to_env_and_never_returned(tmp_path: Path, monkeypatch):
    env_file = tmp_path / ".env"
    monkeypatch.setattr(api_main, "ENV_FILE_PATH", env_file)
    monkeypatch.setattr(settings, "gemini_api_key", None)

    client = TestClient(api_main.app)
    resp = client.put("/api/v1/settings/api-keys", json={"gemini_api_key": "  AIza-test-123  "})

    assert resp.status_code == 200
    assert "AIza-test-123" not in resp.text
    assert "KARSA_GEMINI_API_KEY=AIza-test-123" in env_file.read_text()
    assert settings.gemini_api_key == "AIza-test-123"

    status = client.get("/api/v1/settings/providers").json()
    assert status["keys"]["gemini_api_key"] is True
    assert "AIza-test-123" not in str(status)

    bad = client.put("/api/v1/settings/api-keys", json={"gemini_api_key": "a\nb"})
    assert bad.status_code == 400
