from __future__ import annotations

import datetime
import json
import uuid
from contextlib import asynccontextmanager
from typing import Any
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.types import Command
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from backend.core.config import ENV_FILE_PATH, settings
from backend.core.council import build_members, run_council
from backend.core.database import (
    initialize_master_database,
    log_focus_session,
    get_focus_sessions,
    log_hydration,
    get_today_hydration_summary,
    add_shelf_file,
    list_shelf_files,
    remove_shelf_file,
)
from backend.core.hardware_detector import detect_hardware_profile, unload_local_models_for_sleep
from backend.core.llm_router import router
from backend.core.state import ApprovalDecision, HardwareProfile
from backend.core.token_tracker import get_token_usage_summary
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
from backend.core.app_launcher import app_indexer
from backend.modules.base_module import registry
from backend.orchestrator.hitl_gate import get_pending_approvals
from backend.orchestrator.supervisor import build_karsa_supervisor_graph
from backend.screen_context.screen_reader import capture_screen_assist


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    settings.ensure_directories()
    initialize_master_database()
    yield
    # Shutdown


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Desktop Island Companion & Personal Agentic AI for Students",
    lifespan=lifespan,
)

# Cross-Origin Resource Sharing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------------------------------------------------------------------------
# Request / Response Models
# -------------------------------------------------------------------------

class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    thread_id: str | None = None
    workspace_path: str | None = None


class ChatResponse(BaseModel):
    thread_id: str
    active_module: str | None
    response: str


class TierConfigRequest(BaseModel):
    tier: str
    provider: str
    model: str
    temperature: float = 0.2


class ScreenCaptureRequest(BaseModel):
    user_consented: bool = True
    max_dimension: int = 1280
    jpeg_quality: int = 75


class ApiKeysRequest(BaseModel):
    # Only whitelisted provider keys; empty string clears a key.
    gemini_api_key: str | None = None
    deepseek_api_key: str | None = None
    groq_api_key: str | None = None
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None


class CouncilRequest(BaseModel):
    prompt: str = Field(min_length=1)
    mode: str = "auto"  # auto | solo | relay


class DirectiveParseRequest(BaseModel):
    text: str = Field(min_length=1)


class DirectiveScanRequest(BaseModel):
    workspace_path: str = Field(min_length=1)


class FocusSessionLogRequest(BaseModel):
    duration_minutes: int = Field(gt=0)
    session_type: str = "focus"
    task_id: int | None = None


class HydrationLogRequest(BaseModel):
    amount_ml: int = Field(gt=0)
    daily_target_ml: int = 2000


class ShelfFileAddRequest(BaseModel):
    file_path: str
    file_name: str
    file_type: str = "application/octet-stream"


API_KEY_FIELDS = (
    "gemini_api_key",
    "deepseek_api_key",
    "groq_api_key",
    "openai_api_key",
    "anthropic_api_key",
)


def _persist_env_value(name: str, value: str) -> None:
    """Upsert KARSA_<NAME>=value in the project .env (created on first save)."""
    env_key = f"KARSA_{name.upper()}"
    lines = ENV_FILE_PATH.read_text(encoding="utf-8").splitlines() if ENV_FILE_PATH.exists() else []
    new_line = f"{env_key}={value}"
    for i, line in enumerate(lines):
        if line.split("=", 1)[0].strip() == env_key:
            lines[i] = new_line
            break
    else:
        lines.append(new_line)
    ENV_FILE_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _task_hours_left(due_at: str | None) -> float | None:
    if not due_at:
        return None
    try:
        due = datetime.datetime.fromisoformat(due_at.replace("Z", ""))
    except ValueError:
        return None
    return round((due - datetime.datetime.now()).total_seconds() / 3600, 1)


# -------------------------------------------------------------------------
# System & Hardware Endpoints
# -------------------------------------------------------------------------

@app.get("/api/v1/health")
def get_health() -> dict[str, Any]:
    return {
        "status": "ok",
        "app_name": settings.app_name,
        "version": settings.app_version,
    }


@app.get("/api/v1/system/hardware", response_model=HardwareProfile)
def get_hardware_info() -> HardwareProfile:
    return detect_hardware_profile()


@app.post("/api/v1/system/hardware/redetect", response_model=HardwareProfile)
def redetect_hardware() -> HardwareProfile:
    return detect_hardware_profile(force_redetect=True)


@app.post("/api/v1/system/sleep")
def trigger_sleep_mode() -> dict[str, Any]:
    """Zero-Heat Sleep Mode: Unload local models from VRAM to achieve 0.0% CPU/GPU."""
    return unload_local_models_for_sleep()


# -------------------------------------------------------------------------
# Model Tier Settings Endpoints
# -------------------------------------------------------------------------

@app.get("/api/v1/settings/models")
def get_model_settings() -> dict[str, Any]:
    return {
        "tier1_utility": router.get_tier_config("tier1_utility"),
        "tier2_code": router.get_tier_config("tier2_code"),
        "tier3_reasoning": router.get_tier_config("tier3_reasoning"),
    }


@app.put("/api/v1/settings/models")
def update_model_settings(req: TierConfigRequest) -> dict[str, Any]:
    router.set_tier_config(req.tier, req.provider, req.model, req.temperature)
    return {"status": "updated", "config": router.get_tier_config(req.tier)}


@app.get("/api/v1/settings/providers")
def get_provider_status() -> dict[str, Any]:
    """Which API keys are configured (booleans only) and which Ollama models are pulled."""
    ollama: dict[str, Any] = {"online": False, "models": []}
    try:
        res = httpx.get(f"{settings.ollama_base_url}/api/tags", timeout=0.8)
        ollama = {
            "online": res.status_code == 200,
            "models": [m.get("name") for m in res.json().get("models", [])],
        }
    except Exception:
        pass

    members = build_members()
    return {
        "keys": {f: bool(getattr(settings, f, None)) for f in API_KEY_FIELDS},
        "ollama": ollama,
        "council": {
            k: {"name": m.display_name, "provider": m.provider, "model": m.model}
            for k, m in members.items()
        },
    }


@app.put("/api/v1/settings/api-keys")
def save_api_keys(req: ApiKeysRequest) -> dict[str, Any]:
    """Save provider keys to .env and apply them immediately (no restart needed)."""
    saved: list[str] = []
    for field in API_KEY_FIELDS:
        value = getattr(req, field)
        if value is None:
            continue
        value = value.strip()
        if any(c in value for c in ("\n", "\r")):
            raise HTTPException(status_code=400, detail=f"Format {field} tidak valid.")
        _persist_env_value(field, value)
        setattr(settings, field, value or None)
        saved.append(field)
    return {"status": "saved", "saved": saved}


@app.post("/api/v1/council/run")
def council_endpoint(req: CouncilRequest) -> dict[str, Any]:
    """Hermes drafts -> DeepSeek critiques -> Gemini writes the final answer."""
    if req.mode not in ("auto", "solo", "relay"):
        raise HTTPException(status_code=400, detail="mode harus auto, solo, atau relay")
    return run_council(req.prompt, mode=req.mode)  # type: ignore[arg-type]


# -------------------------------------------------------------------------
# Directive Engine & Inline Comment Scanner
# -------------------------------------------------------------------------

@app.post("/api/v1/directives/parse")
def parse_directive_endpoint(req: DirectiveParseRequest) -> dict[str, Any]:
    """Parse @Directive command string and execute deterministic actions if applicable."""
    from backend.orchestrator.directive_parser import parse_directive
    d = parse_directive(req.text)
    return {
        "is_directive": d.is_directive,
        "command": d.command,
        "argument": d.argument,
        "target_module": d.target_module,
        "action": d.action,
        "details": d.details,
        "execution_result": d.execution_result,
    }


@app.post("/api/v1/directives/scan")
def scan_directives_endpoint(req: DirectiveScanRequest) -> dict[str, Any]:
    """Scan workspace files for inline comments with @Directives."""
    from backend.orchestrator.directive_parser import scan_workspace_comments
    findings = scan_workspace_comments(req.workspace_path)
    return {
        "workspace_path": req.workspace_path,
        "count": len(findings),
        "findings": findings,
    }


@app.get("/api/v1/finance/report")
def get_finance_report() -> dict[str, Any]:
    """100% real SQLite data for the @Money laporan popover drawer."""
    from backend.core.database import get_db_cursor
    from backend.modules.finance.tools import get_budget_snapshot

    snapshot = get_budget_snapshot()
    with get_db_cursor() as cursor:
        cursor.execute(
            """
            SELECT id, period, txn_date, amount_idr, category, merchant, description, source, receipt_ref
            FROM financial_transactions
            ORDER BY txn_date DESC, id DESC
            LIMIT 30;
            """
        )
        transactions = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT category, SUM(amount_idr) as total_spent, COUNT(*) as count
            FROM financial_transactions
            WHERE period = ?
            GROUP BY category;
            """,
            (snapshot["period"],),
        )
        category_spending = [dict(row) for row in cursor.fetchall()]

    return {
        "snapshot": snapshot,
        "transactions": transactions,
        "category_spending": category_spending,
    }


# -------------------------------------------------------------------------
# Modules Plug-and-Play Manager Endpoints
# -------------------------------------------------------------------------

@app.get("/api/v1/modules")
def list_system_modules() -> dict[str, Any]:
    """List all plug-and-play specialist modules with enabled status and @ shortcuts."""
    from backend.modules.base_module import registry

    manifests = registry.list_modules()
    enabled_ids = set(registry.get_enabled_module_ids())

    # Map module_id to supported @ shortcuts
    shortcut_map = {
        "finance": ["@Money"],
        "study_daily": ["@Todo", "@Study", "@Course"],
        "research": ["@Search"],
        "writer": ["@Write"],
        "datascience_code": ["@Data", "@Code"],
        "screen_reader": ["@Screen"],
    }

    modules_data = []
    for m in manifests:
        modules_data.append({
            "id": m.module_id,
            "name": m.display_name,
            "version": m.version,
            "description": m.description,
            "model_tier": m.model_tier,
            "shortcuts": shortcut_map.get(m.module_id, [f"@{m.module_id.capitalize()}"]),
            "enabled": m.module_id in enabled_ids,
        })

    return {"modules": modules_data}


@app.post("/api/v1/modules/{module_id}/toggle")
def toggle_system_module(module_id: str) -> dict[str, Any]:
    from backend.modules.base_module import registry

    current = registry.get_enabled_module_ids()
    is_now_enabled = module_id not in current
    registry.set_module_enabled(module_id, is_now_enabled)
    return {"module_id": module_id, "enabled": is_now_enabled}


# -------------------------------------------------------------------------
# Real Token & Cost Analytics Endpoint
# -------------------------------------------------------------------------

@app.get("/api/v1/system/tokens/analytics")
def get_token_analytics() -> dict[str, Any]:
    """Aggregate token usage and IDR cost from SQLite token_logs."""
    from backend.core.database import get_db_cursor

    with get_db_cursor() as cursor:
        cursor.execute(
            """
            SELECT 
                COALESCE(SUM(tokens_in), 0) as total_tokens_in,
                COALESCE(SUM(tokens_out), 0) as total_tokens_out,
                COALESCE(SUM(estimated_cost_idr), 0) as total_cost_idr,
                COUNT(*) as total_calls
            FROM token_logs;
            """
        )
        totals = dict(cursor.fetchone() or {})

        cursor.execute(
            """
            SELECT model_used, SUM(tokens_in + tokens_out) as tokens, SUM(estimated_cost_idr) as cost_idr, COUNT(*) as calls
            FROM token_logs
            GROUP BY model_used
            ORDER BY tokens DESC;
            """
        )
        by_model = [dict(r) for r in cursor.fetchall()]

        cursor.execute(
            """
            SELECT id, timestamp, session_thread_id, module, model_used, tokens_in, tokens_out, latency_ms, estimated_cost_idr
            FROM token_logs
            ORDER BY timestamp DESC
            LIMIT 15;
            """
        )
        recent_logs = [dict(r) for r in cursor.fetchall()]

    return {
        "totals": totals,
        "by_model": by_model,
        "recent_logs": recent_logs,
    }


# -------------------------------------------------------------------------
# Live Dashboard (real data for the Notch header)
# -------------------------------------------------------------------------

@app.get("/api/v1/dashboard/summary")
def dashboard_summary() -> dict[str, Any]:
    from backend.modules.finance.tools import get_budget_snapshot
    from backend.modules.study_daily.tools import list_tasks_from_db

    budget = get_budget_snapshot()
    tasks = list_tasks_from_db(status="todo")

    enriched = []
    for t in tasks:
        hours = _task_hours_left(t.get("due_at"))
        enriched.append({
            "id": t["id"],
            "title": t["title"],
            "due_at": t.get("due_at"),
            "hours_left": hours,
            "quadrant": t.get("quadrant"),
            "is_urgent": bool(t.get("is_urgent")) or (hours is not None and hours <= 48),
        })

    # Closest deadlines first; tasks without deadline last.
    enriched.sort(key=lambda t: (t["hours_left"] is None, t["hours_left"] if t["hours_left"] is not None else 0))
    return {
        "finance": {
            "period": budget["period"],
            "daily_safe_spend_idr": budget["daily_safe_spend_idr"],
            "total_remaining_idr": budget["total_remaining_idr"],
            "total_spent_idr": budget["total_spent_idr"],
            "total_capital_idr": budget["total_capital_idr"],
            "remaining_days": budget["remaining_days"],
        },
        "tasks": {
            "todo_count": len(enriched),
            "urgent_count": sum(1 for t in enriched if t["is_urgent"]),
            "upcoming": enriched[:3],
        },
    }


# -------------------------------------------------------------------------
# Tasks Management Endpoints (100% Real SQLite Tasks)
# -------------------------------------------------------------------------

@app.get("/api/v1/tasks")
def get_tasks_endpoint(status: str = "todo", quadrant: str | None = None) -> dict[str, Any]:
    from backend.modules.study_daily.tools import list_tasks_from_db
    tasks = list_tasks_from_db(status=status, quadrant=quadrant)
    return {"tasks": tasks}


@app.post("/api/v1/tasks/{task_id}/complete")
def complete_task_endpoint(task_id: int) -> dict[str, Any]:
    from backend.modules.study_daily.tools import complete_task_in_db
    res = complete_task_in_db(task_id)
    return {"status": "completed", "task": res}


# -------------------------------------------------------------------------
# Chat & Execution Endpoints
# -------------------------------------------------------------------------

@app.post("/api/v1/chat", response_model=ChatResponse)
def chat_endpoint(req: ChatRequest) -> ChatResponse:
    thread_id = req.thread_id or f"thread_{uuid.uuid4().hex[:12]}"
    graph = build_karsa_supervisor_graph()

    initial_state = {
        "messages": [HumanMessage(content=req.message)],
        "session_thread_id": thread_id,
        "active_workspace_path": req.workspace_path,
        "hardware_mode": detect_hardware_profile().mode,
        "power_state": "active",
    }

    config = {"configurable": {"thread_id": thread_id}}
    result_state = graph.invoke(initial_state, config=config)

    # Extract final message content
    messages = result_state.get("messages", [])
    response_text = "Tugas selesai dieksekusi."
    if messages:
        last_msg = messages[-1]
        response_text = str(getattr(last_msg, "content", response_text))

    return ChatResponse(
        thread_id=thread_id,
        active_module=result_state.get("active_module"),
        response=response_text,
    )


@app.post("/api/v1/chat/stream")
def chat_stream_endpoint(req: ChatRequest) -> EventSourceResponse:
    thread_id = req.thread_id or f"thread_{uuid.uuid4().hex[:12]}"

    def event_generator():
        graph = build_karsa_supervisor_graph()
        initial_state = {
            "messages": [HumanMessage(content=req.message)],
            "session_thread_id": thread_id,
            "active_workspace_path": req.workspace_path,
            "hardware_mode": detect_hardware_profile().mode,
            "power_state": "active",
        }
        config = {"configurable": {"thread_id": thread_id}}

        yield {
            "event": "start",
            "data": json.dumps({"thread_id": thread_id}),
        }

        try:
            # Stream events from graph
            for event in graph.stream(initial_state, config=config, stream_mode="updates"):
                for node_name, state_update in event.items():
                    if node_name == "supervisor_triage":
                        yield {
                            "event": "route",
                            "data": json.dumps({
                                "active_module": state_update.get("active_module"),
                            }),
                        }
                    elif node_name == "subagent_dispatch":
                        msgs = state_update.get("messages", [])
                        if msgs:
                            yield {
                                "event": "token",
                                "data": json.dumps({"text": str(msgs[-1].content)}),
                            }
        except Exception as e:
            # Check if this exception is a LangGraph interrupt
            if "interrupt" in type(e).__name__.lower() or hasattr(e, "interrupts"):
                yield {
                    "event": "approval_required",
                    "data": json.dumps({"thread_id": thread_id}),
                }
                return
            yield {
                "event": "error",
                "data": json.dumps({"error": str(e)}),
            }
            return

        yield {
            "event": "done",
            "data": json.dumps({"thread_id": thread_id}),
        }

    return EventSourceResponse(event_generator())


# -------------------------------------------------------------------------
# Human-in-the-Loop (HITL) Governance Endpoints
# -------------------------------------------------------------------------

@app.get("/api/v1/approvals/pending")
def list_pending_approvals(thread_id: str | None = None) -> dict[str, Any]:
    approvals = get_pending_approvals(thread_id)
    return {"pending_approvals": approvals}


@app.post("/api/v1/threads/{thread_id}/resume")
def resume_thread_endpoint(thread_id: str, decision: ApprovalDecision) -> dict[str, Any]:
    """Resume an interrupted LangGraph execution with human ApprovalDecision."""
    graph = build_karsa_supervisor_graph()
    config = {"configurable": {"thread_id": thread_id}}

    try:
        resume_cmd = Command(resume=decision.model_dump())
        result_state = graph.invoke(resume_cmd, config=config)
        
        messages = result_state.get("messages", [])
        response_text = ""
        if messages:
            response_text = str(getattr(messages[-1], "content", ""))

        return {
            "status": "resumed",
            "thread_id": thread_id,
            "response": response_text,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to resume thread: {str(e)}")


# -------------------------------------------------------------------------
# Observability & ScreenAssist Endpoints
# -------------------------------------------------------------------------

@app.get("/api/v1/tokens/usage")
def get_tokens_usage() -> dict[str, Any]:
    return get_token_usage_summary()


@app.post("/api/v1/screen/capture")
def capture_screen_endpoint(req: ScreenCaptureRequest) -> dict[str, Any]:
    result = capture_screen_assist(
        user_consented=req.user_consented,
        max_dimension=req.max_dimension,
        jpeg_quality=req.jpeg_quality,
    )
    if isinstance(result, dict):
        return {"status": "success", "context": result}
    return {"status": "error", "error": result.model_dump()}


# -------------------------------------------------------------------------
# Dynamic Island V3 Endpoints (Pomodoro, Hydration, Shelf, Apps, State)
# -------------------------------------------------------------------------

@app.get("/api/v1/threads/{thread_id}/state")
def get_thread_state_endpoint(thread_id: str) -> dict[str, Any]:
    """Inspect current LangGraph checkpoint state for a session thread."""
    graph = build_karsa_supervisor_graph()
    config = {"configurable": {"thread_id": thread_id}}
    state_snapshot = graph.get_state(config)
    
    msgs = []
    if state_snapshot.values and "messages" in state_snapshot.values:
        for m in state_snapshot.values["messages"]:
            msgs.append({
                "type": getattr(m, "type", "unknown"),
                "content": getattr(m, "content", str(m)),
            })

    return {
        "thread_id": thread_id,
        "next": list(state_snapshot.next) if state_snapshot.next else [],
        "active_module": state_snapshot.values.get("active_module") if state_snapshot.values else None,
        "message_count": len(msgs),
        "messages": msgs[-10:],
    }


@app.get("/api/v1/focus/sessions")
def list_focus_sessions_endpoint(limit: int = 20) -> dict[str, Any]:
    sessions = get_focus_sessions(limit=limit)
    return {"sessions": sessions}


@app.post("/api/v1/focus/sessions/log")
def log_focus_session_endpoint(req: FocusSessionLogRequest) -> dict[str, Any]:
    res = log_focus_session(
        duration_minutes=req.duration_minutes,
        session_type=req.session_type,
        task_id=req.task_id,
    )
    return {"status": "logged", "session": res}


@app.get("/api/v1/hydration/today")
def get_hydration_today_endpoint(daily_target_ml: int = 2000) -> dict[str, Any]:
    summary = get_today_hydration_summary(daily_target_ml=daily_target_ml)
    return summary


@app.post("/api/v1/hydration/log")
def log_hydration_endpoint(req: HydrationLogRequest) -> dict[str, Any]:
    log_hydration(amount_ml=req.amount_ml, daily_target_ml=req.daily_target_ml)
    summary = get_today_hydration_summary(daily_target_ml=req.daily_target_ml)
    return {"status": "logged", "summary": summary}


@app.get("/api/v1/shelf/files")
def list_shelf_files_endpoint(limit: int = 30) -> dict[str, Any]:
    files = list_shelf_files(limit=limit)
    return {"files": files}


@app.post("/api/v1/shelf/files")
def add_shelf_file_endpoint(req: ShelfFileAddRequest) -> dict[str, Any]:
    res = add_shelf_file(
        file_path=req.file_path,
        file_name=req.file_name,
        file_type=req.file_type,
    )
    return {"status": "added", "file": res}


@app.delete("/api/v1/shelf/files/{shelf_id}")
def delete_shelf_file_endpoint(shelf_id: int) -> dict[str, Any]:
    deleted = remove_shelf_file(shelf_id)
    return {"status": "deleted" if deleted else "not_found", "id": shelf_id}


# ---------------------------------------------------------------------------
# Native Windows Hardware Hooks & System Telemetry Endpoints
# ---------------------------------------------------------------------------

class VolumeSetRequest(BaseModel):
    level: int | None = Field(default=None, ge=0, le=100)
    muted: bool | None = None


class BrightnessSetRequest(BaseModel):
    level: int = Field(ge=0, le=100)


class LaunchAppRequest(BaseModel):
    path: str


@app.get("/api/v1/system/screen")
def get_system_screen_endpoint() -> dict[str, Any]:
    """Return primary monitor resolution, DPI, and scale factor."""
    return get_screen_info()


@app.get("/api/v1/system/volume")
def get_system_volume_endpoint() -> dict[str, Any]:
    """Read Windows master volume and mute state via pycaw / CoreAudio."""
    return get_master_volume()


@app.post("/api/v1/system/volume")
def set_system_volume_endpoint(req: VolumeSetRequest) -> dict[str, Any]:
    """Set Windows master volume level and/or mute state."""
    res = {}
    if req.level is not None:
        res["volume"] = set_master_volume(req.level)
    if req.muted is not None:
        res["mute"] = set_master_mute(req.muted)
    return {"status": "ok", "result": res}


@app.get("/api/v1/system/brightness")
def get_system_brightness_endpoint() -> dict[str, Any]:
    """Read laptop screen brightness (0-100)."""
    return get_screen_brightness()


@app.post("/api/v1/system/brightness")
def set_system_brightness_endpoint(req: BrightnessSetRequest) -> dict[str, Any]:
    """Set laptop screen brightness (0-100)."""
    return set_screen_brightness(req.level)


@app.get("/api/v1/system/lock-keys")
def get_system_lock_keys_endpoint() -> dict[str, Any]:
    """Read real-time CapsLock and NumLock states from Windows user32."""
    return get_lock_keys()


@app.get("/api/v1/system/battery")
def get_system_battery_endpoint() -> dict[str, Any]:
    """Read real laptop battery percent and charging state."""
    return get_battery_status()


@app.get("/api/v1/system/bluetooth")
def get_system_bluetooth_endpoint() -> dict[str, Any]:
    """List connected / active Bluetooth devices."""
    devices = get_bluetooth_devices()
    return {"count": len(devices), "devices": devices}


@app.get("/api/v1/system/media-session")
def get_system_media_session_endpoint() -> dict[str, Any]:
    """Read current Windows media session (GSMTC)."""
    return get_media_session()


@app.get("/api/v1/system/osd/stream")
async def system_osd_event_stream(request: Request) -> EventSourceResponse:
    """Stream real-time hardware events to the Dynamic Island UI."""
    import asyncio

    async def event_generator():
        last_locks = get_lock_keys()
        last_battery = get_battery_status()
        last_vol = get_master_volume().get("level")
        last_mute = get_master_volume().get("muted")

        while True:
            if await request.is_disconnected():
                break

            await asyncio.sleep(0.35)

            # 1. Check Lock Keys
            curr_locks = get_lock_keys()
            if curr_locks["caps_lock"] != last_locks["caps_lock"]:
                last_locks["caps_lock"] = curr_locks["caps_lock"]
                yield {
                    "event": "osd://lock-key",
                    "data": json.dumps({
                        "key": "CAPS LOCK",
                        "active": curr_locks["caps_lock"],
                    }),
                }
            if curr_locks["num_lock"] != last_locks["num_lock"]:
                last_locks["num_lock"] = curr_locks["num_lock"]
                yield {
                    "event": "osd://lock-key",
                    "data": json.dumps({
                        "key": "NUM LOCK",
                        "active": curr_locks["num_lock"],
                    }),
                }

            # 2. Check Battery & Charger Hook
            curr_battery = get_battery_status()
            if (
                curr_battery.get("charging") != last_battery.get("charging")
                or abs(curr_battery.get("percent", 0) - last_battery.get("percent", 0)) >= 5
            ):
                last_battery = curr_battery
                yield {
                    "event": "osd://power",
                    "data": json.dumps({
                        "charging": curr_battery.get("charging"),
                        "percent": curr_battery.get("percent"),
                    }),
                }

            # 3. Check Volume
            vol_info = get_master_volume()
            curr_vol = vol_info.get("level")
            curr_mute = vol_info.get("muted")
            if curr_vol != last_vol or curr_mute != last_mute:
                last_vol = curr_vol
                last_mute = curr_mute
                yield {
                    "event": "osd://volume",
                    "data": json.dumps({
                        "level": curr_vol,
                        "muted": curr_mute,
                    }),
                }

    return EventSourceResponse(event_generator())


@app.get("/api/v1/system/apps")
def search_system_apps_endpoint(q: str = "") -> dict[str, Any]:
    """Search installed Windows applications with <10ms in-memory fuzzy index."""
    results = app_indexer.search(q, limit=20)
    return {"count": len(results), "apps": results}


@app.post("/api/v1/system/apps/launch")
def launch_system_app_endpoint(req: LaunchAppRequest) -> dict[str, Any]:
    """Launch an application path on Windows."""
    return app_indexer.launch(req.path)
