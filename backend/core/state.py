from __future__ import annotations

import operator
from typing import Annotated, Any, Literal
from typing_extensions import TypedDict
from pydantic import BaseModel, ConfigDict, Field
from langchain_core.messages import AnyMessage

HardwareMode = Literal["turbo_gpu", "eco_cpu"]
PowerState = Literal["active", "sleep"]


class TokenUsage(TypedDict):
    tokens_in: int
    tokens_out: int
    estimated_cost_idr: float


class ActiveWindowContext(TypedDict):
    window_title: str
    process_name: str
    screenshot_ref: str | None
    ocr_text_preview: str | None
    captured_at: str


class KarsaState(TypedDict, total=False):
    # Conversation history
    messages: Annotated[list[AnyMessage], operator.add]

    # Routing & Environment state
    active_module: str | None
    hardware_mode: HardwareMode
    power_state: PowerState
    session_thread_id: str

    # Screen Reader & Active Window Context (ScreenAssist)
    active_window_context: ActiveWindowContext | None

    # External Reference Pattern (Only Absolute Paths, Never Large Blobs)
    active_workspace_path: str | None
    current_document_ref: str | None
    current_dataset_ref: str | None

    # Governance & HITL
    pending_approval: dict[str, Any] | None

    # Tokenomics & Session Stats
    session_token_usage: TokenUsage


# -------------------------------------------------------------------------
# Core Pydantic Contracts (Poka-Yoke: Extra Fields Strictly Forbidden)
# -------------------------------------------------------------------------

class BaseContract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RouteDecision(BaseContract):
    module: str
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str = Field(max_length=120)


class ProposedAction(BaseContract):
    action_id: str
    module: str
    action_name: str
    args: dict[str, Any]
    preview: str | None = None
    target_path: str | None = None


class ApprovalRequest(BaseContract):
    action_id: str
    module: str
    action_name: str
    risk_level: Literal["high", "critical"]
    summary: str
    preview: str | None = None
    proposed_args: dict[str, Any]
    created_at: str


class ApprovalDecision(BaseContract):
    action_id: str
    decision: Literal["approve", "edit", "reject"]
    edited_args: dict[str, Any] | None = None
    reason: str | None = None


class ModuleResult(BaseContract):
    module: str
    status: Literal["ok", "error", "rejected"]
    summary: str
    artifacts: list[str] = Field(default_factory=list)
    usage: TokenUsage | None = None


class HardwareProfile(BaseContract):
    mode: HardwareMode
    os_name: str
    cpu_name: str
    ram_total_gb: float
    ram_available_gb: float
    gpu_name: str | None = None
    vram_gb: float | None = None
    apple_silicon: bool = False
    ollama_available: bool = False
    reason: str


class ModelProfile(BaseContract):
    tier: str
    provider: str
    model: str
    temperature: float = 0.2
    max_tokens: int | None = None
    fallbacks: list[dict[str, str]] = Field(default_factory=list)


class ToolError(BaseContract):
    ok: Literal[False] = False
    error_code: str
    message: str
    hint: str
    received: dict[str, Any] | None = None
