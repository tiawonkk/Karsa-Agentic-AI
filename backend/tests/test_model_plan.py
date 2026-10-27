"""Per-purpose model plan, free-provider failover, and the speed fixes in the chat path."""
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage

from backend.api.main import app
from backend.core import llm_router as lr
from backend.core.config import settings
from backend.core.database import set_system_setting
from backend.core.llm_router import router
from backend.orchestrator import supervisor as sup

client = TestClient(app)


@pytest.fixture(autouse=True)
def no_keys(monkeypatch):
    for p in ("gemini", "groq", "openrouter", "cerebras", "mistral", "deepseek"):
        monkeypatch.setattr(settings, f"{p}_api_key", None)
    monkeypatch.setattr(lr, "detect_hardware_profile", lambda: SimpleNamespace(mode="eco_cpu"))
    monkeypatch.setattr(lr.LLMRouter, "ollama_up", staticmethod(lambda: False))  # a real local Ollama must not answer tests


def plan():
    return {p["purpose"]: p for p in router.plan_overview()["purposes"]}


def test_without_any_key_nothing_is_ready_but_the_plan_still_shows():
    assert all(not p["ready"] for p in plan().values())
    assert plan()["writer"]["provider"] == "deepseek"  # the preferred one, so the UI can say "pasang kunci DeepSeek"


def test_one_free_key_serves_every_purpose_then_better_providers_take_over_when_added():
    set_system_setting("api_key.gemini", "g")
    assert {p["provider"] for p in plan().values()} == {"gemini"}
    set_system_setting("api_key.deepseek", "d")
    pl = plan()
    assert pl["writer"]["provider"] == pl["code"]["provider"] == "deepseek"  # best fit per purpose
    assert pl["research"]["provider"] == pl["chat"]["provider"] == "gemini"
    assert pl["writer"]["source"] == "default"


def test_without_the_preferred_key_the_first_ready_provider_takes_over_as_auto():
    set_system_setting("api_key.groq", "q")
    pl = plan()
    assert pl["code"]["provider"] == "groq" and pl["code"]["source"] == "auto" and pl["code"]["ready"]


def test_user_choice_wins_and_can_be_reset_to_automatic():
    set_system_setting("api_key.gemini", "g")
    router.set_purpose_config("code", "groq", "llama-3.3-70b-versatile")
    assert plan()["code"]["provider"] == "groq" and plan()["code"]["source"] == "custom"
    router.set_purpose_config("code", None)
    assert plan()["code"]["source"] != "custom"
    with pytest.raises(ValueError):
        router.set_purpose_config("nonsense", "groq")
    with pytest.raises(ValueError):
        router.set_purpose_config("code", "skynet")
    with pytest.raises(ValueError):
        router.set_purpose_config("code", "groq", "bad model name")


class FakeModel:
    def __init__(self, fail=False, text="jawaban", chunks=None, fail_after=None):
        self.fail, self.text, self.chunks, self.fail_after = fail, text, chunks or [], fail_after

    def invoke(self, messages):
        if self.fail:
            raise RuntimeError("kuota habis")
        return AIMessage(content=self.text)

    def stream(self, messages):
        if self.fail:
            raise RuntimeError("kuota habis")
        for i, c in enumerate(self.chunks):
            if self.fail_after is not None and i >= self.fail_after:
                raise RuntimeError("putus")
            yield AIMessageChunk(content=c)


def fake_by_provider(monkeypatch, models):
    monkeypatch.setattr(router, "_model_for", lambda cfg, *a, **k: models[cfg["provider"]])


def test_failover_moves_to_the_next_ready_provider(monkeypatch):
    set_system_setting("api_key.gemini", "g")
    set_system_setting("api_key.groq", "q")
    fake_by_provider(monkeypatch, {"gemini": FakeModel(fail=True), "groq": FakeModel(text="dari groq")})
    assert router.invoke_text("chat", [HumanMessage(content="hai")]) == "dari groq"


def test_all_failing_raises_a_clear_error(monkeypatch):
    set_system_setting("api_key.gemini", "g")
    fake_by_provider(monkeypatch, {"gemini": FakeModel(fail=True)})
    with pytest.raises(RuntimeError, match="kuota habis"):
        router.invoke_text("chat", [HumanMessage(content="hai")])


def test_no_key_at_all_says_so():
    with pytest.raises(RuntimeError, match="belum diisi di Settings"):
        router.invoke_text("chat", [HumanMessage(content="hai")])


def test_stream_fails_over_before_the_first_piece_but_never_restarts_mid_answer(monkeypatch):
    set_system_setting("api_key.gemini", "g")
    set_system_setting("api_key.groq", "q")
    fake_by_provider(monkeypatch, {"gemini": FakeModel(fail=True), "groq": FakeModel(chunks=["Ha", "lo"])})
    assert "".join(router.stream_text("chat", [HumanMessage(content="x")])) == "Halo"
    fake_by_provider(monkeypatch, {"gemini": FakeModel(chunks=["Ha", "lo", "!"], fail_after=2), "groq": FakeModel(chunks=["LAIN"])})
    assert "".join(router.stream_text("chat", [HumanMessage(content="x")])) == "Halo"  # no restart on another model


def test_modules_can_get_a_model_through_the_method_they_were_already_calling():
    assert callable(router.get_model)  # it did not exist before: every module LLM path silently failed


# ----------------------------------------------------------------------------- speed of the chat path
def test_greeting_and_capability_questions_never_call_a_model(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("an LLM was called for a canned reply")

    monkeypatch.setattr(router, "get_chat_model", boom)
    for text in ("halo", "apa yang kamu bisa lakukan", "bisa apa saja"):
        state = {"messages": [HumanMessage(content=text)], "session_thread_id": "t"}
        assert sup.supervisor_triage_node(state) == {"active_module": None}
        out = sup.subagent_dispatch_node({**state, "active_module": None})
        assert "Karsa" in out["messages"][0].content


def test_general_chat_streams_tokens_over_sse(monkeypatch):
    def triage_off(*a, **k):
        raise RuntimeError("triage off")

    monkeypatch.setattr(router, "provider_ready", lambda p: True)
    monkeypatch.setattr(router, "get_chat_model", triage_off)
    monkeypatch.setattr(router, "stream_text", lambda *a, **k: iter(["Entropi ", "adalah ", "ukuran ketidakpastian."]))
    with client.stream("POST", "/api/v1/chat/stream", json={"message": "tolong terangkan konsep entropi", "thread_id": "s1"}) as r:
        body = "".join(r.iter_text())
    tokens = [json.loads(line[5:])["text"] for line in body.splitlines() if line.startswith("data:") and '"text"' in line]
    assert tokens == ["Entropi ", "adalah ", "ukuran ketidakpastian."]  # real pieces, not 32-char slices of a finished text
    assert "event: done" in body


def test_missing_key_message_is_honest():
    out = sup._general_llm_answer("tolong terangkan konsep entropi")
    assert "Belum ada kunci API" in out


# ----------------------------------------------------------------------------- API
def test_plan_api_roundtrip_and_keys_are_never_echoed():
    r = client.post("/api/v1/settings/provider-key", json={"provider": "groq", "api_key": "gsk_SECRET123"})
    assert r.status_code == 200 and "gsk_SECRET123" not in r.text and r.json()["has_key"] is True
    assert "gsk_SECRET123" not in client.get("/api/v1/settings/plan").text
    assert client.put("/api/v1/settings/plan/code", json={"provider": "groq", "model": "llama-3.3-70b-versatile"}).status_code == 200
    assert client.put("/api/v1/settings/plan/code", json={"provider": "skynet"}).status_code == 422
    assert client.put("/api/v1/settings/plan/code", json={}).status_code == 200  # back to automatic
    assert client.post("/api/v1/settings/provider-key", json={"provider": "ollama", "api_key": "x"}).status_code == 422
    assert client.post("/api/v1/settings/provider-key", json={"provider": "groq", "api_key": ""}).json()["has_key"] is False


def test_plan_test_endpoint_reports_latency_or_the_error(monkeypatch):
    set_system_setting("api_key.gemini", "g")
    fake_by_provider(monkeypatch, {"gemini": FakeModel(text="siap")})
    ok = client.post("/api/v1/settings/plan/chat/test").json()
    assert ok["ok"] is True and ok["latency_ms"] >= 0
    fake_by_provider(monkeypatch, {"gemini": FakeModel(fail=True)})
    bad = client.post("/api/v1/settings/plan/chat/test").json()
    assert bad["ok"] is False and "kuota" in bad["error"]
    assert client.post("/api/v1/settings/plan/ngawur/test").status_code == 404
