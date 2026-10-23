from __future__ import annotations

import ctypes
import datetime
import io
import platform
import uuid
from pathlib import Path
from typing import Any
from PIL import Image, ImageGrab
import psutil

from backend.core.config import settings
from backend.core.state import ActiveWindowContext, ToolError


def get_active_window_info() -> tuple[str, str]:
    """Identify window title and process name of the active foreground window."""
    sys_name = platform.system()

    if sys_name == "Windows":
        try:
            user32 = ctypes.windll.user32
            hwnd = user32.GetForegroundWindow()
            if not hwnd:
                return "Desktop / Unknown Window", "explorer.exe"

            length = user32.GetWindowTextLengthW(hwnd)
            buff = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buff, length + 1)
            title = buff.value or "Untitled Window"

            pid = ctypes.c_ulong()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            proc_name = "unknown"
            if pid.value:
                try:
                    proc = psutil.Process(pid.value)
                    proc_name = proc.name()
                except Exception:
                    pass
            return title, proc_name
        except Exception:
            return "Windows Desktop", "explorer.exe"

    return "Active Desktop Window", "system"


def compress_image(
    image: Image.Image,
    max_dimension: int = 1280,
    jpeg_quality: int = 75,
) -> tuple[bytes, int, int]:
    """Compress image proportionally with maximum dimension cap and JPEG optimization."""
    # Convert RGBA to RGB for JPEG
    if image.mode in ("RGBA", "P"):
        rgb_img = Image.new("RGB", image.size, (255, 255, 255))
        rgb_img.paste(image, mask=image.split()[-1] if image.mode == "RGBA" else None)
        image = rgb_img

    w, h = image.size
    if max(w, h) > max_dimension:
        scale = max_dimension / float(max(w, h))
        new_w, new_h = int(w * scale), int(h * scale)
        image = image.resize((new_w, new_h), Image.Resampling.LANCZOS)
        w, h = new_w, new_h

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=jpeg_quality, optimize=True)
    return buffer.getvalue(), w, h


def capture_screen_assist(
    user_consented: bool = True,
    max_dimension: int = 1280,
    jpeg_quality: int = 75,
) -> ActiveWindowContext | ToolError:
    """ScreenAssist tool: Capture foreground active window context with compression and privacy guard.
    
    Strict Privacy Policy: Refuses capture if user_consented is False (Zero Stealth Recording).
    """
    if not user_consented:
        return ToolError(
            error_code="PRIVACY_CONSENT_REQUIRED",
            message="Tangkapan layar ditolak: Izin pengguna belum diberikan.",
            hint="Klik tombol 'ScreenAssist' di Notch untuk menyetujui pembacaan layar aktif secara sadar.",
        )

    # 1. Read foreground window details
    title, proc_name = get_active_window_info()

    # 2. Capture screen image
    cache_dir = settings.uploads_dir / "screen_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()

    file_path: str | None = None
    try:
        raw_img = ImageGrab.grab()
        if raw_img:
            compressed_bytes, _, _ = compress_image(raw_img, max_dimension, jpeg_quality)
            save_name = f"screen_{uuid.uuid4().hex[:8]}.jpg"
            save_path = cache_dir / save_name
            save_path.write_bytes(compressed_bytes)
            file_path = str(save_path.resolve())
    except Exception as e:
        # Graceful fallback if headless/CI environment without display
        file_path = None

    return {
        "window_title": title,
        "process_name": proc_name,
        "screenshot_ref": file_path,
        "ocr_text_preview": f"Tangkapan layar dari jendela: {title} ({proc_name})",
        "captured_at": timestamp,
    }
