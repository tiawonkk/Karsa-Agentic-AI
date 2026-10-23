from backend.core.hardware_detector import (
    detect_hardware_profile,
    unload_local_models_for_sleep,
)
from backend.core.config import settings


def test_detect_hardware_profile():
    profile = detect_hardware_profile()
    assert profile.mode in ("turbo_gpu", "eco_cpu")
    assert profile.ram_total_gb > 0
    assert profile.os_name != ""
    assert profile.cpu_name != ""
    assert isinstance(profile.reason, str)


def test_hardware_override_config(monkeypatch):
    monkeypatch.setattr(settings, "hardware_override", "turbo_gpu")
    profile = detect_hardware_profile()
    assert profile.mode == "turbo_gpu"
    assert "override" in profile.reason.lower()

    monkeypatch.setattr(settings, "hardware_override", "eco_cpu")
    profile_eco = detect_hardware_profile()
    assert profile_eco.mode == "eco_cpu"


def test_zero_heat_sleep_unloader():
    # Calling unloader with unreachable/fake port should handle gracefully and quickly
    res = unload_local_models_for_sleep(base_url="http://127.0.0.1:9999", timeout_seconds=0.2)
    assert "status" in res
