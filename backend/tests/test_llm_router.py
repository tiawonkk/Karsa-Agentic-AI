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
