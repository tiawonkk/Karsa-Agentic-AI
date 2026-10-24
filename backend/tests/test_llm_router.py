import pytest
from pathlib import Path

from backend.core.config import settings
from backend.core.database import initialize_master_database
from backend.core.llm_router import router, LLMRouter


def test_llm_router_tier_config():
    r = LLMRouter()
    cfg_tier1 = r.get_tier_config("tier1_utility")
    assert "provider" in cfg_tier1
    assert "model" in cfg_tier1


def test_llm_router_hot_swap(tmp_path: Path, monkeypatch):
    test_db = tmp_path / "test_router.db"
    initialize_master_database(test_db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    r = LLMRouter()
    r.set_tier_config("tier1_utility", provider="groq", model="llama-3.3-70b-versatile", temperature=0.3)

    updated = r.get_tier_config("tier1_utility")
    assert updated["provider"] == "groq"
    assert updated["model"] == "llama-3.3-70b-versatile"
    assert updated["temperature"] == 0.3


def test_unsupported_provider():
    r = LLMRouter()
    with pytest.raises(ValueError, match="Unsupported LLM provider"):
        r.create_chat_model("unknown_xyz", "some_model")


def test_retired_gemini_models_are_upgraded_but_other_models_are_untouched():
    from backend.core.llm_router import GEMINI_DEFAULT_MODEL, modernize_tier_config

    for dead in ("gemini-1.5-pro", "gemini-2.0-flash", "gemini-2.5-flash"):
        assert modernize_tier_config({"provider": "gemini", "model": dead, "temperature": 0.2}) == {
            "provider": "gemini", "model": GEMINI_DEFAULT_MODEL, "temperature": 0.2,
        }
    keep = {"provider": "deepseek", "model": "gemini-2.5-flash", "temperature": 0.1}  # not a Gemini provider
    assert modernize_tier_config(keep) == keep
    assert modernize_tier_config({"provider": "gemini", "model": "gemini-3.1-pro-preview"})["model"] == "gemini-3.1-pro-preview"
