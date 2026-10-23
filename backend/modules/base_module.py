from __future__ import annotations

import json
from abc import ABC, abstractmethod
from typing import Any, ClassVar
from pydantic import BaseModel, ConfigDict, Field
from langchain_core.tools import BaseTool
from langgraph.graph.state import CompiledStateGraph

from backend.core.config import settings
from backend.core.database import get_db_cursor
from backend.core.llm_router import router, LLMRouter


class ModuleManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    module_id: str                      # Unique snake_case ID, e.g. "finance", "study_daily"
    display_name: str                   # E.g. "Financial Intelligence"
    version: str = "0.1.0"
    description: str                    # Concise 1-sentence description used by LLM triage router
    intent_patterns: list[str]          # Regex/keyword patterns for zero-token deterministic routing
    model_tier: str = "tier1_utility"   # Default tier
    high_risk_actions: list[str] = Field(default_factory=list)  # Actions requiring HITL approval
    requires: list[str] = Field(default_factory=list)           # Optional external dependencies


class ModuleContext:
    """Runtime context passed to module instances."""

    def __init__(
        self,
        llm_router: LLMRouter | None = None,
        hardware_mode: str = "eco_cpu",
        session_thread_id: str | None = None,
    ) -> None:
        self.router = llm_router or router
        self.hardware_mode = hardware_mode
        self.session_thread_id = session_thread_id
        self.settings = settings


class BaseKarsaModule(ABC):
    """Abstract Base Class for all plug-and-play specialist student modules."""

    manifest: ClassVar[ModuleManifest]

    @abstractmethod
    def get_tools(self) -> list[BaseTool]:
        """Return list of Poka-Yoke tools provided by this module."""
        ...

    @abstractmethod
    def build_graph(self, ctx: ModuleContext) -> CompiledStateGraph:
        """Construct and return the isolated sub-graph for this module."""
        ...

    def on_load(self, ctx: ModuleContext) -> None:
        """Lifecycle hook called when the module is registered/loaded."""
        pass

    def health_check(self) -> dict[str, Any]:
        """Check status of dependencies and local engines."""
        return {
            "status": "healthy",
            "module_id": self.manifest.module_id,
            "version": self.manifest.version,
        }


class ModuleRegistry:
    """Central registry for discovering, registering, and enabling Karsa modules."""

    def __init__(self) -> None:
        self._modules: dict[str, BaseKarsaModule] = {}

    def register(self, module: BaseKarsaModule) -> None:
        """Register a module instance."""
        manifest = module.manifest
        if manifest.module_id in self._modules:
            raise ValueError(f"Module ID '{manifest.module_id}' is already registered.")
        self._modules[manifest.module_id] = module
        ctx = ModuleContext()
        module.on_load(ctx)

    def unregister(self, module_id: str) -> None:
        self._modules.pop(module_id, None)

    def get_module(self, module_id: str) -> BaseKarsaModule | None:
        return self._modules.get(module_id)

    def list_modules(self) -> list[ModuleManifest]:
        return [m.manifest for m in self._modules.values()]

    def get_enabled_module_ids(self) -> list[str]:
        """Read list of enabled modules from SQLite system_settings."""
        try:
            with get_db_cursor() as cursor:
                cursor.execute(
                    "SELECT value FROM system_settings WHERE key = 'modules.enabled';"
                )
                row = cursor.fetchone()
                if row and row["value"]:
                    enabled = json.loads(row["value"])
                    if isinstance(enabled, list):
                        return enabled
        except Exception:
            pass
        return list(self._modules.keys())

    def set_module_enabled(self, module_id: str, enabled: bool) -> None:
        """Update enabled modules list in system_settings."""
        current = self.get_enabled_module_ids()
        if enabled and module_id not in current:
            current.append(module_id)
        elif not enabled and module_id in current:
            current.remove(module_id)

        try:
            with get_db_cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO system_settings (key, value, updated_at)
                    VALUES ('modules.enabled', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = excluded.updated_at;
                    """,
                    (json.dumps(current),),
                )
        except Exception:
            pass


# Global module registry singleton
registry = ModuleRegistry()
