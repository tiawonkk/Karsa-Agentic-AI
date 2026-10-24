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
    control_media,
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


def test_control_media_sends_the_matching_gsmtc_method():
    with patch("backend.core.os_bridge.subprocess.check_output", return_value='{"ok":true}') as run:
        assert control_media("next") == {"ok": True}
        assert "TrySkipNextAsync" in run.call_args.args[0][-1]
        control_media("previous")
        assert "TrySkipPreviousAsync" in run.call_args.args[0][-1]
        control_media("play_pause")
        assert "TryTogglePlayPauseAsync" in run.call_args.args[0][-1]


def test_control_media_rejects_unknown_action_and_survives_powershell_failure():
    import pytest

    with pytest.raises(ValueError):
        control_media("explode")
    with patch("backend.core.os_bridge.subprocess.check_output", side_effect=OSError("boom")):
        assert control_media("next") == {"ok": False, "reason": "unavailable"}


def test_media_control_endpoint_validates_action():
    from fastapi.testclient import TestClient
    from backend.api.main import app

    client = TestClient(app)
    assert client.post("/api/v1/system/media/control", json={"action": "explode"}).status_code == 422
    with patch("backend.api.main.control_media", return_value={"ok": True}) as ctl:
        res = client.post("/api/v1/system/media/control", json={"action": "next"})
        assert res.status_code == 200 and res.json() == {"ok": True}
        ctl.assert_called_once_with("next")


def test_function_key_diff_and_description():
    from backend.core.os_bridge import describe_key, newly_pressed

    assert newly_pressed(set(), {"F5", "F1"}) == ["F1", "F5"]  # stable order, F1..F12 first
    assert newly_pressed({"F5"}, {"F5"}) == []  # a held key does not repeat
    assert newly_pressed({"F5"}, set()) == []  # release is not a press
    assert newly_pressed(set(), {"Next", "F12"}) == ["F12", "Next"]

    assert describe_key("F5") == {"key": "F5", "label": "Muat Ulang", "kind": "function"}
    assert describe_key("F11")["label"] == "Layar Penuh"
    assert describe_key("F4", alt=True) == {"key": "Alt+F4", "label": "Tutup Jendela", "kind": "function"}
    assert describe_key("Play/Pause")["kind"] == "media"


def test_pressed_keys_watch_only_function_and_media_keys():
    from backend.core.os_bridge import FUNCTION_KEY_VKS, MEDIA_KEY_VKS, get_pressed_keys

    assert set(FUNCTION_KEY_VKS) == {f"F{i}" for i in range(1, 13)}
    asked = []

    class FakeUser32:
        def GetAsyncKeyState(self, vk):
            asked.append(vk)
            return 0x8000 if vk == FUNCTION_KEY_VKS["F5"] else 0

    class FakeWindll:
        user32 = FakeUser32()

    with patch("backend.core.os_bridge.ctypes.windll", FakeWindll(), create=True):
        assert get_pressed_keys() == {"F5"}
    # Privacy contract: nothing outside F1-F12 and the four media keys is ever queried
    assert set(asked) <= set(FUNCTION_KEY_VKS.values()) | set(MEDIA_KEY_VKS.values())
