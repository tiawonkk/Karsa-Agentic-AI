from __future__ import annotations

from pathlib import Path
from typing import Literal
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

HardwareMode = Literal["turbo_gpu", "eco_cpu"]
PowerState = Literal["active", "sleep"]

# Project root (.../KarsaProject) so `.env` is found regardless of the working directory.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE_PATH = PROJECT_ROOT / ".env"

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="KARSA_",
        env_file=str(ENV_FILE_PATH),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # General
    app_name: str = "Project Karsa"
    app_version: str = "0.1.0"
    debug: bool = False
    host: str = "127.0.0.1"
    port: int = 8765

    # Storage Paths (Cross-Platform via pathlib.Path.home())
    data_dir: Path = Field(default_factory=lambda: Path.home() / ".karsa")

    # Hardware & Thermal Sleep Defaults
    hardware_override: str = "auto"  # "auto" | "turbo_gpu" | "eco_cpu"
    min_vram_gb: float = 6.0
    sleep_idle_minutes: int = 5
    # Show F1-F12 and media-key presses in the Dynamic Island. Only the key NAME of those keys is read (never other keys).
    fkey_osd: bool = True
    # A pending human approval older than this is auto-rejected (reviewer timeout) and its thread is released.
    hitl_timeout_minutes: int = 120
    ollama_base_url: str = "http://localhost:11434"

    # API Keys (optional depending on active cloud provider)
    gemini_api_key: str | None = None
    groq_api_key: str | None = None
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    openai_compatible_base_url: str | None = None
    openai_compatible_api_key: str | None = None
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"

    # Council (multi-model collaboration) members
    council_worker_model: str = "hermes3:8b"          # Ollama local: fast drafter
    council_reasoner_model: str = "deepseek-r1:8b"    # Ollama local: step-by-step critic
    council_reasoner_provider: str = "ollama"         # "ollama" | "deepseek" (cloud API)
    council_synth_model: str = "gemini-3.8-flash"     # Gemini: final synthesis

    # Model Defaults per Tier (Lightweight: Gemini 2.5 Flash & DeepSeek Flash)
    tier1_model: str = "gemini-3.8-flash"  # fallback or eco default
    tier1_local_model: str = "hermes3:8b"   # for turbo_gpu
    tier2_model: str = "deepseek-ai/deepseek-v4.1-flash-1017"
    tier3_model: str = "deepseek-ai/deepseek-v4.1-flash-1017"

    # Token Pricing & Currency defaults
    usd_to_idr_rate: float = 16000.0

    @property
    def storage_dir(self) -> Path:
        return self.data_dir / "storage"

    @property
    def master_db_path(self) -> Path:
        return self.storage_dir / "karsa_master.db"

    @property
    def checkpoints_db_path(self) -> Path:
        return self.storage_dir / "karsa_checkpoints.db"

    @property
    def wardrobe_dir(self) -> Path:
        return self.data_dir / "wardrobe"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def outputs_dir(self) -> Path:
        return self.data_dir / "outputs"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    def ensure_directories(self) -> None:
        """Create all required local storage directories if they do not exist."""
        for path in (
            self.data_dir,
            self.storage_dir,
            self.wardrobe_dir,
            self.uploads_dir,
            self.outputs_dir,
            self.logs_dir,
        ):
            path.mkdir(parents=True, exist_ok=True)


# Global singleton instance
settings = Settings()
