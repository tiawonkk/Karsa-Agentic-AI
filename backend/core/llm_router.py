from __future__ import annotations

import json
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


class LLMRouter:
    """Universal Model Router supporting hot-swappable providers and hardware adaptation."""

    def __init__(self) -> None:
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
    ) -> BaseChatModel:
        """Instantiate a LangChain chat model based on provider identifier."""
        prov = provider.lower()

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
                    request_timeout=15.0,
                )
            except ImportError:
                raise RuntimeError("langchain-google-genai is not installed.")

        elif prov == "groq":
            try:
                from langchain_groq import ChatGroq
                key = api_key or settings.groq_api_key
                return ChatGroq(
                    model=model_name,
                    groq_api_key=key,
                    temperature=temperature,
                    timeout=15.0,
                )
            except ImportError:
                raise RuntimeError("langchain-groq is not installed.")

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
                    timeout=15.0,
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
    ) -> BaseChatModel:
        """Get or create chat model instance configured with token tracking callbacks."""
        config = self.get_tier_config(tier)
        prov = provider or config.get("provider", "gemini")
        mdl = model or config.get("model", "gemini-3.8-flash")
        temp = temperature if temperature is not None else float(config.get("temperature", 0.2))

        hw = detect_hardware_profile()
        cache_key = f"{tier}:{prov}:{mdl}:{temp}:{module_name}"

        # Initialize base model
        base_model = self.create_chat_model(prov, mdl, temp)

        # Attach token tracking telemetry callback
        tracker = TokenTrackerCallbackHandler(
            module_name=module_name,
            provider=prov,
            model_name=mdl,
            hardware_mode=hw.mode,
            session_thread_id=session_thread_id,
        )

        return base_model.with_config(callbacks=[tracker])

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


# Global router singleton
router = LLMRouter()

