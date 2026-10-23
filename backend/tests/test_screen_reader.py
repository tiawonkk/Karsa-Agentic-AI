from PIL import Image
from backend.core.state import ToolError
from backend.screen_context.screen_reader import (
    compress_image,
    get_active_window_info,
    capture_screen_assist,
)


def test_privacy_consent_guard():
    # Calling without explicit consent must return ToolError
    result = capture_screen_assist(user_consented=False)
    assert isinstance(result, ToolError)
    assert result.error_code == "PRIVACY_CONSENT_REQUIRED"
    assert result.ok is False


def test_compress_image():
    # Create large dummy image
    img = Image.new("RGBA", (2000, 1000), color=(255, 0, 0, 255))
    compressed_bytes, w, h = compress_image(img, max_dimension=1280, jpeg_quality=70)

    assert len(compressed_bytes) > 0
    assert w <= 1280
    assert h <= 1280


def test_get_active_window_info():
    title, proc = get_active_window_info()
    assert isinstance(title, str)
    assert isinstance(proc, str)
    assert len(title) > 0
