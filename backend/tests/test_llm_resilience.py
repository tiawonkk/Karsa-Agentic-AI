"""Honest, resilient model calls: specific diagnostics, backoff on transient errors, rate limiter, live health."""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage

from backend.api.main import app
from backend.core import llm_router as lr
from backend.core.config import settings
from backend.core.database import set_system_setting
from backend.core.llm_router import LLMUnavailable, classify_error, router

client = TestClient(app)
MSG = [HumanMessage(content="halo")]


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    for p in ("gemini", "groq", "openrouter", "cerebras", "mistral", "deepseek"):
        monkeypatch.setattr(settings, f"{p}_api_key", None)
    monkeypatch.setattr(lr, "detect_hardware_profile", lambda: SimpleNamespace(mode="eco_cpu"))
    monkeypatch.setattr(lr.LLMRouter, "ollama_up", staticmethod(lambda: False))
    monkeypatch.setattr(router, "backoff_base", 0.0)
    router.limiter = lr._RateLimiter(per_minute=1000, min_gap_s=0.0)
    router.invalidate_health()


class Fake:
    def __init__(self, behaviours):
        self.behaviours = list(behaviours)
        self.calls = 0

    def _next(self):
        self.calls += 1
        b = self.behaviours.pop(0) if len(self.behaviours) > 1 else self.behaviours[0]
        if isinstance(b, Exception):
            raise b
        return b

    def invoke(self, messages):
        return AIMessage(content=self._next())

    def stream(self, messages):
        text = self._next()
        yield AIMessageChunk(content=text)


def use(monkeypatch, fakes):
    monkeypatch.setattr(router, "_model_for", lambda cfg, *a, **k: fakes[cfg["provider"]])


def test_classify_error_kinds():
    assert classify_error(RuntimeError("401 Unauthorized")) == "auth"
    assert classify_error(RuntimeError("API key not valid. Please pass a valid API key")) == "auth"
    assert classify_error(RuntimeError("429 RESOURCE_EXHAUSTED quota")) == "quota"
    assert classify_error(RuntimeError("404 model not found")) == "model"
    assert classify_error(TimeoutError("request timed out")) == "timeout"
    assert classify_error(RuntimeError("Connection refused")) == "network"
    assert classify_error(RuntimeError("boom")) == "other"


def test_no_key_says_which_key_is_missing_not_a_generic_error():
    with pytest.raises(LLMUnavailable) as e:
        router.invoke_text("chat", MSG)
    assert "Gemini belum diisi" in str(e.value)
    assert "tidak merespons" not in str(e.value).lower()


def test_transient_error_is_retried_then_succeeds(monkeypatch):
    set_system_setting("api_key.gemini", "g")
    fake = Fake([RuntimeError("503 service unavailable"), "jawaban"])
    use(monkeypatch, {"gemini": fake})
    assert router.invoke_text("chat", MSG) == "jawaban"
    assert fake.calls == 2


def test_auth_error_is_not_retried_and_fails_over_with_a_precise_report(monkeypatch):
    set_system_setting("api_key.gemini", "bad")
    set_system_setting("api_key.groq", "ok")
    bad, good = Fake([RuntimeError("401 API key not valid")]), Fake(["dari groq"])
    use(monkeypatch, {"gemini": bad, "groq": good})
    assert router.invoke_text("chat", MSG) == "dari groq"
    assert bad.calls == 1  # a rejected key is never hammered


def test_all_failing_lists_every_provider_with_its_reason(monkeypatch):
    set_system_setting("api_key.gemini", "g")
    set_system_setting("api_key.groq", "k")
    use(monkeypatch, {"gemini": Fake([RuntimeError("429 quota exceeded")]), "groq": Fake([RuntimeError("401 unauthorized")])})
    with pytest.raises(LLMUnavailable) as e:
        router.invoke_text("chat", MSG)
    text = str(e.value)
    assert "Google Gemini" in text and "kuota" in text
    assert "Groq" in text and "kunci API ditolak" in text


def test_stream_retries_before_first_piece_and_streams(monkeypatch):
    set_system_setting("api_key.gemini", "g")
    fake = Fake([TimeoutError("timed out"), "halo dunia"])
    use(monkeypatch, {"gemini": fake})
    assert "".join(router.stream_text("chat", MSG)) == "halo dunia"
    assert fake.calls == 2


def test_rate_limiter_spaces_calls_and_reports_saturation():
    lim = lr._RateLimiter(per_minute=2, min_gap_s=0.0)
    assert lim.acquire("x") and lim.acquire("x")
    assert lim.acquire("x", max_wait_s=0.05) is False  # third call inside the minute: saturated, does not block for a minute
    assert lim.acquire("other")  # other providers are independent


def test_live_health_pings_and_reports_per_provider(monkeypatch):
    set_system_setting("api_key.gemini", "g")
    set_system_setting("api_key.groq", "k")

    def create(provider, model, temp=0.2, **kw):
        return Fake(["pong"]) if provider == "gemini" else Fake([RuntimeError("401 unauthorized")])

    monkeypatch.setattr(router, "create_chat_model", create)
    r = client.get("/api/health/models?force=true")
    assert r.status_code == 200
    d = r.json()
    by = {p["id"]: p for p in d["providers"]}
    assert d["ok"] and d["active"] == "gemini" and "Gemini" in d["badge"]
    assert by["gemini"]["ok"] and by["groq"]["ok"] is False and "ditolak" in by["groq"]["message"]
    assert by["mistral"]["has_key"] is False


def test_health_without_keys_says_a_key_is_needed():
    d = client.get("/api/health/models?force=true").json()
    assert d["ok"] is False and "API Key" in d["badge"]


def test_saving_a_provider_key_takes_effect_immediately(monkeypatch):
    d0 = client.get("/api/health/models?force=true").json()
    assert not d0["ok"]
    monkeypatch.setattr(router, "create_chat_model", lambda *a, **k: Fake(["pong"]))
    assert client.post("/api/v1/settings/provider-key", json={"provider": "groq", "api_key": "k"}).status_code == 200
    d1 = client.get("/api/health/models").json()  # no force: saving invalidated the cache
    assert d1["ok"] and d1["active"] == "groq"
