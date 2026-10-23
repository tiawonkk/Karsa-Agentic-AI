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

# Default Model Tier Profiles (Lightweight, Token-Efficient: Gemini 3.8 Flash & DeepSeek Flash)
DEFAULT_TIER_PROFILES: dict[str, dict[str, Any]] = {
    "tier1_utility": {
        "provider": "gemini",
        "model": "gemini-3.8-flash",
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
            return dict(self._runtime_overrides[tier])

        # Check SQLite system_settings
        try:
            with get_db_cursor() as cursor:
                cursor.execute(
                    "SELECT value FROM system_settings WHERE key = ?;",
                    (f"models.{tier}",),
                )
                row = cursor.fetchone()
                if row and row["value"]:
                    return json.loads(row["value"])
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
                return ChatOpenAI(
                    model=model_name,
                    api_key=api_key or settings.deepseek_api_key or "missing-key",
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
        mdl = model or config.get("model", "gemini-2.0-flash")
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


# Global router singleton
router = LLMRouter()
