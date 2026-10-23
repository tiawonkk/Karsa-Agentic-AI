"""
Unit tests for OS Bridge: Native Windows Hardware Telemetry & Hooks.
"""

from unittest.mock import patch, MagicMock
from backend.core.os_bridge import (
    get_screen_info,
    get_master_volume,
    set_master_volume,
    set_master_mute,
    get_screen_brightness,
    set_screen_brightness,
    get_lock_keys,
    get_battery_status,
    get_bluetooth_devices,
    get_media_session,
)


def test_get_screen_info():
    info = get_screen_info()
    assert "width" in info
    assert "height" in info
    assert "dpi" in info
    assert "scale_factor" in info
    assert info["width"] > 0
    assert info["height"] > 0


def test_get_master_volume():
    vol = get_master_volume()
    assert "level" in vol
    assert "muted" in vol
    assert 0 <= vol["level"] <= 100
    assert isinstance(vol["muted"], bool)


def test_set_master_volume_mocked():
    with patch("pycaw.pycaw.AudioUtilities.GetSpeakers") as mock_spk:
        mock_dev = MagicMock()
        mock_spk.return_value = mock_dev
        res = set_master_volume(60)
        assert res["status"] == "ok"
        assert res["level"] == 60


def test_set_master_mute_mocked():
    with patch("pycaw.pycaw.AudioUtilities.GetSpeakers") as mock_spk:
        mock_dev = MagicMock()
        mock_spk.return_value = mock_dev
        res = set_master_mute(True)
        assert res["status"] == "ok"
        assert res["muted"] is True


def test_get_screen_brightness():
    b = get_screen_brightness()
    assert "level" in b
    assert 0 <= b["level"] <= 100


def test_get_lock_keys():
    locks = get_lock_keys()
    assert "caps_lock" in locks
    assert "num_lock" in locks
    assert isinstance(locks["caps_lock"], bool)
    assert isinstance(locks["num_lock"], bool)


def test_get_battery_status():
    bat = get_battery_status()
    assert "percent" in bat
    assert "charging" in bat
    assert 0 <= bat["percent"] <= 100


def test_get_media_session():
    media = get_media_session()
    assert "title" in media or "status" in media
