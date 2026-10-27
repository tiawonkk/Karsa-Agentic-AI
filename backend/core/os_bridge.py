"""
OS Bridge: Native Windows Hardware Hooks & Telemetry.
Provides direct, deterministic access to:
- Screen Resolution, Scale Factor, and DPI
- Master Audio Volume & Mute via pycaw / CoreAudio
- Screen Brightness via screen_brightness_control / WMI
- Hardware Lock Keys (CapsLock, NumLock) via ctypes GetKeyState
- Battery & Charger status via psutil
- Bluetooth connected devices via PowerShell / PnP
- Windows Media Session via GSMTC (Global System Media Transport Controls)
"""

import sys
import os
import ctypes
import time
import subprocess
import json
import logging
from typing import Any, Optional, Dict, List
import psutil

logger = logging.getLogger("karsa.os_bridge")

# ---------------------------------------------------------------------------
# 1. Screen & DPI Detection
# ---------------------------------------------------------------------------

def get_screen_info() -> Dict[str, Any]:
    """Detect primary monitor resolution, DPI, and scaling factor on Windows."""
    try:
        u32 = ctypes.windll.user32
        try:
            # Set DPI awareness for accurate pixel metrics
            u32.SetProcessDPIAware()
        except Exception:
            pass

        width = u32.GetSystemMetrics(0)
        height = u32.GetSystemMetrics(1)

        shcore = getattr(ctypes.windll, "shcore", None)
        dpi = 96
        if shcore and hasattr(shcore, "GetDpiForSystem"):
            try:
                dpi = shcore.GetDpiForSystem()
            except Exception:
                dpi = 96

        scale_factor = round(dpi / 96.0, 2)
        scale_percent = int(scale_factor * 100)

        return {
            "width": width,
            "height": height,
            "dpi": dpi,
            "scale_factor": scale_factor,
            "scale_percent": scale_percent,
            "status": "ok",
        }
    except Exception as e:
        logger.warning(f"Failed to detect screen info: {e}")
        return {
            "width": 1920,
            "height": 1080,
            "dpi": 96,
            "scale_factor": 1.0,
            "scale_percent": 100,
            "status": "fallback",
        }


# ---------------------------------------------------------------------------
# 2. Master Audio Volume & Mute (pycaw)
# ---------------------------------------------------------------------------

def get_master_volume() -> Dict[str, Any]:
    """Read current Windows master volume level (0-100) and mute state."""
    try:
        from pycaw.pycaw import AudioUtilities
        spk = AudioUtilities.GetSpeakers()
        if not spk:
            return {"level": 50, "muted": False, "device_name": "Default Audio", "status": "no_device"}

        vol_scalar = spk.EndpointVolume.GetMasterVolumeLevelScalar()
        muted = bool(spk.EndpointVolume.GetMute())
        level = int(round(vol_scalar * 100))
        device_name = getattr(spk, "FriendlyName", "Speakers")

        return {
            "level": level,
            "muted": muted,
            "device_name": device_name,
            "status": "ok",
        }
    except Exception as e:
        logger.warning(f"Failed to read master volume: {e}")
        return {"level": 50, "muted": False, "device_name": "Speakers", "status": f"error: {e}"}


def set_master_volume(level: int) -> Dict[str, Any]:
    """Set Windows master volume level (0-100)."""
    try:
        from pycaw.pycaw import AudioUtilities
        spk = AudioUtilities.GetSpeakers()
        if not spk:
            return {"status": "error", "error": "No audio endpoint found"}

        clamped = max(0, min(100, level))
        scalar = clamped / 100.0
        spk.EndpointVolume.SetMasterVolumeLevelScalar(scalar, None)
        return {"status": "ok", "level": clamped, "muted": bool(spk.EndpointVolume.GetMute())}
    except Exception as e:
        logger.error(f"Failed to set master volume: {e}")
        return {"status": "error", "error": str(e)}


def set_master_mute(muted: bool) -> Dict[str, Any]:
    """Mute or unmute Windows master volume."""
    try:
        from pycaw.pycaw import AudioUtilities
        spk = AudioUtilities.GetSpeakers()
        if not spk:
            return {"status": "error", "error": "No audio endpoint found"}

        spk.EndpointVolume.SetMute(1 if muted else 0, None)
        return {"status": "ok", "muted": muted}
    except Exception as e:
        logger.error(f"Failed to set mute: {e}")
        return {"status": "error", "error": str(e)}


# ---------------------------------------------------------------------------
# 3. Screen Brightness (screen_brightness_control)
# ---------------------------------------------------------------------------

def get_screen_brightness() -> Dict[str, Any]:
    """Read laptop screen brightness (0-100)."""
    try:
        import screen_brightness_control as sbc
        val = sbc.get_brightness()
        level = val[0] if isinstance(val, list) and val else int(val or 100)
        return {"level": level, "status": "ok"}
    except Exception as e:
        logger.warning(f"Failed to read screen brightness: {e}")
        return {"level": 100, "status": f"unsupported_or_error: {e}"}


def set_screen_brightness(level: int) -> Dict[str, Any]:
    """Set laptop screen brightness (0-100)."""
    try:
        import screen_brightness_control as sbc
        clamped = max(0, min(100, level))
        sbc.set_brightness(clamped)
        return {"level": clamped, "status": "ok"}
    except Exception as e:
        logger.error(f"Failed to set screen brightness: {e}")
        return {"status": "error", "error": str(e)}


# ---------------------------------------------------------------------------
# 4. Lock Keys (CapsLock & NumLock)
# ---------------------------------------------------------------------------

def get_lock_keys() -> Dict[str, bool]:
    """Read real-time CapsLock and NumLock states from Windows user32."""
    try:
        # VK_CAPITAL = 0x14, VK_NUMLOCK = 0x90
        caps = bool(ctypes.windll.user32.GetKeyState(0x14) & 1)
        num = bool(ctypes.windll.user32.GetKeyState(0x90) & 1)
        return {"caps_lock": caps, "num_lock": num}
    except Exception as e:
        logger.warning(f"Failed to read lock keys: {e}")
        return {"caps_lock": False, "num_lock": False}


# ---------------------------------------------------------------------------
# 5. Battery & Power Status (psutil)
# ---------------------------------------------------------------------------

def get_battery_status() -> Dict[str, Any]:
    """Read laptop battery percentage and charging state."""
    try:
        b = psutil.sensors_battery()
        if b is None:
            return {
                "percent": 100,
                "charging": True,
                "power_plugged": True,
                "secs_left": -1,
                "has_battery": False,
                "status": "desktop_ac_power",
            }
        return {
            "percent": int(round(b.percent)),
            "charging": bool(b.power_plugged),
            "power_plugged": bool(b.power_plugged),
            "secs_left": b.secsleft,
            "has_battery": True,
            "status": "ok",
        }
    except Exception as e:
        logger.warning(f"Failed to read battery status: {e}")
        return {
            "percent": 100,
            "charging": True,
            "power_plugged": True,
            "secs_left": -1,
            "has_battery": False,
            "status": f"error: {e}",
        }


# ---------------------------------------------------------------------------
# 6. Bluetooth Devices
# ---------------------------------------------------------------------------

_BT_NOISE = ("enumerator", "adapter", "radio", "rfcomm", "transport", "generic bluetooth", "wireless bluetooth", "avrcp", "le generic", "service discovery")


def parse_bluetooth_json(out: str) -> List[Dict[str, Any]]:
    """PowerShell JSON -> [{name, connected, battery_percent|None}]. Adapters and protocol entries are dropped."""
    out = (out or "").strip()
    if not out:
        return []
    try:
        data = json.loads(out)
    except ValueError:
        return []
    items = [data] if isinstance(data, dict) else data if isinstance(data, list) else []
    results: List[Dict[str, Any]] = []
    seen = set()
    for it in items:
        if not isinstance(it, dict):
            continue
        name = str(it.get("FriendlyName") or "").strip()
        if not name or any(n in name.lower() for n in _BT_NOISE) or name in seen:
            continue
        seen.add(name)
        batt = it.get("Battery")
        battery = int(batt) if isinstance(batt, (int, float)) and 0 <= int(batt) <= 100 else None
        results.append({"name": name, "connected": True, "battery_percent": battery})
    return results


def get_bluetooth_devices() -> List[Dict[str, Any]]:
    """Connected Bluetooth devices on Windows. `battery_percent` is what Windows reports (DEVPKEY battery) or None:
    never an estimate."""
    ps_cmd = (
        "Get-PnpDevice -Class Bluetooth -Status OK | ForEach-Object { "
        "$b = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBAA} 2' -ErrorAction SilentlyContinue).Data; "
        "[pscustomobject]@{ FriendlyName = $_.FriendlyName; Battery = $b } } | ConvertTo-Json -Compress"
    )
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_cmd],
            text=True,
            timeout=6,
        )
        return parse_bluetooth_json(out)
    except Exception as e:
        logger.warning(f"Failed to query Bluetooth devices: {e}")
        return []


# ---------------------------------------------------------------------------
# 7. Media Session (GSMTC)
# ---------------------------------------------------------------------------

def get_media_session() -> Dict[str, Any]:
    """Query active Windows media session (Spotify, Chrome, Apple Music)."""
    ps_script = """
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
Function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(1200) | Out-Null
    $netTask.Result
}
try {
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime] | Out-Null
    $op = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
    $mgr = Await $op ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $cur = $mgr.GetCurrentSession()
    if ($cur) {
        $props = Await ($cur.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $info = $cur.GetPlaybackInfo()
        $tl = $cur.GetTimelineProperties()
        [PSCustomObject]@{
            title = $props.Title
            artist = $props.Artist
            album = $props.AlbumTitle
            status = $info.PlaybackStatus.ToString()
            position_s = [int]$tl.Position.TotalSeconds
            duration_s = [int](($tl.EndTime - $tl.StartTime).TotalSeconds)
        } | ConvertTo-Json -Compress
    } else {
        '{"status":"idle"}'
    }
} catch {
    '{"status":"unavailable"}'
}
"""
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
            text=True,
            timeout=3,
        ).strip()
        if out:
            data = json.loads(out)
            if data.get("title"):
                return data

    except Exception as e:
        logger.debug(f"GSMTC query fallback: {e}")

    # Honest zero-dummy state when no media is playing in OS
    return {
        "title": "Tidak ada media yang diputar",
        "artist": "Buka Spotify, YouTube, atau pemutar musik",
        "album": "",
        "status": "idle",
    }


MEDIA_CONTROL_METHODS = {
    "play_pause": "TryTogglePlayPauseAsync",
    "next": "TrySkipNextAsync",
    "previous": "TrySkipPreviousAsync",
}


def control_media(action: str) -> Dict[str, Any]:
    """Send a transport command (play_pause / next / previous) to the active Windows media session."""
    method = MEDIA_CONTROL_METHODS.get(action)
    if method is None:
        raise ValueError(f"Aksi media tidak dikenal: {action}")

    ps_script = f"""
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {{ $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' }})[0]
Function Await($WinRtTask, $ResultType) {{
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(1500) | Out-Null
    $netTask.Result
}}
try {{
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime] | Out-Null
    $op = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
    $mgr = Await $op ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $cur = $mgr.GetCurrentSession()
    if ($cur) {{
        $ok = Await ($cur.{method}()) ([bool])
        if ($ok) {{ '{{"ok":true}}' }} else {{ '{{"ok":false,"reason":"rejected"}}' }}
    }} else {{
        '{{"ok":false,"reason":"no_session"}}'
    }}
}} catch {{
    '{{"ok":false,"reason":"unavailable"}}'
}}
"""
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
            text=True,
            timeout=4,
        ).strip()
        return json.loads(out) if out else {"ok": False, "reason": "unavailable"}
    except Exception as e:
        logger.debug(f"GSMTC control failed: {e}")
        return {"ok": False, "reason": "unavailable"}


# ---------------------------------------------------------------------------
# 7. Function keys (F1-F12) and media keys for the Dynamic Island OSD
# ---------------------------------------------------------------------------

# Privacy: ONLY these keys are watched, and only whether they are down. No other key is read, nothing is stored.
FUNCTION_KEY_VKS: Dict[str, int] = {f"F{i}": 0x6F + i for i in range(1, 13)}  # VK_F1 = 0x70
MEDIA_KEY_VKS: Dict[str, int] = {
    "Play/Pause": 0xB3,
    "Next": 0xB0,
    "Previous": 0xB1,
    "Stop": 0xB2,
}

# Standard Windows meanings (laptop-specific Fn actions such as brightness arrive as Volume/Brightness events instead)
FUNCTION_KEY_LABELS: Dict[str, str] = {
    "F1": "Bantuan",
    "F2": "Ubah Nama",
    "F3": "Cari",
    "F4": "Daftar Alamat",
    "F5": "Muat Ulang",
    "F6": "Fokus Bilah Alamat",
    "F7": "Navigasi Kursor",
    "F8": "Mode Pilih",
    "F9": "Segarkan Dokumen",
    "F10": "Aktifkan Menu",
    "F11": "Layar Penuh",
    "F12": "Simpan Sebagai / DevTools",
}


def get_pressed_keys() -> set:
    """Names of the watched keys (F1-F12 and media keys) that are physically down right now."""
    try:
        user32 = ctypes.windll.user32
        down = set()
        for name, vk in {**FUNCTION_KEY_VKS, **MEDIA_KEY_VKS}.items():
            if user32.GetAsyncKeyState(vk) & 0x8000:
                down.add(name)
        return down
    except Exception:
        return set()


def is_alt_down() -> bool:
    try:
        return bool(ctypes.windll.user32.GetAsyncKeyState(0x12) & 0x8000)  # VK_MENU
    except Exception:
        return False


def newly_pressed(previous: set, current: set) -> List[str]:
    """Keys that went from up to down between two polls, in a stable order (F1..F12 first, then media keys)."""
    order = list(FUNCTION_KEY_VKS) + list(MEDIA_KEY_VKS)
    return [k for k in order if k in current and k not in previous]


def describe_key(name: str, alt: bool = False) -> Dict[str, Any]:
    """OSD payload for one key press."""
    if name in MEDIA_KEY_VKS:
        return {"key": name, "label": "Kontrol Media", "kind": "media"}
    if name == "F4" and alt:
        return {"key": "Alt+F4", "label": "Tutup Jendela", "kind": "function"}
    return {"key": name, "label": FUNCTION_KEY_LABELS.get(name, "Tombol Fungsi"), "kind": "function"}
