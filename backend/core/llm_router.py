from __future__ import annotations

import json
import queue
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, TypeVar
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage
from pydantic import BaseModel

from backend.core.config import settings
from backend.core.database import get_db_cursor
from backend.core.hardware_detector import detect_hardware_profile
from backend.core.state import ModelProfile
from backend.core.token_tracker import TokenTrackerCallbackHandler

T = TypeVar("T", bound=BaseModel)

# Gemini model names that new API keys can no longer call (HTTP 404 "no longer available to new users").
# A tier saved with one of these in system_settings is upgraded at read time (the saved row is not rewritten).
GEMINI_DEFAULT_MODEL = "gemini-3.8-flash"
RETIRED_GEMINI_MODELS = frozenset(
    {"gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash", "gemini-2.0-pro", "gemini-2.5-flash", "gemini-2.5-pro"}
)


def modernize_tier_config(config: dict[str, Any]) -> dict[str, Any]:
    """Swap a retired Gemini model for the current default; every other provider/model is left untouched."""
    out = dict(config)
    if out.get("provider") == "gemini" and out.get("model") in RETIRED_GEMINI_MODELS:
        out["model"] = GEMINI_DEFAULT_MODEL
    return out


# Default Model Tier Profiles (Lightweight, Token-Efficient: Gemini Flash & DeepSeek Flash)
DEFAULT_TIER_PROFILES: dict[str, dict[str, Any]] = {
    "tier1_utility": {
        "provider": "gemini",
        "model": GEMINI_DEFAULT_MODEL,
        "temperature": 0.1,
    },
    "tier2_code": {
        "provider": "deepseek",
        "model": "deepseek-ai/deepseek-v4.1-flash-1017",
        "temperature": 0.2,
    },
    "tier3_reasoning": {
        "provider": "deepseek",
        "model": "deepseek-ai/deepseek-v4.1-flash-1017",
        "temperature": 0.2,
    },
}


# Providers the user can pick per purpose. Everything except gemini/ollama/anthropic speaks the OpenAI wire format.
# Free-tier limits and model names change often: `models` are suggestions the user can overwrite with any name.
PROVIDER_CATALOG: dict[str, dict[str, Any]] = {
    "gemini": {
        "label": "Google Gemini",
        "free": "Gratis untuk model Flash (ada batas harian)",
        "key_url": "https://aistudio.google.com/apikey",
        "models": [GEMINI_DEFAULT_MODEL],
    },
    "groq": {
        "label": "Groq",
        "base_url": "https://api.groq.com/openai/v1",
        "free": "Gratis dengan batas harian, sangat cepat",
        "key_url": "https://console.groq.com/keys",
        "models": ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
    },
    "openrouter": {
        "label": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "free": "Satu kunci, ada model berakhiran :free",
        "key_url": "https://openrouter.ai/keys",
        "models": ["deepseek/deepseek-r1:free"],
    },
    "cerebras": {
        "label": "Cerebras",
        "base_url": "https://api.cerebras.ai/v1",
        "free": "Gratis dengan batas token harian, sangat cepat",
        "key_url": "https://cloud.cerebras.ai",
        "models": ["llama-3.3-70b"],
    },
    "mistral": {
        "label": "Mistral",
        "base_url": "https://api.mistral.ai/v1",
        "free": "Paket gratis untuk eksperimen",
        "key_url": "https://console.mistral.ai/api-keys",
        "models": ["mistral-small-latest"],
    },
    "deepseek": {
        "label": "DeepSeek",
        "free": "Kredit awal kecil, lalu sangat murah (bukan gratis)",
        "key_url": "https://platform.deepseek.com/api_keys",
        "models": ["deepseek-chat", "deepseek-reasoner"],
    },
    "ollama": {
        "label": "Ollama (lokal)",
        "free": "Gratis selamanya, butuh PC dengan GPU",
        "key_url": "https://ollama.com",
        "models": ["hermes3:8b", "deepseek-r1:8b"],
    },
}
# When a preferred provider has no key, the first ready provider in this order takes over (auto failover).
PROVIDER_ORDER = ("gemini", "groq", "cerebras", "openrouter", "mistral", "deepseek")

# What each part of Karsa is for. `prefer` is used while the user has not picked anything.
PURPOSES: dict[str, dict[str, str]] = {
    "chat": {"label": "Obrolan umum", "prefer": "gemini"},
    "finance": {"label": "Keuangan & struk", "prefer": "gemini"},
    "study": {"label": "Belajar & tugas", "prefer": "gemini"},
    "research": {"label": "Riset & jurnal", "prefer": "gemini"},
    "writer": {"label": "Penulisan ilmiah", "prefer": "deepseek"},
    "code": {"label": "Kode & data", "prefer": "deepseek"},
}
LLM_TIMEOUT_S = 20.0
LLM_RETRIES = 0  # the client libraries do not retry: `_call_with_backoff` does, so the wait is bounded and visible
LLM_BACKOFF_RETRIES = 2  # extra tries on the same provider for transient errors (429, 5xx, timeouts, network)
LLM_BACKOFF_BASE_S = 0.8
# A local model that is still loading must not leave the chat on "...": with a cloud fallback available the first
# piece has to arrive within FIRST_PIECE_LOCAL_S, otherwise the next provider answers. Alone, it gets longer.
FIRST_PIECE_LOCAL_S = 12.0
FIRST_PIECE_LOCAL_ALONE_S = 60.0


class FirstPieceTimeout(TimeoutError):
    pass


def _guard_first_piece(chunks, deadline: float):
    """Iterate `chunks` (a blocking generator) but raise FirstPieceTimeout if nothing arrives within `deadline`."""
    q: queue.Queue = queue.Queue()

    def pump():
        try:
            for x in chunks:
                q.put(("piece", x))
            q.put(("end", None))
        except Exception as e:  # handed to the consumer
            q.put(("error", e))

    threading.Thread(target=pump, daemon=True).start()
    first = True
    while True:
        try:
            kind, val = q.get(timeout=deadline if first else LLM_TIMEOUT_S * 3)
        except queue.Empty:
            raise FirstPieceTimeout(f"belum menjawab dalam {int(deadline)} detik (model mungkin masih dimuat)")
        first = False
        if kind == "piece":
            yield val
        elif kind == "end":
            return
        else:
            raise val


class LLMUnavailable(RuntimeError):
    """No provider could answer. The message says, per provider, exactly why (never a generic 'model did not respond')."""


def classify_error(exc: BaseException) -> str:
    """auth | quota | model | timeout | network | other, from whatever the provider library raised."""
    t = f"{type(exc).__name__} {exc}".lower()
    if any(k in t for k in ("401", "403", "unauthorized", "permission", "api key not valid", "invalid api key", "invalid_api_key", "api_key_invalid", "authentication")):
        return "auth"
    if any(k in t for k in ("429", "quota", "rate limit", "rate_limit", "resource_exhausted", "too many requests", "exceeded")):
        return "quota"
    if any(k in t for k in ("404", "not found", "no longer available", "model_not_found", "does not exist", "decommissioned")):
        return "model"
    if any(k in t for k in ("timeout", "timed out", "deadline")):
        return "timeout"
    if any(k in t for k in ("connection", "resolve", "unreachable", "network", "ssl", "refused", "getaddrinfo")):
        return "network"
    return "other"


_KIND_TEXT = {
    "auth": "kunci API ditolak atau tidak berlaku: periksa kunci di Settings",
    "quota": "kuota atau batas permintaan habis: coba lagi nanti atau pakai penyedia lain",
    "model": "nama model tidak tersedia untuk kunci ini: pilih model lain di Settings > Model AI",
    "timeout": f"tidak menjawab dalam {int(LLM_TIMEOUT_S)} detik",
    "network": "tidak bisa terhubung: periksa koneksi internet",
    "other": "gagal",
}


def describe_failure(provider: str, exc: BaseException) -> str:
    label = PROVIDER_CATALOG.get(provider, {}).get("label", provider)
    kind = classify_error(exc)
    detail = "" if kind != "other" else f" ({str(exc).strip()[:120]})"
    return f"{label}: {_KIND_TEXT[kind]}{detail}"


class _RateLimiter:
    """Client-side limiter per provider so free-tier keys are not blocked with 429: a minimum gap and a per-minute cap."""

    def __init__(self, per_minute: int = 20, min_gap_s: float = 0.25) -> None:
        self.per_minute = per_minute
        self.min_gap_s = min_gap_s
        self._stamps: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def acquire(self, provider: str, max_wait_s: float = 6.0) -> bool:
        """Wait for a slot (at most `max_wait_s`). False means the provider is saturated right now."""
        deadline = time.monotonic() + max_wait_s
        while True:
            with self._lock:
                now = time.monotonic()
                stamps = [t for t in self._stamps.get(provider, []) if now - t < 60.0]
                wait = 0.0
                if stamps and now - stamps[-1] < self.min_gap_s:
                    wait = self.min_gap_s - (now - stamps[-1])
                if len(stamps) >= self.per_minute:
                    wait = max(wait, 60.0 - (now - stamps[0]))
                if wait <= 0:
                    stamps.append(now)
                    self._stamps[provider] = stamps
                    return True
                self._stamps[provider] = stamps
            if time.monotonic() + wait > deadline:
                return False
            time.sleep(wait)


class LLMRouter:
    """Universal Model Router supporting hot-swappable providers and hardware adaptation."""

    def __init__(self) -> None:
        self.limiter = _RateLimiter()
        self.backoff_base = LLM_BACKOFF_BASE_S
        self._cached_models: dict[str, BaseChatModel] = {}
        self._runtime_overrides: dict[str, dict[str, Any]] = {}

    def get_tier_config(self, tier: str) -> dict[str, Any]:
        """Fetch tier configuration from runtime overrides, DB system_settings, or defaults."""
        if tier in self._runtime_overrides:
            return modernize_tier_config(self._runtime_overrides[tier])

        # Check SQLite system_settings
        try:
            with get_db_cursor() as cursor:
                cursor.execute(
                    "SELECT value FROM system_settings WHERE key = ?;",
                    (f"models.{tier}",),
                )
                row = cursor.fetchone()
                if row and row["value"]:
                    return modernize_tier_config(json.loads(row["value"]))
        except Exception:
            pass

        # Check hardware adaptation for tier1
        hw = detect_hardware_profile()
        if tier == "tier1_utility" and hw.mode == "turbo_gpu":
            return {
                "provider": "ollama",
                "model": settings.tier1_local_model,
                "temperature": 0.1,
            }

        return dict(DEFAULT_TIER_PROFILES.get(tier, DEFAULT_TIER_PROFILES["tier1_utility"]))

    def set_tier_config(self, tier: str, provider: str, model: str, temperature: float = 0.2) -> None:
        """Hot-swap the model assigned to a tier and persist to system_settings."""
        config_data = {
            "provider": provider,
            "model": model,
            "temperature": temperature,
        }
        self._runtime_overrides[tier] = config_data

        # Invalidate cache for this tier
        keys_to_remove = [k for k in self._cached_models if k.startswith(f"{tier}:")]
        for k in keys_to_remove:
            self._cached_models.pop(k, None)

        # Persist to database
        try:
            with get_db_cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO system_settings (key, value, updated_at)
                    VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = excluded.updated_at;
                    """,
                    (f"models.{tier}", json.dumps(config_data)),
                )
        except Exception:
            pass

    def create_chat_model(
        self,
        provider: str,
        model_name: str,
        temperature: float = 0.2,
        base_url: str | None = None,
        api_key: str | None = None,
        timeout: float | None = None,
    ) -> BaseChatModel:
        """Instantiate a LangChain chat model based on provider identifier."""
        prov = provider.lower()
        t_out = timeout or LLM_TIMEOUT_S

        if prov == "ollama":
            try:
                from langchain_ollama import ChatOllama
                return ChatOllama(
                    model=model_name,
                    base_url=base_url or settings.ollama_base_url,
                    temperature=temperature,
                )
            except ImportError:
                raise RuntimeError("langchain-ollama is not installed. Install with `uv pip install langchain-ollama`.")

        elif prov == "gemini":
            try:
                from langchain_google_genai import ChatGoogleGenerativeAI
                key = api_key or settings.gemini_api_key
                if not key:
                    from backend.core.database import get_system_setting
                    key = get_system_setting("api_key.gemini", "")
                return ChatGoogleGenerativeAI(
                    model=model_name,
                    google_api_key=key,
                    temperature=temperature,
                    request_timeout=t_out,
                    max_retries=LLM_RETRIES,
                )
            except ImportError:
                raise RuntimeError("langchain-google-genai is not installed.")

        elif prov in ("groq", "openrouter", "cerebras", "mistral"):
            try:
                from langchain_openai import ChatOpenAI
                return ChatOpenAI(
                    model=model_name,
                    api_key=api_key or self.provider_key(prov) or "missing-key",
                    base_url=base_url or PROVIDER_CATALOG[prov]["base_url"],
                    temperature=temperature,
                    timeout=t_out,
                    max_retries=LLM_RETRIES,
                )
            except ImportError:
                raise RuntimeError("langchain-openai is not installed.")

        elif prov == "anthropic":
            try:
                from langchain_anthropic import ChatAnthropic
                key = api_key or settings.anthropic_api_key
                return ChatAnthropic(
                    model=model_name,
                    anthropic_api_key=key,
                    temperature=temperature,
                    timeout=15.0,
                )
            except ImportError:
                raise RuntimeError("langchain-anthropic is not installed.")

        elif prov == "deepseek":
            try:
                from langchain_openai import ChatOpenAI
                key = api_key or settings.deepseek_api_key
                if not key:
                    from backend.core.database import get_system_setting
                    key = get_system_setting("api_key.deepseek", "")
                return ChatOpenAI(
                    model=model_name,
                    api_key=key or "missing-key",
                    base_url=base_url or settings.deepseek_base_url,
                    temperature=temperature,
                    timeout=t_out,
                    max_retries=LLM_RETRIES,
                )
            except ImportError:
                raise RuntimeError("langchain-openai is not installed.")

        elif prov in ("openai", "openai_compatible", "kiro"):
            try:
                from langchain_openai import ChatOpenAI
                key = api_key or settings.openai_api_key or "not-needed"
                b_url = base_url or settings.openai_compatible_base_url
                return ChatOpenAI(
                    model=model_name,
                    api_key=key,
                    base_url=b_url,
                    temperature=temperature,
                    timeout=15.0,
                )
            except ImportError:
                raise RuntimeError("langchain-openai is not installed.")

        else:
            raise ValueError(f"Unsupported LLM provider: '{provider}'")

    def get_chat_model(
        self,
        tier: str = "tier1_utility",
        provider: str | None = None,
        model: str | None = None,
        temperature: float | None = None,
        module_name: str = "core",
        session_thread_id: str | None = None,
        purpose: str | None = None,
        timeout: float | None = None,
    ) -> BaseChatModel:
        """Get or create chat model instance configured with token tracking callbacks.

        `purpose` (chat/finance/study/research/writer/code) takes precedence over `tier`: the model then comes from the
        user's per-purpose plan, or from the best provider that has a key.
        """
        config = self.get_purpose_config(purpose) if purpose else self.get_tier_config(tier)
        prov = provider or config.get("provider", "gemini")
        mdl = model or config.get("model", "gemini-3.8-flash")
        temp = temperature if temperature is not None else float(config.get("temperature", 0.2))

        hw = detect_hardware_profile()
        cache_key = f"{tier}:{prov}:{mdl}:{temp}:{module_name}"

        # Initialize base model
        base_model = self.create_chat_model(prov, mdl, temp, timeout=timeout)

        # Attach token tracking telemetry callback
        tracker = TokenTrackerCallbackHandler(
            module_name=module_name,
            provider=prov,
            model_name=mdl,
            hardware_mode=hw.mode,
            session_thread_id=session_thread_id,
        )

        return base_model.with_config(callbacks=[tracker])

    # ------------------------------------------------------------------ per-purpose plan + failover
    def get_model(self, *args: Any, **kwargs: Any) -> BaseChatModel:
        """Alias used by the specialist modules (they were calling a method that did not exist)."""
        return self.get_chat_model(*args, **kwargs)

    @staticmethod
    def provider_key(provider: str) -> str:
        from backend.core.database import get_system_setting

        key = getattr(settings, f"{provider}_api_key", None) or get_system_setting(f"api_key.{provider}", "") or ""
        return str(key).strip()

    def provider_ready(self, provider: str) -> bool:
        if provider == "ollama":
            return detect_hardware_profile().mode == "turbo_gpu"
        return bool(self.provider_key(provider))

    @staticmethod
    def _default_model(provider: str) -> str:
        return PROVIDER_CATALOG[provider]["models"][0]

    def get_purpose_config(self, purpose: str) -> dict[str, Any]:
        """The user's pick for this purpose, else the preferred provider, else the first provider that has a key."""
        spec = PURPOSES.get(purpose, PURPOSES["chat"])
        try:
            with get_db_cursor() as cursor:
                cursor.execute("SELECT value FROM system_settings WHERE key = ?;", (f"models.purpose.{purpose}",))
                row = cursor.fetchone()
                if row and row["value"]:
                    cfg = modernize_tier_config(json.loads(row["value"]))
                    if cfg.get("provider") in PROVIDER_CATALOG and cfg.get("model"):
                        return {"temperature": 0.2, **cfg, "source": "custom"}
        except Exception:
            pass
        prefer = spec["prefer"]
        order = [prefer] + [p for p in PROVIDER_ORDER if p != prefer]
        chosen = next((p for p in order if self.provider_ready(p)), prefer)
        return {
            "provider": chosen,
            "model": self._default_model(chosen),
            "temperature": 0.2,
            "source": "default" if chosen == prefer else "auto",
        }

    def set_purpose_config(self, purpose: str, provider: str | None, model: str | None = None) -> None:
        """Pick a provider/model for one purpose; `provider=None` goes back to automatic."""
        if purpose not in PURPOSES:
            raise ValueError(f"Kegunaan tidak dikenal: {purpose}")
        key = f"models.purpose.{purpose}"
        with get_db_cursor() as cursor:
            if provider is None:
                cursor.execute("DELETE FROM system_settings WHERE key = ?;", (key,))
                return
            if provider not in PROVIDER_CATALOG:
                raise ValueError(f"Penyedia tidak dikenal: {provider}")
            name = (model or "").strip() or self._default_model(provider)
            if len(name) > 120 or any(c.isspace() for c in name):
                raise ValueError("Nama model tidak valid.")
            cursor.execute(
                """
                INSERT INTO system_settings (key, value, updated_at)
                VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
                """,
                (key, json.dumps({"provider": provider, "model": name, "temperature": 0.2})),
            )

    def plan_overview(self) -> dict[str, Any]:
        return {
            "purposes": [
                {"purpose": p, "label": spec["label"], **self.get_purpose_config(p), "ready": self.provider_ready(self.get_purpose_config(p)["provider"])}
                for p, spec in PURPOSES.items()
            ],
            "providers": [
                {"id": pid, "label": c["label"], "free": c["free"], "key_url": c["key_url"], "models": c["models"], "has_key": self.provider_ready(pid)}
                for pid, c in PROVIDER_CATALOG.items()
            ],
        }

    @staticmethod
    def ollama_up() -> bool:
        """Is a local Ollama answering? Cached for a few seconds so every chat does not ping it."""
        now = time.monotonic()
        cached = getattr(LLMRouter, "_ollama_seen", None)
        if cached and now - cached[0] < 15.0:
            return cached[1]
        ok = False
        try:
            import urllib.request

            with urllib.request.urlopen(f"{settings.ollama_base_url}/api/tags", timeout=0.8) as resp:
                ok = resp.status == 200
        except Exception:
            ok = False
        LLMRouter._ollama_seen = (now, ok)
        return ok

    def candidates(self, purpose: str) -> list[dict[str, Any]]:
        """The purpose's model first, then every other ready provider (so a slow or exhausted one never blocks chat)."""
        first = self.get_purpose_config(purpose)
        out = [first] if self.provider_ready(first["provider"]) else []  # a provider without a key is skipped, not tried
        for pid in PROVIDER_ORDER:
            if pid != first["provider"] and self.provider_ready(pid):
                out.append({"provider": pid, "model": self._default_model(pid), "temperature": first.get("temperature", 0.2)})
        if not any(c["provider"] == "ollama" for c in out) and self.ollama_up():  # last resort: the local model
            out.append({"provider": "ollama", "model": self._default_model("ollama"), "temperature": first.get("temperature", 0.2)})
        return out

    def _no_provider_message(self, purpose: str) -> str:
        want = self.get_purpose_config(purpose)["provider"]
        label = PROVIDER_CATALOG.get(want, {}).get("label", want)
        return f"API Key {label} belum diisi di Settings, dan tidak ada penyedia lain yang punya kunci. Tempel satu kunci gratis di Settings > Model AI."

    def _call_with_backoff(self, provider: str, fn):
        """Run `fn` with the rate limiter and up to LLM_BACKOFF_RETRIES retries (exponential) for transient errors only."""
        attempt = 0
        while True:
            if not self.limiter.acquire(provider):
                raise RuntimeError("429 batas permintaan lokal tercapai")
            try:
                return fn()
            except Exception as e:
                if classify_error(e) in ("auth", "model") or attempt >= LLM_BACKOFF_RETRIES:
                    raise
                time.sleep(self.backoff_base * (2**attempt))
                attempt += 1

    def _model_for(self, cfg: dict[str, Any], purpose: str, module_name: str, session_thread_id: str | None, timeout: float | None):
        return self.get_chat_model(
            provider=cfg["provider"],
            model=cfg["model"],
            temperature=cfg.get("temperature", 0.2),
            module_name=module_name,
            session_thread_id=session_thread_id,
            timeout=timeout,
        )

    def invoke_text(
        self,
        purpose: str,
        messages: list[Any],
        module_name: str = "chat",
        session_thread_id: str | None = None,
        timeout: float | None = None,
    ) -> str:
        """One answer with automatic failover across the providers that have a key."""
        cands = self.candidates(purpose)
        if not cands:
            raise LLMUnavailable(self._no_provider_message(purpose))
        problems: list[str] = []
        for cfg in cands:
            try:

                def once(cfg=cfg):
                    res = self._model_for(cfg, purpose, module_name, session_thread_id, timeout).invoke(messages)
                    text = res.content if isinstance(res.content, str) else "".join(str(c.get("text", c)) if isinstance(c, dict) else str(c) for c in res.content)
                    if not text.strip():
                        raise RuntimeError("jawaban kosong")
                    return text

                return self._call_with_backoff(cfg["provider"], once)
            except Exception as e:  # try the next provider
                problems.append(describe_failure(cfg["provider"], e))
        raise LLMUnavailable("Semua penyedia gagal:\n- " + "\n- ".join(problems))

    def stream_text(
        self,
        purpose: str,
        messages: list[Any],
        module_name: str = "chat",
        session_thread_id: str | None = None,
        timeout: float | None = None,
    ):
        """Yield the answer piece by piece. Fails over to the next provider only before the first piece arrived."""
        cands = self.candidates(purpose)
        if not cands:
            raise LLMUnavailable(self._no_provider_message(purpose))
        problems: list[str] = []
        for idx, cfg in enumerate(cands):
            started = False
            attempt = 0
            while True:
                if not self.limiter.acquire(cfg["provider"]):
                    problems.append(describe_failure(cfg["provider"], RuntimeError("429 batas permintaan lokal tercapai")))
                    break
                try:
                    stream = self._model_for(cfg, purpose, module_name, session_thread_id, timeout).stream(messages)
                    if cfg["provider"] == "ollama":
                        stream = _guard_first_piece(stream, FIRST_PIECE_LOCAL_S if idx < len(cands) - 1 else FIRST_PIECE_LOCAL_ALONE_S)
                    for chunk in stream:
                        c = chunk.content
                        text = c if isinstance(c, str) else "".join(str(x.get("text", "")) if isinstance(x, dict) else str(x) for x in c)
                        if text:
                            started = True
                            yield text
                    if started:
                        return
                    problems.append(f"{PROVIDER_CATALOG.get(cfg['provider'], {}).get('label', cfg['provider'])}: jawaban kosong")
                    break
                except Exception as e:
                    if started:
                        return  # keep what the user already saw; do not restart on another model mid-sentence
                    if isinstance(e, FirstPieceTimeout):  # no point in asking the same slow local model again
                        problems.append(describe_failure(cfg["provider"], e))
                        break
                    if classify_error(e) in ("auth", "model") or attempt >= LLM_BACKOFF_RETRIES:
                        problems.append(describe_failure(cfg["provider"], e))
                        break
                    time.sleep(self.backoff_base * (2**attempt))
                    attempt += 1
        raise LLMUnavailable("Semua penyedia gagal:\n- " + "\n- ".join(problems))

    def route_model_for_specialization(self, task_or_module: str) -> dict[str, Any]:
        """Dynamic specialization auto-router (Instruction 4):
        1. Daily tasks & Finance (@Money, @Todo, Chat/General):
           - Auto-route to Google Gemini (Gemini Flash) for fast response & Indonesian fluency.
        2. Research, Search, & Coding (@Search, @Study, @Code, @Write, @Data):
           - Auto-route to DeepSeek (DeepSeek-R1-Distill 8B via local Ollama if GPU available)
             or fallback to Gemini Pro / DeepSeek Flash if CPU-only mode.
        3. Persisted / Overridable via SQLite system_settings table.
        """
        task = task_or_module.lower().strip().lstrip("@")

        # Check manual override in system_settings
        override_key = f"models.specialization.{task}"
        try:
            with get_db_cursor() as cursor:
                cursor.execute(
                    "SELECT value FROM system_settings WHERE key = ?;",
                    (override_key,),
                )
                row = cursor.fetchone()
                if row and row["value"]:
                    return modernize_tier_config(json.loads(row["value"]))
        except Exception:
            pass

        # 1. Daily tasks & Finance
        daily_modules = {"money", "finance", "todo", "study_daily", "daily", "general", "chat", "companion", "greeting"}
        if task in daily_modules:
            selected = {
                "specialization": "daily_and_finance",
                "provider": "gemini",
                "model": GEMINI_DEFAULT_MODEL,
                "temperature": 0.2,
                "tier": "tier1_utility",
            }
            return selected

        # 2. Research, Search, & Coding
        hw = detect_hardware_profile()
        if hw.mode == "turbo_gpu":
            selected = {
                "specialization": "research_and_code",
                "provider": "ollama",
                "model": "deepseek-r1:8b",
                "temperature": 0.2,
                "tier": "tier2_code",
            }
        else:
            # CPU-only fallback: Cloud DeepSeek or Gemini Pro
            if settings.deepseek_api_key:
                selected = {
                    "specialization": "research_and_code",
                    "provider": "deepseek",
                    "model": "deepseek-ai/deepseek-v4.1-flash-1017",
                    "temperature": 0.2,
                    "tier": "tier2_code",
                }
            else:
                selected = {
                    "specialization": "research_and_code",
                    "provider": "gemini",
                    "model": GEMINI_DEFAULT_MODEL,
                    "temperature": 0.2,
                    "tier": "tier3_reasoning",
                }

        return selected

    def set_specialization_override(
        self,
        task_or_module: str,
        provider: str,
        model: str,
        temperature: float = 0.2,
    ) -> None:
        """Store user manual model override for a specialization in system_settings."""
        task = task_or_module.lower().strip().lstrip("@")
        override_key = f"models.specialization.{task}"
        config_data = {
            "specialization": task,
            "provider": provider,
            "model": model,
            "temperature": temperature,
        }
        try:
            with get_db_cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO system_settings (key, value, updated_at)
                    VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = excluded.updated_at;
                    """,
                    (override_key, json.dumps(config_data)),
                )
        except Exception:
            pass

    def verify_gemini_key(self, api_key: str) -> tuple[bool, str, str]:
        """Test Gemini API key with live call to Google Gemini. Returns (success, model_name, message)."""
        if not api_key or not api_key.strip():
            return False, "", "API Key tidak boleh kosong."

        clean_key = api_key.strip()
        try:
            from google import genai
            client = genai.Client(api_key=clean_key)
            tested_model = "gemini-2.0-flash"
            # Test model availability
            for m in ["gemini-3.8-flash", "gemini-2.0-flash", "gemini-1.5-flash"]:
                try:
                    client.models.get(model=m)
                    tested_model = m
                    break
                except Exception:
                    continue

            return True, tested_model, f"Berhasil terhubung ke Google {tested_model}!"
        except Exception as e:
            err_msg = str(e)
            if "API key not valid" in err_msg or "INVALID_ARGUMENT" in err_msg:
                return False, "", "API Key tidak valid. Mohon periksa kembali API Key Google Gemini Anda."
            return False, "", f"Gagal terhubung ke Gemini: {err_msg[:120]}"

    def check_models_health(self) -> dict[str, Any]:
        """Health check endpoint testing DB, Gemini, and Ollama/DeepSeek (Instruction 5)."""
        from backend.core.database import get_system_setting

        # 1. Test SQLite connection
        db_ok = False
        try:
            with get_db_cursor() as cursor:
                cursor.execute("SELECT 1;")
                db_ok = True
        except Exception:
            db_ok = False

        # 2. Test Gemini API with effective key (from settings or SQLite system_settings)
        gemini_ok = False
        gemini_msg = ""
        effective_gemini_key = settings.gemini_api_key or get_system_setting("api_key.gemini")
        if effective_gemini_key and str(effective_gemini_key).strip():
            gemini_ok, tested_model, gemini_msg = self.verify_gemini_key(str(effective_gemini_key))
            if gemini_ok:
                settings.gemini_api_key = str(effective_gemini_key).strip()
        else:
            gemini_msg = "Gemini API Key belum diatur"

        # 3. Test Ollama Local
        ollama_ok = False
        ollama_msg = ""
        try:
            import urllib.request
            req = urllib.request.Request(
                f"{settings.ollama_base_url}/api/tags",
                headers={"User-Agent": "Karsa-HealthCheck"},
            )
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                if resp.status == 200:
                    ollama_ok = True
                    ollama_msg = "Ollama Local Ready"
        except Exception:
            ollama_ok = False
            ollama_msg = "Ollama Local Offline"

        # 4. DeepSeek Status
        deepseek_ok = False
        deepseek_msg = ""
        effective_deepseek_key = settings.deepseek_api_key or get_system_setting("api_key.deepseek")
        if effective_deepseek_key and str(effective_deepseek_key).strip():
            deepseek_ok = True
            deepseek_msg = "DeepSeek Cloud Active"
        elif ollama_ok:
            deepseek_ok = True
            deepseek_msg = "DeepSeek Local Ready"
        else:
            deepseek_msg = "DeepSeek Offline"

        # 5. Badge calculation & single unified source of truth
        is_connected = gemini_ok or deepseek_ok
        active_model = ""
        if gemini_ok and deepseek_ok:
            badge = "🟢 Gemini Active • 🟢 DeepSeek Ready"
            badge_simple = "🟢 Gemini Active"
            active_model = "Gemini Flash"
        elif gemini_ok:
            badge = "🟢 Gemini Active"
            badge_simple = "🟢 Gemini Active"
            active_model = "Gemini Flash"
        elif deepseek_ok:
            badge = "🟢 DeepSeek Ready"
            badge_simple = "🟢 DeepSeek Ready"
            active_model = "DeepSeek R1"
        else:
            badge = "🔴 API Disconnected"
            badge_simple = "🔴 API Disconnected"
            active_model = "None"

        return {
            "status": "healthy" if is_connected and db_ok else "degraded",
            "is_connected": is_connected,
            "connected_model": active_model,
            "database": {"connected": db_ok, "name": "karsa_master.db"},
            "gemini": {"connected": gemini_ok, "message": gemini_msg},
            "ollama": {"connected": ollama_ok, "message": ollama_msg},
            "deepseek": {"connected": deepseek_ok, "message": deepseek_msg},
            "badge": badge,
            "badge_simple": badge_simple,
        }


    def live_health(self, force: bool = False, ttl_s: float = 30.0) -> dict[str, Any]:
        """Ping every provider that has a key with a 1-token request (in parallel, cached) and report what really works."""
        cached = getattr(self, "_health_cache", None)
        if cached and not force and time.monotonic() - cached[0] < ttl_s:
            return cached[1]

        def ping(pid: str) -> dict[str, Any]:
            label = PROVIDER_CATALOG[pid]["label"]
            started = time.monotonic()
            try:
                model = self.create_chat_model(pid, self._default_model(pid), 0.0, timeout=8.0)
                model.invoke("ping")
                return {"id": pid, "label": label, "has_key": True, "ok": True, "latency_ms": int((time.monotonic() - started) * 1000), "message": "Terhubung"}
            except Exception as e:
                return {"id": pid, "label": label, "has_key": True, "ok": False, "latency_ms": None, "message": describe_failure(pid, e)}

        ids = [p for p in PROVIDER_CATALOG if p != "ollama" and self.provider_ready(p)]
        results: list[dict[str, Any]] = []
        if ids:
            with ThreadPoolExecutor(max_workers=min(4, len(ids))) as pool:
                results = list(pool.map(ping, ids))
        if self.ollama_up():
            results.append({"id": "ollama", "label": PROVIDER_CATALOG["ollama"]["label"], "has_key": True, "ok": True, "latency_ms": None, "message": "Ollama lokal siap"})
        for pid in PROVIDER_CATALOG:
            if pid != "ollama" and pid not in ids:
                results.append({"id": pid, "label": PROVIDER_CATALOG[pid]["label"], "has_key": False, "ok": False, "latency_ms": None, "message": "Belum ada kunci API"})
        good = [r for r in results if r["ok"]]
        if good:
            badge = f"🟢 {good[0]['label']} Terhubung" if len(good) == 1 else f"🟢 {good[0]['label']} +{len(good) - 1} cadangan"
        elif any(r["has_key"] for r in results):
            badge = "🟠 Kunci ada tapi tidak bisa dipakai"
        else:
            badge = "🔴 Perlu API Key"
        out = {"ok": bool(good), "active": good[0]["id"] if good else None, "badge": badge, "providers": results}
        self._health_cache = (time.monotonic(), out)
        return out

    def invalidate_health(self) -> None:
        self._health_cache = None


# Global router singleton
router = LLMRouter()

