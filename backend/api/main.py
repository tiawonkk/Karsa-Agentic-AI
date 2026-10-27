from __future__ import annotations

import asyncio
import datetime
import json
import re
import uuid
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Any, Literal
import httpx
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.types import Command
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from backend.core import shelf
from backend.core.config import ENV_FILE_PATH, settings
from backend.core.council import build_members, run_council
from backend.core.database import (
    initialize_master_database,
    log_focus_session,
    get_focus_sessions,
    log_hydration,
    get_today_hydration_summary,
    get_hydration_settings,
    update_hydration_settings,
    add_shelf_file,
    list_shelf_files,
    remove_shelf_file,
    save_wardrobe_item,
    list_wardrobe_items,
    delete_wardrobe_item,
    get_db_cursor,
)
from backend.modules.study_daily.tools import (
    list_tasks_from_db,
    add_task_in_db,
    complete_task_in_db,
)
from backend.modules.finance.tools import (
    VALID_CATEGORIES,
    get_budget_snapshot,
    get_current_period,
    record_transaction_in_db,
)
from backend.modules.finance.receipt_ocr import ReceiptOCRError, scan_receipt
from backend.modules.notebook import service as notebook_service
from backend.modules.notebook import store as notebook_store
from backend.modules.notebook import dataset_cleaner
from backend.modules.notebook.store import NotebookError
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
    control_media,
    get_pressed_keys,
    is_alt_down,
    newly_pressed,
    describe_key,
)
from backend.core.app_launcher import app_indexer
from backend.modules.base_module import registry
from backend.orchestrator import hitl_gate
from backend.orchestrator.hitl_gate import get_pending_approvals
from backend.orchestrator.supervisor import build_karsa_supervisor_graph
from backend.screen_context.screen_reader import capture_screen_assist


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    settings.ensure_directories()
    initialize_master_database()
    from backend.core.database import get_system_setting
    saved_gemini = get_system_setting("api_key.gemini")
    if saved_gemini and not settings.gemini_api_key:
        settings.gemini_api_key = str(saved_gemini).strip()
    saved_deepseek = get_system_setting("api_key.deepseek")
    if saved_deepseek and not settings.deepseek_api_key:
        settings.deepseek_api_key = str(saved_deepseek).strip()
    yield
    # Shutdown


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Desktop Island Companion & Personal Agentic AI for Students",
    lifespan=lifespan,
)

from backend.api.automation import router as automation_router  # noqa: E402

app.include_router(automation_router)

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
    mode: Literal["chat", "code", "research"] = "chat"


class ChatResponse(BaseModel):
    thread_id: str
    active_module: str | None
    response: str
    text: str | None = None



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
    amount_ml: int = Field(gt=0, le=3000)
    daily_target_ml: int | None = Field(default=None, gt=0)


class ThemeRequest(BaseModel):
    mode: Literal["light", "dark", "system"]


class HydrationSettingsRequest(BaseModel):
    daily_target_ml: int | None = Field(default=None, ge=500, le=10000)
    glass_ml: int | None = Field(default=None, ge=50, le=2000)
    interval_minutes: int | None = Field(default=None, ge=5, le=720)
    reminder_enabled: bool | None = None


class ShelfFileAddRequest(BaseModel):
    file_path: str
    file_name: str
    file_type: str = "application/octet-stream"


class WardrobeItemRequest(BaseModel):
    id: str
    name: str
    data_url: str
    anchor_type: str = "head_top"
    is_active: int = 1


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
    router.invalidate_health()
    return {"status": "saved", "saved": saved}


class SaveKeyRequest(BaseModel):
    provider: str = "gemini"
    api_key: str | None = None
    gemini_api_key: str | None = None
    deepseek_api_key: str | None = None
    anthropic_api_key: str | None = None


@app.get("/api/settings/keys")
@app.get("/api/v1/settings/keys")
def get_api_keys_endpoint() -> dict[str, Any]:
    """Fetch real persisted keys from SQLite system_settings and live status."""
    from backend.core.database import get_system_setting
    health = router.check_models_health()
    gemini_key = settings.gemini_api_key or get_system_setting("api_key.gemini") or ""
    deepseek_key = settings.deepseek_api_key or get_system_setting("api_key.deepseek") or ""
    anthropic_key = settings.anthropic_api_key or get_system_setting("api_key.anthropic") or ""
    return {
        "gemini_api_key": str(gemini_key),
        "deepseek_api_key": str(deepseek_key),
        "anthropic_api_key": str(anthropic_key),
        "is_connected": health.get("is_connected", False),
        "connected_model": health.get("connected_model", "None"),
        "badge": health.get("badge", "🔴 API Disconnected"),
        "badge_simple": health.get("badge_simple", "🔴 API Disconnected"),
        "gemini": health.get("gemini", {}),
        "deepseek": health.get("deepseek", {}),
        "ollama": health.get("ollama", {}),
    }


@app.post("/api/settings/keys")
@app.post("/api/v1/settings/keys")
def save_and_connect_key_endpoint(req: SaveKeyRequest) -> dict[str, Any]:
    """Persist API key to SQLite system_settings, .env, and perform a live test call."""
    router.invalidate_health()
    from backend.core.database import set_system_setting
    target_key = (req.api_key or req.gemini_api_key or "").strip()

    if req.provider == "gemini" or req.gemini_api_key is not None or (req.api_key and "AIza" in req.api_key):
        if not target_key:
            # Clear key
            set_system_setting("api_key.gemini", "")
            settings.gemini_api_key = None
            try:
                _persist_env_value("gemini_api_key", "")
            except Exception:
                pass
            return {"status": "disconnected", "message": "API Key Gemini dihapus."}

        # 1. Live test Gemini API
        ok, tested_model, msg = router.verify_gemini_key(target_key)
        if not ok:
            return {"status": "error", "message": msg}

        # 2. Persist to SQLite system_settings
        set_system_setting("api_key.gemini", target_key)
        # 3. Update memory settings & .env
        settings.gemini_api_key = target_key
        try:
            _persist_env_value("gemini_api_key", target_key)
        except Exception:
            pass

        return {
            "status": "connected",
            "model": tested_model,
            "message": f"Koneksi sukses! Aktif menggunakan Google {tested_model}.",
        }

    elif req.provider == "deepseek" or req.deepseek_api_key is not None:
        d_key = (req.api_key or req.deepseek_api_key or "").strip()
        set_system_setting("api_key.deepseek", d_key)
        settings.deepseek_api_key = d_key or None
        try:
            _persist_env_value("deepseek_api_key", d_key)
        except Exception:
            pass
        return {"status": "connected", "model": "DeepSeek Flash", "message": "Kunci DeepSeek disimpan ke SQLite!"}

    elif req.provider == "anthropic" or req.anthropic_api_key is not None:
        a_key = (req.api_key or req.anthropic_api_key or "").strip()
        set_system_setting("api_key.anthropic", a_key)
        settings.anthropic_api_key = a_key or None
        try:
            _persist_env_value("anthropic_api_key", a_key)
        except Exception:
            pass
        return {"status": "connected", "model": "Claude 3.5 Sonnet", "message": "Kunci Anthropic disimpan ke SQLite!"}

    return {"status": "saved", "message": "Pengaturan kunci disimpan."}


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


_OCR_STATUS = {"no_api_key": 503, "provider_error": 502, "too_large": 413, "invalid_image": 400}


class ReceiptConfirmRequest(BaseModel):
    total_idr: int = Field(gt=0)
    category: str
    merchant: str | None = None
    description: str = "Struk belanja"


@app.post("/api/v1/finance/receipt/scan")
async def scan_receipt_endpoint(file: UploadFile = File(...)) -> dict[str, Any]:
    """Read a receipt photo with Gemini Vision and return an editable preview (nothing is recorded yet)."""
    data = await file.read()
    try:
        receipt = await asyncio.to_thread(scan_receipt, data)
    except ReceiptOCRError as e:
        raise HTTPException(status_code=_OCR_STATUS.get(e.code, 422), detail=str(e))
    return {"status": "preview", "receipt": receipt}


@app.post("/api/v1/finance/receipt/confirm")
def confirm_receipt_endpoint(req: ReceiptConfirmRequest) -> dict[str, Any]:
    """Record a user-confirmed (possibly edited) receipt preview as an OCR-sourced transaction."""
    if req.category not in VALID_CATEGORIES:
        raise HTTPException(status_code=422, detail=f"Kategori harus salah satu dari {list(VALID_CATEGORIES)}.")
    txn = record_transaction_in_db(
        amount_idr=req.total_idr,
        category=req.category,  # type: ignore[arg-type]
        description=req.description,
        merchant=req.merchant,
        source="ocr",
        used_llm=1,
    )
    return {"status": "recorded", "transaction": txn, "budget": get_budget_snapshot()}


@app.get("/api/v1/finance/report")
def get_finance_report(period: str | None = None) -> dict[str, Any]:
    """100% real SQLite data for the @Money laporan popover drawer."""
    from backend.core.database import get_db_cursor
    from backend.modules.finance.tools import get_budget_snapshot

    if period is not None and not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", period):
        raise HTTPException(status_code=422, detail="Periode harus berformat YYYY-MM.")
    snapshot = get_budget_snapshot(period=period)
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


NUDGE_SNOOZE_KEY = "nudges.snoozed"


def _snoozed_nudges() -> dict[str, str]:
    from backend.core.database import get_system_setting

    raw = get_system_setting(NUDGE_SNOOZE_KEY, None)
    return {k: v for k, v in raw.items() if isinstance(v, str)} if isinstance(raw, dict) else {}


@app.get("/api/v1/today")
def today_brief() -> dict[str, Any]:
    """One calm 'Hari Ini' screen: focus tasks, safe spend, water, and at most 3 rule-based nudges."""
    from backend.core.today import build_today
    from backend.modules.finance.tools import get_budget_snapshot
    from backend.modules.study_daily.tools import list_tasks_from_db

    tasks = [dict(t, hours_left=_task_hours_left(t.get("due_at"))) for t in list_tasks_from_db(status="todo")]
    return build_today(datetime.datetime.now(), tasks, get_budget_snapshot(), _hydration_summary(), _snoozed_nudges())


class SnoozeRequest(BaseModel):
    hours: int = Field(default=24, ge=1, le=168)


@app.post("/api/v1/today/nudges/{nudge_id}/snooze")
def snooze_nudge(nudge_id: str, req: SnoozeRequest) -> dict[str, Any]:
    """'Diam dulu': hide one nudge for N hours (default 24)."""
    import re as _re

    from backend.core.database import set_system_setting

    if not _re.fullmatch(r"[a-z_]{1,32}", nudge_id):
        raise HTTPException(status_code=422, detail="Nama saran tidak valid.")
    now = datetime.datetime.now()
    current = {k: v for k, v in _snoozed_nudges().items() if v > now.isoformat()}  # drop expired entries
    current[nudge_id] = (now + datetime.timedelta(hours=req.hours)).isoformat()
    set_system_setting(NUDGE_SNOOZE_KEY, current)
    return {"snoozed": nudge_id, "until": current[nudge_id]}


# -------------------------------------------------------------------------
# Tasks Management Endpoints (100% Real SQLite Tasks)
# -------------------------------------------------------------------------

@app.get("/api/v1/tasks")
def get_tasks_endpoint(
    status: str = "todo",
    quadrant: str | None = None,
    limit: int = 50,
    recent_done_hours: int = 0,
) -> dict[str, Any]:
    """Tasks for the UI. `recent_done_hours=24` also returns tasks finished in the last 24 h (kept visible, checked)."""
    from backend.modules.study_daily.tools import list_tasks_from_db
    tasks = list_tasks_from_db(status=status, quadrant=quadrant, recent_done_hours=max(0, min(recent_done_hours, 24 * 30)))
    return {"count": len(tasks), "tasks": tasks[: max(1, min(limit, 1000))]}


@app.post("/api/v1/tasks/{task_id}/complete")
def complete_task_endpoint(task_id: int) -> dict[str, Any]:
    from backend.modules.study_daily.tools import complete_task_in_db
    try:
        res = complete_task_in_db(task_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"status": "completed", "task": res}


@app.post("/api/v1/tasks/{task_id}/reopen")
def reopen_task_endpoint(task_id: int) -> dict[str, Any]:
    """Undo a completion (uncheck)."""
    from backend.modules.study_daily.tools import reopen_task_in_db
    try:
        return {"status": "reopened", "task": reopen_task_in_db(task_id)}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


class TaskRecurrenceRequest(BaseModel):
    recurrence: Literal["none", "daily", "weekdays", "weekly"] = "none"


@app.put("/api/v1/tasks/{task_id}/recurrence")
def set_task_recurrence_endpoint(task_id: int, req: TaskRecurrenceRequest) -> dict[str, Any]:
    """Make a task a routine (daily / weekdays / weekly) or a one-off again."""
    from backend.modules.study_daily.tools import set_task_recurrence
    try:
        return {"status": "updated", "task": set_task_recurrence(task_id, req.recurrence)}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/v1/tasks/dedupe")
def dedupe_tasks_endpoint() -> dict[str, Any]:
    """Drop exact duplicate pending tasks (oldest kept; dropped, not deleted)."""
    from backend.modules.study_daily.tools import dedupe_pending_tasks
    return {"status": "ok", "dropped": dedupe_pending_tasks()}


# -------------------------------------------------------------------------
# Chat & Execution Endpoints
# -------------------------------------------------------------------------

@app.get("/api/health/models")
@app.get("/api/v1/health/models")
def models_health_endpoint(force: bool = False) -> dict[str, Any]:
    """Live 1-token ping to every provider that has a key (cached 30 s; `force=true` re-tests): what really works now.

    `ok` / `badge` / `providers` are the live result; `status` stays "healthy" while the database works and at least one
    key is configured (older callers read it)."""
    live = router.live_health(force=force)
    try:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT 1;")
        db_ok = True
    except Exception:
        db_ok = False
    configured = any(p["has_key"] for p in live["providers"])
    active = next((p for p in live["providers"] if p["id"] == live["active"]), None)
    return {
        **live,
        "status": "healthy" if db_ok and configured else "degraded",
        "is_connected": live["ok"],
        "connected_model": active["label"] if active else "None",
        "badge_simple": live["badge"],
        "database": {"connected": db_ok, "name": "karsa_master.db"},
    }


@app.get("/api/models/route")
@app.get("/api/v1/models/route")
def models_route_endpoint(task: str = "general") -> dict[str, Any]:
    """Test dynamic specialization model auto-routing (Instruction 4)."""
    return router.route_model_for_specialization(task)


@app.post("/api/chat", response_model=ChatResponse)
@app.post("/api/v1/chat", response_model=ChatResponse)
def chat_endpoint(req: ChatRequest) -> ChatResponse:
    thread_id = req.thread_id or f"thread_{uuid.uuid4().hex[:12]}"
    graph = build_karsa_supervisor_graph()

    initial_state = {
        "messages": [HumanMessage(content=req.message)],
        "session_thread_id": thread_id,
        "active_workspace_path": req.workspace_path,
            "chat_mode": req.mode,
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
        text=response_text,
    )


@app.post("/api/chat/stream")
@app.post("/api/v1/chat/stream")
def chat_stream_endpoint(req: ChatRequest) -> EventSourceResponse:
    thread_id = req.thread_id or f"thread_{uuid.uuid4().hex[:12]}"

    def event_generator():
        graph = build_karsa_supervisor_graph()
        initial_state = {
            "messages": [HumanMessage(content=req.message)],
            "session_thread_id": thread_id,
            "active_workspace_path": req.workspace_path,
            "chat_mode": req.mode,
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
            streamed = False
            for mode, event in graph.stream(initial_state, config=config, stream_mode=["updates", "custom"]):
                if mode == "custom":
                    # tokens written by the node while the model is still answering
                    if isinstance(event, dict) and event.get("token"):
                        streamed = True
                        yield {"event": "token", "data": json.dumps({"text": event["token"]})}
                    continue
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
                        if msgs and not streamed:
                            full_text = str(msgs[-1].content)
                            chunk_size = 32
                            for i in range(0, len(full_text), chunk_size):
                                chunk = full_text[i:i + chunk_size]
                                yield {
                                    "event": "token",
                                    "data": json.dumps({"text": chunk}),
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
# Model plan: which AI answers which purpose (chat / research / writing / code ...), free providers, failover
# -------------------------------------------------------------------------

class PurposeRequest(BaseModel):
    provider: str | None = None  # None = automatic
    model: str | None = None


class ProviderKeyRequest(BaseModel):
    provider: str
    api_key: str = Field(default="", max_length=400)


@app.get("/api/v1/settings/plan")
def get_model_plan() -> dict[str, Any]:
    return router.plan_overview()


@app.put("/api/v1/settings/plan/{purpose}")
def set_model_plan(purpose: str, req: PurposeRequest) -> dict[str, Any]:
    try:
        router.set_purpose_config(purpose, req.provider, req.model)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return router.plan_overview()


@app.post("/api/v1/settings/provider-key")
def save_provider_key(req: ProviderKeyRequest) -> dict[str, Any]:
    """Save (or clear, with an empty key) the API key of any provider. Keys never come back in responses."""
    from backend.core.database import set_system_setting
    from backend.core.llm_router import PROVIDER_CATALOG

    if req.provider not in PROVIDER_CATALOG or req.provider == "ollama":
        raise HTTPException(status_code=422, detail="Penyedia tidak dikenal.")
    key = req.api_key.strip()
    set_system_setting(f"api_key.{req.provider}", key)
    if hasattr(settings, f"{req.provider}_api_key"):
        setattr(settings, f"{req.provider}_api_key", key or None)
    router.invalidate_health()  # the new key is used by the very next request: no restart
    return {"provider": req.provider, "has_key": bool(key), "plan": router.plan_overview()}



@app.post("/api/v1/settings/plan/{purpose}/test")
def test_model_plan(purpose: str) -> dict[str, Any]:
    """A tiny live call with the model chosen for this purpose: tells the user if it works and how fast it is."""
    import time as _time

    from langchain_core.messages import HumanMessage as _HM

    from backend.core.llm_router import PURPOSES

    if purpose not in PURPOSES:
        raise HTTPException(status_code=404, detail="Kegunaan tidak dikenal.")
    cfg = router.get_purpose_config(purpose)
    started = _time.perf_counter()
    try:
        router.invoke_text(purpose, [_HM(content="Balas satu kata: siap")], module_name="plan_test", timeout=20.0)
    except Exception as e:
        return {"ok": False, "provider": cfg["provider"], "model": cfg["model"], "error": str(e)[:200]}
    return {"ok": True, "provider": cfg["provider"], "model": cfg["model"], "latency_ms": round((_time.perf_counter() - started) * 1000)}


# -------------------------------------------------------------------------
# Human-in-the-Loop (HITL) Governance Endpoints
# -------------------------------------------------------------------------

# Injectable so tests can resume a small graph instead of the full supervisor
GRAPH_FACTORY = build_karsa_supervisor_graph


class PolicyPayload(BaseModel):
    timeout_minutes: int = 30
    actions: dict[str, str] = Field(default_factory=dict)
    risk_overrides: dict[str, str] = Field(default_factory=dict)


@app.get("/api/v1/approvals/pending")
def list_pending_approvals(thread_id: str | None = None) -> dict[str, Any]:
    hitl_gate.expire_overdue_approvals()
    approvals = get_pending_approvals(thread_id)
    return {"pending_approvals": approvals}


@app.get("/api/v1/approvals/audit")
def approvals_audit(limit: int = 100) -> dict[str, Any]:
    """Full audit trail: who decided what, evidence shown, proposed vs executed parameters."""
    hitl_gate.expire_overdue_approvals()
    return {"audit": hitl_gate.list_audit(limit)}


@app.get("/api/v1/approvals/incomplete")
def approvals_incomplete() -> dict[str, Any]:
    """Approved actions that never finished (crash/failure between approval and execution)."""
    return {"incomplete": hitl_gate.incomplete_approvals()}


@app.get("/api/v1/approvals/policy")
def get_approval_policy() -> dict[str, Any]:
    modules = {m.module_id: list(m.high_risk_actions) for m in registry.list_modules()}
    return {"policy": hitl_gate.get_policy(), "actions": hitl_gate.known_actions(modules)}


@app.put("/api/v1/approvals/policy")
def put_approval_policy(payload: PolicyPayload) -> dict[str, Any]:
    try:
        return {"policy": hitl_gate.set_policy(payload.model_dump())}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


def _resume_graph(thread_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    graph = GRAPH_FACTORY()
    config = {"configurable": {"thread_id": thread_id}}
    snapshot = graph.get_state(config)
    if not snapshot.next:
        return {"status": "not_waiting", "thread_id": thread_id, "response": ""}
    result_state = graph.invoke(Command(resume=payload), config=config)
    messages = result_state.get("messages", [])
    response_text = str(getattr(messages[-1], "content", "")) if messages else ""
    return {"status": "resumed", "thread_id": thread_id, "response": response_text}


@app.post("/api/v1/threads/{thread_id}/resume")
def resume_thread_endpoint(thread_id: str, decision: ApprovalDecision) -> dict[str, Any]:
    """Resume an interrupted LangGraph execution with a human ApprovalDecision (idempotent: first decision wins)."""
    hitl_gate.expire_overdue_approvals()
    row = hitl_gate.get_approval_row(decision.action_id)
    if row is None or row["session_thread_id"] != thread_id:
        raise HTTPException(status_code=404, detail="Permintaan persetujuan tidak ditemukan untuk thread ini.")

    with hitl_gate.action_lock(decision.action_id):
        row = hitl_gate.get_approval_row(decision.action_id) or row
        if row["decision"] is not None:
            # Already answered (duplicate click, second device, or the timeout sweeper got there first).
            # A timeout leaves the graph paused: close it with the stored reject so the thread can finish.
            result: dict[str, Any] = {"status": "already_decided", "thread_id": thread_id, "response": ""}
            if row["decision"] == "reject" and row["exec_state"] == "pending":
                try:
                    closing = _resume_graph(thread_id, {"action_id": decision.action_id, "decision": "reject", "reason": row["decision_reason"]})
                    result["response"] = closing["response"]
                except Exception:
                    pass
            result.update(decision=row["decision"], reason=row["decision_reason"], auto=bool(row["auto_decided"]))
            return result
        try:
            out = _resume_graph(thread_id, decision.model_dump())
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to resume thread: {str(e)}")
    final = hitl_gate.get_approval_row(decision.action_id) or {}
    out.update(decision=final.get("decision"), reason=final.get("decision_reason"), exec_state=final.get("exec_state"))
    return out


@app.post("/api/v1/approvals/{action_id}/retry")
def retry_incomplete_approval(action_id: str) -> dict[str, Any]:
    """Recovery after failure: re-run the paused node with the stored decision; it still executes at most once."""
    row = hitl_gate.get_approval_row(action_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Persetujuan tidak ditemukan.")
    if row["decision"] not in ("approve", "edit") or row["exec_state"] == "done":
        raise HTTPException(status_code=409, detail="Tidak ada yang perlu diulang untuk persetujuan ini.")
    payload = {"action_id": action_id, "decision": row["decision"], "reason": row["decision_reason"], "reviewer_id": row["reviewer_id"]}
    stored = json.loads(row["decision_json"]) if row["decision_json"] else {}
    if row["decision"] == "edit":
        payload["edited_args"] = stored.get("edited_args")
    with hitl_gate.action_lock(action_id):
        try:
            out = _resume_graph(row["session_thread_id"], payload)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Retry failed: {str(e)}")
    final = hitl_gate.get_approval_row(action_id) or {}
    out.update(exec_state=final.get("exec_state"))
    return out


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
def get_hydration_today_endpoint(daily_target_ml: int | None = None) -> dict[str, Any]:
    return _hydration_summary(daily_target_ml)


def _hydration_summary(daily_target_ml: int | None = None) -> dict[str, Any]:
    """Today's summary; the persisted setting (or explicit override) is the single source of the target."""
    target = daily_target_ml or get_hydration_settings()["daily_target_ml"]
    summary = get_today_hydration_summary(daily_target_ml=target)
    summary["daily_target_ml"] = summary["target_ml"] = target
    summary["percentage"] = min(100.0, round(summary["total_ml"] / target * 100, 1))
    return summary


# -------------------------------------------------------------------------
# Finance ledger: manual expenses AND income (create / read / update / delete)
# -------------------------------------------------------------------------

class LedgerCreateRequest(BaseModel):
    kind: Literal["expense", "income"]
    amount_idr: int
    category: str | None = None  # expense only
    description: str | None = None
    merchant: str | None = None  # expense: shop; income: source label
    date: str | None = None  # YYYY-MM-DD (default: now)


class LedgerUpdateRequest(BaseModel):
    amount_idr: int | None = None
    category: str | None = None
    merchant: str | None = None
    description: str | None = None
    label: str | None = None
    note: str | None = None
    date: str | None = None


def _ledger_call(fn: Any, *args: Any, **kwargs: Any) -> Any:
    try:
        return fn(*args, **kwargs)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.get("/api/v1/finance/transactions")
def list_finance_transactions(period: str | None = None, kind: str | None = None, limit: int = 100) -> dict[str, Any]:
    from backend.modules.finance import ledger

    items = _ledger_call(ledger.list_ledger, period, kind, limit)
    return {"count": len(items), "items": items}


@app.post("/api/v1/finance/transactions")
def create_finance_transaction(req: LedgerCreateRequest) -> dict[str, Any]:
    from backend.modules.finance import ledger
    from backend.modules.finance.tools import get_budget_snapshot

    if req.kind == "expense":
        if not req.category:
            raise HTTPException(status_code=422, detail="Pilih kategori pengeluaran.")
        item = _ledger_call(ledger.add_expense, req.amount_idr, req.category, req.description, req.merchant, req.date)
    else:
        if req.category:
            raise HTTPException(status_code=422, detail="Pemasukan tidak memakai kategori.")
        item = _ledger_call(ledger.add_income, req.amount_idr, req.merchant, req.description, req.date)
    return {"status": "created", "item": item, "budget": get_budget_snapshot(period=item["period"])}


@app.put("/api/v1/finance/transactions/{kind}/{entry_id}")
def update_finance_transaction(kind: str, entry_id: int, req: LedgerUpdateRequest) -> dict[str, Any]:
    from backend.modules.finance import ledger
    from backend.modules.finance.tools import get_budget_snapshot

    item = _ledger_call(ledger.update_entry, kind, entry_id, req.model_dump(exclude_unset=True))
    return {"status": "updated", "item": item, "budget": get_budget_snapshot(period=item["period"])}


@app.delete("/api/v1/finance/transactions/{kind}/{entry_id}")
def delete_finance_transaction(kind: str, entry_id: int) -> dict[str, Any]:
    from backend.modules.finance import ledger
    from backend.modules.finance.tools import get_budget_snapshot

    removed = _ledger_call(ledger.delete_entry, kind, entry_id)
    return {"status": "deleted", "item": removed, "budget": get_budget_snapshot(period=removed["period"])}


@app.get("/api/v1/hydration/logs")
def list_hydration_logs() -> dict[str, Any]:
    """Today's individual water entries (so one wrong tap can be removed)."""
    with get_db_cursor() as cursor:
        cursor.execute(
            "SELECT id, amount_ml, timestamp FROM hydration_logs WHERE date(timestamp) = date('now') ORDER BY id DESC;"
        )
        return {"logs": [dict(r) for r in cursor.fetchall()]}


@app.delete("/api/v1/hydration/log/{log_id}")
def delete_hydration_log(log_id: int) -> dict[str, Any]:
    with get_db_cursor() as cursor:
        cursor.execute("DELETE FROM hydration_logs WHERE id = ?;", (log_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Catatan minum tidak ditemukan.")
    return {"status": "deleted", "summary": _hydration_summary()}


# -------------------------------------------------------------------------
# Notebook: source-grounded workspace (cited Q&A, dataset cleaning, paper drafts)
# -------------------------------------------------------------------------

_NB_STATUS = {"not_found": 404, "too_large": 413}


def _nb_error(e: NotebookError) -> HTTPException:
    return HTTPException(status_code=_NB_STATUS.get(e.code, 400), detail=str(e))


class NotebookCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=80)


class NotebookTextSourceRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    text: str = Field(min_length=1, max_length=400_000)


class NotebookAskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


class NotebookGenerateRequest(BaseModel):
    kind: Literal["briefing", "study_guide", "paper_draft"]
    topic: str = Field(default="", max_length=200)


class NotebookExportRequest(BaseModel):
    paper: dict[str, Any]


class DatasetCleanRequest(BaseModel):
    options: dict[str, Any] = Field(default_factory=dict)
    add_to_notebook: bool = False


@app.get("/api/v1/notebooks")
def list_notebooks_endpoint() -> dict[str, Any]:
    return {"notebooks": notebook_store.list_notebooks()}


@app.post("/api/v1/notebooks")
def create_notebook_endpoint(req: NotebookCreateRequest) -> dict[str, Any]:
    try:
        return notebook_store.create_notebook(req.title)
    except NotebookError as e:
        raise _nb_error(e)


@app.get("/api/v1/notebooks/{notebook_id}")
def get_notebook_endpoint(notebook_id: int) -> dict[str, Any]:
    try:
        return notebook_store.get_notebook(notebook_id)
    except NotebookError as e:
        raise _nb_error(e)


@app.delete("/api/v1/notebooks/{notebook_id}")
def delete_notebook_endpoint(notebook_id: int) -> dict[str, Any]:
    try:
        notebook_store.delete_notebook(notebook_id)
    except NotebookError as e:
        raise _nb_error(e)
    return {"status": "deleted"}


@app.post("/api/v1/notebooks/{notebook_id}/sources/file")
async def add_notebook_file_source_endpoint(notebook_id: int, file: UploadFile = File(...)) -> dict[str, Any]:
    data = await file.read()
    try:
        notebook_store.get_notebook(notebook_id)
        path = notebook_service.store_upload(notebook_id, file.filename or "sumber", data)
        return await asyncio.to_thread(notebook_service.ingest_file, notebook_id, path, file.filename)
    except NotebookError as e:
        raise _nb_error(e)


@app.post("/api/v1/notebooks/{notebook_id}/sources/text")
def add_notebook_text_source_endpoint(notebook_id: int, req: NotebookTextSourceRequest) -> dict[str, Any]:
    try:
        return notebook_store.add_source(notebook_id, req.title, "text", req.text)
    except NotebookError as e:
        raise _nb_error(e)


@app.delete("/api/v1/notebooks/sources/{source_id}")
def remove_notebook_source_endpoint(source_id: int) -> dict[str, Any]:
    try:
        notebook_store.remove_source(source_id)
    except NotebookError as e:
        raise _nb_error(e)
    return {"status": "deleted"}


@app.post("/api/v1/notebooks/{notebook_id}/ask")
async def ask_notebook_endpoint(notebook_id: int, req: NotebookAskRequest) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(notebook_service.ask, notebook_id, req.question)
    except NotebookError as e:
        raise _nb_error(e)


@app.post("/api/v1/notebooks/{notebook_id}/generate")
async def generate_notebook_endpoint(notebook_id: int, req: NotebookGenerateRequest) -> dict[str, Any]:
    try:
        if req.kind == "paper_draft":
            return await asyncio.to_thread(notebook_service.generate_paper, notebook_id, req.topic)
        return await asyncio.to_thread(notebook_service.generate_study, notebook_id, req.kind)
    except NotebookError as e:
        raise _nb_error(e)


@app.post("/api/v1/notebooks/{notebook_id}/export/docx")
def export_notebook_docx_endpoint(notebook_id: int, req: NotebookExportRequest) -> dict[str, Any]:
    try:
        notebook_store.get_notebook(notebook_id)
        out = notebook_service.export_paper_docx(req.paper)
    except NotebookError as e:
        raise _nb_error(e)
    return {**out, "download_url": f"/api/v1/files/outputs/{out['filename']}"}


@app.get("/api/v1/files/outputs/{filename}")
def download_output_file_endpoint(filename: str) -> FileResponse:
    """Download a generated file (cleaned dataset, .docx). Only plain file names inside the outputs folder."""
    target = settings.outputs_dir / filename
    if filename != target.name or not target.is_file():
        raise HTTPException(status_code=404, detail="File tidak ditemukan.")
    return FileResponse(target, filename=target.name)


def _dataset_source_path(source_id: int) -> tuple[dict[str, Any], str]:
    try:
        src = notebook_store.get_source(source_id)
    except NotebookError as e:
        raise _nb_error(e)
    if src["kind"] != "dataset" or not src.get("path"):
        raise HTTPException(status_code=400, detail="Sumber ini bukan dataset (.csv/.xlsx).")
    return src, src["path"]


@app.post("/api/v1/notebooks/sources/{source_id}/clean/preview")
async def preview_dataset_clean_endpoint(source_id: int, req: DatasetCleanRequest) -> dict[str, Any]:
    _, path = _dataset_source_path(source_id)
    try:
        return await asyncio.to_thread(dataset_cleaner.preview, path, req.options)
    except NotebookError as e:
        raise _nb_error(e)


@app.post("/api/v1/notebooks/sources/{source_id}/clean/apply")
async def apply_dataset_clean_endpoint(source_id: int, req: DatasetCleanRequest) -> dict[str, Any]:
    src, path = _dataset_source_path(source_id)
    try:
        report = await asyncio.to_thread(dataset_cleaner.apply_clean, path, req.options)
        report["download_url"] = f"/api/v1/files/outputs/{report['output_name']}"
        if req.add_to_notebook:
            new_src = await asyncio.to_thread(
                notebook_service.ingest_file, src["notebook_id"], Path(report["output_path"]), report["output_name"]
            )
            report["added_source"] = new_src
        return report
    except NotebookError as e:
        raise _nb_error(e)


@app.get("/api/v1/settings/theme")
def get_theme_endpoint() -> dict[str, Any]:
    """The persisted UI theme (light | dark | system); 'system' until the user picks one."""
    from backend.core.database import get_system_setting

    mode = get_system_setting("ui.theme", "system")
    return {"mode": mode if mode in ("light", "dark", "system") else "system"}


@app.put("/api/v1/settings/theme")
def set_theme_endpoint(req: ThemeRequest) -> dict[str, Any]:
    from backend.core.database import set_system_setting

    set_system_setting("ui.theme", req.mode)
    return {"mode": req.mode}


@app.get("/api/v1/hydration/settings")
def get_hydration_settings_endpoint() -> dict[str, Any]:
    return get_hydration_settings()


@app.put("/api/v1/hydration/settings")
def update_hydration_settings_endpoint(req: HydrationSettingsRequest) -> dict[str, Any]:
    return update_hydration_settings(req.model_dump(exclude_none=True))


@app.post("/api/v1/hydration/log")
def log_hydration_endpoint(req: HydrationLogRequest) -> dict[str, Any]:
    target = req.daily_target_ml or get_hydration_settings()["daily_target_ml"]
    log_hydration(amount_ml=req.amount_ml, daily_target_ml=target)
    return {"status": "logged", "summary": _hydration_summary(req.daily_target_ml)}


@app.post("/api/v1/hydration/reset")
def reset_hydration_today_endpoint() -> dict[str, Any]:
    """Reset today's water intake logs in SQLite."""
    with get_db_cursor() as cursor:
        cursor.execute("DELETE FROM hydration_logs WHERE date(timestamp) = date('now');")
    return {"status": "reset", "summary": _hydration_summary()}


@app.get("/api/v1/shelf/files")
def list_shelf_files_endpoint(limit: int = 60) -> dict[str, Any]:
    return {"files": shelf.list_files(limit=limit)}


def _shelf_error(e: "shelf.ShelfError") -> HTTPException:
    status = {"not_found": 404, "too_large": 413, "full": 409, "unsupported": 415, "empty": 422}.get(e.code, 400)
    return HTTPException(status_code=status, detail=str(e))


@app.post("/api/v1/shelf/upload")
async def upload_shelf_file_endpoint(file: UploadFile = File(...)) -> dict[str, Any]:
    """Drop any file onto the tray: a real copy is kept in ~/.karsa/uploads/shelf until the user removes it."""
    data = await file.read()
    try:
        return {"status": "added", "file": shelf.add_bytes(file.filename or "file", data)}
    except shelf.ShelfError as e:
        raise _shelf_error(e)


@app.get("/api/v1/shelf/files/{shelf_id}/download")
def download_shelf_file_endpoint(shelf_id: int):
    """The stored file itself (so it can be dragged out to another app or saved)."""
    from fastapi.responses import FileResponse

    try:
        path, name = shelf.file_path_of(shelf_id)
    except shelf.ShelfError as e:
        raise _shelf_error(e)
    return FileResponse(path, filename=name)


@app.get("/api/v1/shelf/files/{shelf_id}/text")
def shelf_file_text_endpoint(shelf_id: int) -> dict[str, Any]:
    """Readable text of a shelf file, for handing it to the AI agent."""
    try:
        return shelf.extract_text(shelf_id)
    except shelf.ShelfError as e:
        raise _shelf_error(e)


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
    deleted = shelf.remove(shelf_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="File tidak ada di laci.")
    return {"status": "deleted", "id": shelf_id}


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


class MediaControlRequest(BaseModel):
    action: str


@app.post("/api/v1/system/media/control")
def control_system_media_endpoint(req: MediaControlRequest) -> dict[str, Any]:
    """Transport control for the active media session: play_pause, next, previous."""
    try:
        return control_media(req.action)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.get("/api/v1/system/osd/stream")
async def system_osd_event_stream(request: Request) -> EventSourceResponse:
    """Stream real-time hardware events to the Dynamic Island UI."""
    import asyncio

    async def event_generator():
        last_locks = get_lock_keys()
        last_battery = get_battery_status()
        last_vol = get_master_volume().get("level")
        last_mute = get_master_volume().get("muted")
        last_pressed = get_pressed_keys() if settings.fkey_osd else set()
        last_bright = (await asyncio.to_thread(get_screen_brightness)).get("level")
        last_bt: dict[str, int | None] | None = None  # name -> battery; None until the first probe has run
        tick = 0

        while True:
            if await request.is_disconnected():
                break

            await asyncio.sleep(0.06)
            tick += 1

            # 0. Function keys F1-F12 + media keys (fast poll so a quick tap is not missed)
            if settings.fkey_osd:
                pressed = get_pressed_keys()
                for name in newly_pressed(last_pressed, pressed):
                    yield {"event": "osd://fkey", "data": json.dumps(describe_key(name, alt=is_alt_down()))}
                last_pressed = pressed

            # Everything else (locks, battery, volume) every ~0.36 s as before
            if tick % 6:
                continue

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

            # 4. Brightness (WMI is slow: about once a second, off the event loop)
            if tick % 18 == 0:
                bright = (await asyncio.to_thread(get_screen_brightness)).get("level")
                if bright != last_bright:
                    last_bright = bright
                    yield {"event": "osd://brightness", "data": json.dumps({"level": bright})}

            # 5. Bluetooth devices connecting / disconnecting (PowerShell: every ~8 s, off the event loop)
            if tick % 132 == 0:
                devices = await asyncio.to_thread(get_bluetooth_devices)
                now_bt = {d["name"]: d.get("battery_percent") for d in devices}
                if last_bt is not None:
                    for name, batt in now_bt.items():
                        if name not in last_bt:
                            yield {"event": "osd://bluetooth", "data": json.dumps({"device": name, "connected": True, "battery_percent": batt})}
                    for name in last_bt:
                        if name not in now_bt:
                            yield {"event": "osd://bluetooth", "data": json.dumps({"device": name, "connected": False, "battery_percent": None})}
                last_bt = now_bt

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


@app.get("/api/v1/wardrobe/items")
def get_wardrobe_items_endpoint() -> dict[str, Any]:
    """Get all custom drawn accessories and wardrobe items from SQLite."""
    items = list_wardrobe_items()
    return {"count": len(items), "items": items}


@app.post("/api/v1/wardrobe/items")
def save_wardrobe_item_endpoint(req: WardrobeItemRequest) -> dict[str, Any]:
    """Save a drawn accessory from the Draw Pad to SQLite."""
    item = save_wardrobe_item(
        item_id=req.id,
        name=req.name,
        data_url=req.data_url,
        anchor_type=req.anchor_type,
        is_active=req.is_active,
    )
    return {"status": "saved", "item": item}


@app.delete("/api/v1/wardrobe/items/{item_id}")
def delete_wardrobe_item_endpoint(item_id: str) -> dict[str, Any]:
    """Delete a custom drawn accessory from SQLite."""
    if not delete_wardrobe_item(item_id):
        raise HTTPException(status_code=404, detail="Aksesori tidak ditemukan.")
    return {"status": "deleted", "item_id": item_id}


OUTFIT_PRESETS = frozenset({
    "party_hat", "crown", "bow", "glasses", "shades", "headphones", "flower", "halo", "wizard_hat", "scarf", "mustache", "star",
})
OUTFIT_KEY = "wardrobe.outfit"


class OutfitItemModel(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    kind: str
    src: str | None = Field(default=None, max_length=200_000)
    x: float = Field(ge=-2.5, le=2.5)
    y: float = Field(ge=-2.5, le=2.5)
    s: float = Field(ge=0.2, le=3)
    rot: float = Field(ge=-180, le=180)
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class OutfitRequest(BaseModel):
    items: list[OutfitItemModel] = Field(default_factory=list, max_length=8)


def _validate_outfit(items: list[OutfitItemModel]) -> None:
    customs = 0
    for it in items:
        if it.kind == "custom":
            customs += 1
            if not (it.src or "").startswith("data:image/png;base64,"):
                raise HTTPException(status_code=422, detail="Aksesori gambar harus berupa PNG.")
        elif it.kind not in OUTFIT_PRESETS:
            raise HTTPException(status_code=422, detail=f"Aksesori tidak dikenal: {it.kind}")
        elif it.src is not None:
            raise HTTPException(status_code=422, detail="Aksesori bawaan tidak membawa gambar.")
    if customs > 3:
        raise HTTPException(status_code=422, detail="Maksimal 3 aksesori gambar sekaligus.")


@app.get("/api/v1/wardrobe/outfit")
def get_outfit() -> dict[str, Any]:
    """What Karsa is wearing (presets + drawn accessories), persisted in SQLite."""
    from backend.core.database import get_system_setting

    raw = get_system_setting(OUTFIT_KEY, None)
    items = raw.get("items") if isinstance(raw, dict) else None
    return {"items": items if isinstance(items, list) else [], "presets": sorted(OUTFIT_PRESETS)}


@app.put("/api/v1/wardrobe/outfit")
def put_outfit(req: OutfitRequest) -> dict[str, Any]:
    from backend.core.database import set_system_setting

    _validate_outfit(req.items)
    set_system_setting(OUTFIT_KEY, {"items": [i.model_dump() for i in req.items]})
    return {"items": [i.model_dump() for i in req.items]}


class CreateTaskRequest(BaseModel):
    title: str
    description: str | None = None
    course: str | None = None
    task_type: str = "assignment"
    due_at: str | None = None
    is_urgent: bool | None = None
    is_important: bool = True
    priority: int | None = None
    recurrence: Literal["none", "daily", "weekdays", "weekly"] = "none"


@app.post("/api/v1/tasks")
def create_task_endpoint(req: CreateTaskRequest) -> dict[str, Any]:
    """Insert a new task into SQLite with automatic Eisenhower matrix classification."""
    try:
        task = add_task_in_db(
            title=req.title,
            description=req.description,
            course=req.course,
            task_type=req.task_type,
            due_at=req.due_at,
            is_urgent=req.is_urgent,
            is_important=req.is_important,
            priority=req.priority,
            recurrence=req.recurrence,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"status": "created", "task": task}


@app.delete("/api/v1/tasks/{task_id}")
def delete_task_endpoint(task_id: int) -> dict[str, Any]:
    """Delete a task permanently from SQLite (404 when it does not exist)."""
    from backend.modules.study_daily.tools import delete_task_in_db
    try:
        delete_task_in_db(task_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"status": "deleted", "id": task_id}


class UpdateTaskRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    course: str | None = None
    task_type: str | None = None
    due_at: str | None = None
    priority: int | None = None


@app.put("/api/v1/tasks/{task_id}")
def update_task_endpoint(task_id: int, req: UpdateTaskRequest) -> dict[str, Any]:
    """Edit a task (rename, new deadline, new priority ...). Only fields that are sent change."""
    from backend.modules.study_daily.tools import update_task_in_db

    fields = req.model_dump(exclude_unset=True)
    try:
        return {"status": "updated", "task": update_task_in_db(task_id, fields)}
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


# -------------------------------------------------------------------------
# Model Specialization Override Endpoint (Instruction 4)
# -------------------------------------------------------------------------

class ModelOverrideRequest(BaseModel):
    task: str
    provider: str
    model: str
    temperature: float = 0.2


@app.post("/api/models/override")
@app.post("/api/v1/models/override")
def set_model_override_endpoint(req: ModelOverrideRequest) -> dict[str, Any]:
    """Store manual override for task specialization in system_settings."""
    router.set_specialization_override(req.task, req.provider, req.model, req.temperature)
    return {
        "status": "success",
        "task": req.task,
        "config": router.route_model_for_specialization(req.task),
    }






# -------------------------------------------------------------------------
# Production UI: serve the built desktop-companion (PWA) from the same process.
# Mounted LAST so every API route keeps priority. Absent dist/ (dev mode) = no mount.
# -------------------------------------------------------------------------
UI_DIST_DIR = Path(__file__).resolve().parents[2] / "desktop-companion" / "dist"


def mount_ui(directory: Path = UI_DIST_DIR) -> bool:
    from fastapi.staticfiles import StaticFiles

    if not (directory / "index.html").is_file():
        return False
    app.mount("/", StaticFiles(directory=str(directory), html=True), name="ui")
    return True


mount_ui()
