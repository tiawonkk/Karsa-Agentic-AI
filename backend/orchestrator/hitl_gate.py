from __future__ import annotations

import datetime
import json
from pathlib import Path
from typing import Any, Literal
from langgraph.types import interrupt

from backend.core.database import get_db_cursor
from backend.core.state import ApprovalDecision, ApprovalRequest, ProposedAction

# Global High-Risk Actions
GLOBAL_HIGH_RISK_ACTIONS = {
    "overwrite_file",
    "apply_code_patch",
    "compile_docx_overwrite",
    "set_monthly_capital",
    "run_shell_command",
    "delete_file",
}


def evaluate_action_risk(
    action: ProposedAction,
    module_high_risk_actions: list[str] | None = None,
) -> Literal["low", "medium", "high", "critical"]:
    """Deterministic evaluation of action risk level."""
    high_actions = set(module_high_risk_actions or []).union(GLOBAL_HIGH_RISK_ACTIONS)

    if action.action_name == "run_shell_command":
        return "critical"

    if action.action_name in high_actions:
        return "high"

    # Check if action modifies an existing target file
    if action.target_path:
        p = Path(action.target_path)
        if p.exists() and action.args.get("overwrite", False):
            return "high"

    if action.action_name.startswith("record_") or action.action_name.startswith("write_new_"):
        return "medium"

    return "low"


def log_pending_approval(
    request: ApprovalRequest,
    session_thread_id: str,
    db_path: Path | str | None = None,
) -> None:
    """Store an unapproved action in the hitl_approvals database table."""
    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            INSERT INTO hitl_approvals (
                action_id, session_thread_id, module, action_name,
                risk_level, request_json, decision, executed
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0)
            ON CONFLICT(action_id) DO UPDATE SET
                request_json = excluded.request_json;
            """,
            (
                request.action_id,
                session_thread_id,
                request.module,
                request.action_name,
                request.risk_level,
                request.model_dump_json(),
            ),
        )


def update_approval_decision(
    action_id: str,
    decision: Literal["approve", "edit", "reject"],
    decision_json: str | None = None,
    db_path: Path | str | None = None,
) -> None:
    """Update decision in the hitl_approvals audit table."""
    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            UPDATE hitl_approvals
            SET decision = ?,
                decision_json = ?,
                decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE action_id = ?;
            """,
            (decision, decision_json, action_id),
        )


def mark_approval_executed(
    action_id: str,
    db_path: Path | str | None = None,
) -> bool:
    """Mark action as executed ensuring idempotency. Returns True if successfully marked."""
    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            UPDATE hitl_approvals
            SET executed = 1
            WHERE action_id = ? AND executed = 0;
            """,
            (action_id,),
        )
        return cursor.rowcount > 0


def get_pending_approvals(
    session_thread_id: str | None = None,
    db_path: Path | str | None = None,
) -> list[dict[str, Any]]:
    """Fetch all pending approval requests awaiting human review."""
    query = "SELECT action_id, session_thread_id, module, action_name, risk_level, request_json, requested_at FROM hitl_approvals WHERE decision IS NULL"
    params: list[Any] = []
    if session_thread_id:
        query += " AND session_thread_id = ?"
        params.append(session_thread_id)
    query += " ORDER BY requested_at ASC"

    with get_db_cursor(db_path) as cursor:
        cursor.execute(query, params)
        rows = cursor.fetchall()
        results = []
        for r in rows:
            req_data = json.loads(r["request_json"])
            results.append({
                "action_id": r["action_id"],
                "session_thread_id": r["session_thread_id"],
                "module": r["module"],
                "action_name": r["action_name"],
                "risk_level": r["risk_level"],
                "request": req_data,
                "requested_at": r["requested_at"],
            })
        return results


def check_and_request_approval(
    action: ProposedAction,
    session_thread_id: str,
    module_high_risk_actions: list[str] | None = None,
    db_path: Path | str | None = None,
) -> dict[str, Any] | None:
    """Check risk. If high/critical, record to database and trigger LangGraph interrupt().
    
    Returns None if action is low/medium risk and safe to execute immediately.
    When resumed from interrupt, returns the human's ApprovalDecision dictionary.
    """
    risk = evaluate_action_risk(action, module_high_risk_actions)
    if risk not in ("high", "critical"):
        return None  # Low risk: proceed directly

    approval_req = ApprovalRequest(
        action_id=action.action_id,
        module=action.module,
        action_name=action.action_name,
        risk_level=risk,
        summary=action.preview or f"Requires confirmation for {action.action_name}",
        preview=action.preview,
        proposed_args=action.args,
        created_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
    )

    # Persist pending approval for notch UI and audit
    log_pending_approval(approval_req, session_thread_id, db_path=db_path)

    # Trigger LangGraph interrupt.
    # Execution halts here until Command(resume=ApprovalDecision) is received!
    raw_decision = interrupt(approval_req.model_dump())

    # When graph resumes:
    if isinstance(raw_decision, dict):
        decision_val = raw_decision.get("decision", "reject")
        update_approval_decision(action.action_id, decision_val, json.dumps(raw_decision), db_path=db_path)
        return raw_decision
    elif isinstance(raw_decision, ApprovalDecision):
        update_approval_decision(action.action_id, raw_decision.decision, raw_decision.model_dump_json(), db_path=db_path)
        return raw_decision.model_dump()

    update_approval_decision(action.action_id, "reject", str(raw_decision), db_path=db_path)
    return {"decision": "reject", "action_id": action.action_id}
