from __future__ import annotations

import platform
import shutil
import subprocess
from typing import Any
import httpx
import psutil

from backend.core.config import settings
from backend.core.state import HardwareMode, HardwareProfile


def check_ollama_status(base_url: str | None = None, timeout_seconds: float = 1.0) -> tuple[bool, list[str]]:
    """Check if Ollama local daemon is running and return list of available models."""
    url = (base_url or settings.ollama_base_url).rstrip("/") + "/api/tags"
    try:
        with httpx.Client(timeout=timeout_seconds) as client:
            resp = client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                models = [m.get("name", "") for m in data.get("models", []) if "name" in m]
                return True, models
    except Exception:
        pass
    return False, []


def detect_nvidia_gpu() -> tuple[str | None, float | None]:
    """Detect NVIDIA GPU name and total VRAM in GB using nvidia-smi if available."""
    if not shutil.which("nvidia-smi"):
        return None, None

    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=2.0,
        )
        line = result.stdout.strip().splitlines()[0]
        parts = [p.strip() for p in line.split(",")]
        gpu_name = parts[0]
        vram_mb = float(parts[1])
        return gpu_name, round(vram_mb / 1024.0, 2)
    except Exception:
        return None, None


def detect_hardware_profile(force_redetect: bool = False) -> HardwareProfile:
    """Evaluate host hardware and decide whether to use turbo_gpu or eco_cpu mode."""
    # Read system specs
    vm = psutil.virtual_memory()
    ram_total_gb = round(vm.total / (1024**3), 2)
    ram_available_gb = round(vm.available / (1024**3), 2)
    os_name = f"{platform.system()} {platform.release()}"
    cpu_name = platform.processor() or platform.machine()
    is_apple_silicon = platform.system() == "Darwin" and platform.machine() == "arm64"

    # Check GPU
    gpu_name, vram_gb = detect_nvidia_gpu()

    # Check Ollama
    ollama_running, _ = check_ollama_status()

    # Hardware decision logic
    override = settings.hardware_override.lower()
    mode: HardwareMode = "eco_cpu"
    reason: str = ""

    if override in ("turbo_gpu", "eco_cpu"):
        mode = override  # type: ignore[assignment]
        reason = f"Manual override active: {override}"
    elif not ollama_running:
        mode = "eco_cpu"
        reason = "Ollama runtime is not reachable; routing Tier-1 to lightweight cloud API."
    elif vram_gb is not None and vram_gb >= settings.min_vram_gb:
        mode = "turbo_gpu"
        reason = f"Discrete GPU detected ({gpu_name}, {vram_gb} GB VRAM >= {settings.min_vram_gb} GB target). Zero IDR local mode enabled."
    elif is_apple_silicon and ram_total_gb >= 16.0:
        mode = "turbo_gpu"
        reason = f"Apple Silicon detected with {ram_total_gb} GB unified memory. Local runtime enabled."
    else:
        mode = "eco_cpu"
        reason = (
            f"VRAM/RAM below high-performance threshold or discrete GPU absent. "
            f"Eco CPU mode active to prevent system freezing."
        )

    return HardwareProfile(
        mode=mode,
        os_name=os_name,
        cpu_name=cpu_name,
        ram_total_gb=ram_total_gb,
        ram_available_gb=ram_available_gb,
        gpu_name=gpu_name,
        vram_gb=vram_gb,
        apple_silicon=is_apple_silicon,
        ollama_available=ollama_running,
        reason=reason,
    )


def unload_local_models_for_sleep(
    models: list[str] | None = None,
    base_url: str | None = None,
    timeout_seconds: float = 2.0,
) -> dict[str, Any]:
    """Execute Zero-Heat Sleep Mode: tell Ollama to immediately unload models from VRAM (keep_alive=0).
    
    This ensures GPU/RAM usage drops to 0.0% when the laptop is idle or entering sleep state.
    """
    url = (base_url or settings.ollama_base_url).rstrip("/") + "/api/generate"
    ollama_running, available_models = check_ollama_status(base_url, timeout_seconds=1.0)
    
    if not ollama_running:
        return {"status": "skipped", "message": "Ollama is not running"}

    target_models = models or available_models or [settings.tier1_local_model]
    unloaded: list[str] = []
    errors: list[str] = []

    with httpx.Client(timeout=timeout_seconds) as client:
        for model_name in target_models:
            try:
                resp = client.post(url, json={"model": model_name, "keep_alive": 0})
                if resp.status_code in (200, 404):
                    unloaded.append(model_name)
                else:
                    errors.append(f"{model_name}: HTTP {resp.status_code}")
            except Exception as e:
                errors.append(f"{model_name}: {str(e)}")

    return {
        "status": "success" if not errors else "partial",
        "unloaded_models": unloaded,
        "errors": errors,
        "zero_heat_active": True,
    }
