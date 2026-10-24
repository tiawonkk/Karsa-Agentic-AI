"""Human-in-the-loop governance gate.

Flow for a risky action: `check_and_request_approval` evaluates the risk (with the user's policy), records the request
with its evidence in `hitl_approvals`, and pauses the LangGraph thread with `interrupt()`. The reviewer approves, edits
or rejects; the graph resumes through `Command(resume=...)`; the module then runs the action through `execute_approved`.

Safety properties (each one has an SDET test in `backend/tests/test_hitl_harness.py`):
  1. approve   -> exactly one execution, with the proposed parameters
  2. reject    -> never executes
  3. edit      -> executes the EDITED parameters (B, not A); only whitelisted parameters may change
  4. duplicate -> the first recorded decision wins; a second decision/execution is a no-op (idempotent)
  5. stale     -> if the world changed since the request (fingerprint), the approval is void
  6. timeout   -> an approval nobody answers expires and counts as a rejection
  7. recovery  -> an approved action that crashed before finishing is listed and can be retried exactly once
"""
from __future__ import annotations

import datetime
import hashlib
import json
import re
import threading
from pathlib import Path
from typing import Any, Callable, Literal

from langgraph.types import interrupt

from backend.core.database import get_db_cursor, get_system_setting, set_system_setting
from backend.core.state import ApprovalDecision, ApprovalRequest, ProposedAction

RiskLevel = Literal["low", "medium", "high", "critical"]
RISK_ORDER: tuple[str, ...] = ("low", "medium", "high", "critical")
POLICY_MODES = ("prompt", "allow", "deny")

# Global High-Risk Actions
GLOBAL_HIGH_RISK_ACTIONS = {
    "overwrite_file",
    "apply_code_patch",
    "compile_docx_overwrite",
    "set_monthly_capital",
    "run_shell_command",
    "delete_file",
}

POLICY_KEY = "hitl.policy"
DEFAULT_TIMEOUT_MINUTES = 30
# A 'running' claim older than this is treated as crashed and may be taken over (recovery after failure)
CLAIM_TIMEOUT_SECONDS = 120
_NAME_RE = re.compile(r"^[a-z0-9_]{1,64}$")


# --------------------------------------------------------------------------------------------------- time helpers


def _utc_now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _iso(dt: datetime.datetime) -> str:
    """Same shape as SQLite's strftime('%Y-%m-%dT%H:%M:%fZ'), so string comparison orders correctly."""
    dt = dt.astimezone(datetime.timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


# --------------------------------------------------------------------------------------------------- policy


def get_policy(db_path: Path | str | None = None) -> dict[str, Any]:
    """The user's approval policy (stored in system_settings), always returned in a complete, sanitized shape."""
    raw = get_system_setting(POLICY_KEY, None, db_path)
    data = raw if isinstance(raw, dict) else {}
    try:
        timeout = int(data.get("timeout_minutes", DEFAULT_TIMEOUT_MINUTES))
    except (TypeError, ValueError):
        timeout = DEFAULT_TIMEOUT_MINUTES
    actions = {k: v for k, v in (data.get("actions") or {}).items() if _NAME_RE.match(str(k)) and v in POLICY_MODES}
    overrides = {k: v for k, v in (data.get("risk_overrides") or {}).items() if _NAME_RE.match(str(k)) and v in RISK_ORDER}
    return {"timeout_minutes": min(max(timeout, 1), 1440), "actions": actions, "risk_overrides": overrides}


def set_policy(policy: dict[str, Any], db_path: Path | str | None = None) -> dict[str, Any]:
    """Validate and persist the policy. Raises ValueError with a user-facing message on bad input."""
    timeout = policy.get("timeout_minutes", DEFAULT_TIMEOUT_MINUTES)
    if not isinstance(timeout, int) or isinstance(timeout, bool) or not 1 <= timeout <= 1440:
        raise ValueError("Batas waktu persetujuan harus 1 sampai 1440 menit.")
    actions = policy.get("actions") or {}
    overrides = policy.get("risk_overrides") or {}
    for name, mode in actions.items():
        if not _NAME_RE.match(str(name)):
            raise ValueError(f"Nama aksi tidak valid: {name}")
        if mode not in POLICY_MODES:
            raise ValueError(f"Mode untuk '{name}' harus prompt, allow, atau deny.")
    for name, risk in overrides.items():
        if not _NAME_RE.match(str(name)):
            raise ValueError(f"Nama aksi tidak valid: {name}")
        if risk not in RISK_ORDER:
            raise ValueError(f"Level risiko untuk '{name}' harus low, medium, high, atau critical.")
    clean = {"timeout_minutes": timeout, "actions": dict(actions), "risk_overrides": dict(overrides)}
    set_system_setting(POLICY_KEY, clean, db_path)
    return get_policy(db_path)


def effective_mode(action_name: str, risk: str, policy: dict[str, Any]) -> str:
    """prompt (ask the human) / allow (run, logged) / deny (never run). A critical action is never auto-allowed."""
    mode = policy.get("actions", {}).get(action_name, "prompt")
    if mode == "allow" and risk == "critical":
        return "prompt"
    return mode


def evaluate_action_risk(
    action: ProposedAction,
    module_high_risk_actions: list[str] | None = None,
    policy: dict[str, Any] | None = None,
) -> RiskLevel:
    """Deterministic evaluation of action risk level (the user's per-action override wins)."""
    if policy:
        override = policy.get("risk_overrides", {}).get(action.action_name)
        if override in RISK_ORDER:
            return override  # type: ignore[return-value]

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


# --------------------------------------------------------------------------------------------------- fingerprints


def fingerprint_path(path: Path | str) -> str:
    """Cheap identity of a file right now: size + mtime (or 'absent')."""
    p = Path(path)
    if not p.exists():
        return "absent"
    st = p.stat()
    return f"file:{st.st_size}:{st.st_mtime_ns}"


def fingerprint_for(action: ProposedAction) -> str | None:
    if action.fingerprint:
        return action.fingerprint
    if action.target_path:
        return fingerprint_path(action.target_path)
    return None


def stable_action_id(session_thread_id: str, action: ProposedAction, nonce: str | None = None) -> str:
    """Deterministic id: the same request in the same thread always maps to the same approval row."""
    payload = json.dumps(
        [session_thread_id, action.module, action.action_name, action.target_path, action.args, nonce],
        sort_keys=True,
        default=str,
    )
    return f"act_{action.action_name[:24]}_{hashlib.sha256(payload.encode()).hexdigest()[:12]}"


def build_evidence(action: ProposedAction, risk: str) -> dict[str, Any]:
    """What the reviewer sees on the approval card (operation, target, impact, reason, exact parameters)."""
    return {
        "operation": action.action_name,
        "module": action.module,
        "target": action.target_path,
        "environment": "Perangkat lokal",
        "impact": action.impact,
        "reason": action.reason,
        "preview": action.preview,
        "args": action.args,
        "editable_args": list(action.args) if action.editable_args is None else list(action.editable_args),
        "risk": risk,
    }


# --------------------------------------------------------------------------------------------------- persistence


def log_pending_approval(
    request: ApprovalRequest,
    session_thread_id: str,
    db_path: Path | str | None = None,
    fingerprint: str | None = None,
) -> None:
    """Store an unapproved action (with its evidence and expiry) in the hitl_approvals audit table."""
    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            INSERT INTO hitl_approvals (
                action_id, session_thread_id, module, action_name,
                risk_level, request_json, decision, executed,
                evidence_json, expires_at, fingerprint
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?)
            ON CONFLICT(action_id) DO UPDATE SET
                request_json = excluded.request_json,
                evidence_json = excluded.evidence_json,
                expires_at = excluded.expires_at,
                fingerprint = excluded.fingerprint;
            """,
            (
                request.action_id,
                session_thread_id,
                request.module,
                request.action_name,
                request.risk_level,
                request.model_dump_json(),
                json.dumps(request.evidence) if request.evidence else None,
                request.expires_at,
                fingerprint,
            ),
        )


def update_approval_decision(
    action_id: str,
    decision: Literal["approve", "edit", "reject"],
    decision_json: str | None = None,
    db_path: Path | str | None = None,
    *,
    reviewer_id: str | None = None,
    reason: str | None = None,
    executed_action: dict[str, Any] | None = None,
    only_if_undecided: bool = False,
    auto: bool = False,
) -> bool:
    """Record the decision in the audit table. With `only_if_undecided` the first decision wins. Returns True if written."""
    sql = """
        UPDATE hitl_approvals
        SET decision = ?, decision_json = ?, decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            reviewer_id = ?, decision_reason = ?, executed_action_json = ?, auto_decided = ?
        WHERE action_id = ?
    """
    if only_if_undecided:
        sql += " AND decision IS NULL"
    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            sql + ";",
            (
                decision,
                decision_json,
                reviewer_id,
                reason,
                json.dumps(executed_action) if executed_action is not None else None,
                1 if auto else 0,
                action_id,
            ),
        )
        return cursor.rowcount > 0


def get_approval_row(action_id: str, db_path: Path | str | None = None) -> dict[str, Any] | None:
    with get_db_cursor(db_path) as cursor:
        cursor.execute("SELECT * FROM hitl_approvals WHERE action_id = ?;", (action_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def _loads(raw: str | None) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


def _public_row(r: dict[str, Any]) -> dict[str, Any]:
    request = _loads(r.get("request_json")) or {}
    return {
        "action_id": r["action_id"],
        "session_thread_id": r["session_thread_id"],
        "module": r["module"],
        "action_name": r["action_name"],
        "risk_level": r["risk_level"],
        "summary": request.get("summary"),
        "request": request,
        "evidence": _loads(r.get("evidence_json")) or request.get("evidence") or {},
        "decision": r.get("decision"),
        "reason": r.get("decision_reason"),
        "reviewer_id": r.get("reviewer_id"),
        "auto": bool(r.get("auto_decided")),
        "requested_at": r.get("requested_at"),
        "decided_at": r.get("decided_at"),
        "expires_at": r.get("expires_at"),
        "exec_state": r.get("exec_state"),
        "executed": bool(r.get("executed")),
        "proposed_args": request.get("proposed_args") or {},
        "executed_args": _loads(r.get("executed_action_json")),
    }


def get_pending_approvals(
    session_thread_id: str | None = None,
    db_path: Path | str | None = None,
) -> list[dict[str, Any]]:
    """All approval requests still awaiting a human (oldest first). Run `expire_overdue_approvals` first."""
    query = "SELECT * FROM hitl_approvals WHERE decision IS NULL"
    params: list[Any] = []
    if session_thread_id:
        query += " AND session_thread_id = ?"
        params.append(session_thread_id)
    query += " ORDER BY requested_at ASC"
    with get_db_cursor(db_path) as cursor:
        cursor.execute(query, params)
        return [_public_row(dict(r)) for r in cursor.fetchall()]


def list_audit(limit: int = 100, db_path: Path | str | None = None) -> list[dict[str, Any]]:
    """The audit trail: every request with reviewer, decision, evidence, proposed vs executed parameters."""
    with get_db_cursor(db_path) as cursor:
        cursor.execute("SELECT * FROM hitl_approvals ORDER BY requested_at DESC, rowid DESC LIMIT ?;", (max(1, min(limit, 1000)),))
        return [_public_row(dict(r)) for r in cursor.fetchall()]


def expire_overdue_approvals(
    db_path: Path | str | None = None,
    now: datetime.datetime | None = None,
) -> list[dict[str, str]]:
    """Reviewer-timeout: unanswered approvals past their expiry become rejections. Returns the ones expired just now."""
    now_iso = _iso(now or _utc_now())
    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            "SELECT action_id, session_thread_id FROM hitl_approvals WHERE decision IS NULL AND expires_at IS NOT NULL AND expires_at <= ?;",
            (now_iso,),
        )
        due = [dict(r) for r in cursor.fetchall()]
        for d in due:
            cursor.execute(
                """
                UPDATE hitl_approvals
                SET decision = 'reject', decision_reason = 'timeout', auto_decided = 1, decided_at = ?,
                    decision_json = ?
                WHERE action_id = ? AND decision IS NULL;
                """,
                (now_iso, json.dumps({"action_id": d["action_id"], "decision": "reject", "reason": "timeout"}), d["action_id"]),
            )
    return due


# --------------------------------------------------------------------------------------------------- exactly-once execution


def claim_execution(
    action_id: str,
    current_fingerprint: str | None = None,
    db_path: Path | str | None = None,
    now: datetime.datetime | None = None,
) -> tuple[bool, str]:
    """Take the single execution slot of an approved action. Returns (ok, reason).

    reasons: claimed | not_found | not_approved | already_executed | stale | in_progress
    """
    now = now or _utc_now()
    cutoff = _iso(now - datetime.timedelta(seconds=CLAIM_TIMEOUT_SECONDS))
    with get_db_cursor(db_path) as cursor:
        cursor.execute("SELECT decision, exec_state, fingerprint FROM hitl_approvals WHERE action_id = ?;", (action_id,))
        row = cursor.fetchone()
        if not row:
            return False, "not_found"
        if row["decision"] not in ("approve", "edit"):
            return False, "not_approved"
        if row["exec_state"] == "done":
            return False, "already_executed"
        if row["exec_state"] == "stale":
            return False, "stale"
        if current_fingerprint is not None and row["fingerprint"] is not None and current_fingerprint != row["fingerprint"]:
            cursor.execute("UPDATE hitl_approvals SET exec_state = 'stale' WHERE action_id = ?;", (action_id,))
            return False, "stale"
        cursor.execute(
            """
            UPDATE hitl_approvals SET exec_state = 'running', claimed_at = ?
            WHERE action_id = ?
              AND (exec_state IN ('pending', 'failed') OR (exec_state = 'running' AND (claimed_at IS NULL OR claimed_at < ?)));
            """,
            (_iso(now), action_id, cutoff),
        )
        return (True, "claimed") if cursor.rowcount > 0 else (False, "in_progress")


def finish_execution(action_id: str, ok: bool, db_path: Path | str | None = None) -> None:
    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            "UPDATE hitl_approvals SET exec_state = ?, executed = ?, claimed_at = NULL WHERE action_id = ?;",
            ("done" if ok else "failed", 1 if ok else 0, action_id),
        )


def execute_approved(
    action_id: str,
    fn: Callable[[], Any],
    current_fingerprint: str | None = None,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Run `fn` at most once for an approved action. Returns {ran, reason, result, error}.

    A stale fingerprint, a repeated call, or a missing approval means `fn` is NOT called. If `fn` raises, the action is
    marked 'failed' (listed by `incomplete_approvals`) and can be retried; it will still run only once successfully.
    """
    ok, reason = claim_execution(action_id, current_fingerprint, db_path)
    if not ok:
        return {"ran": False, "reason": reason, "result": None, "error": None}
    try:
        result = fn()
    except Exception as e:  # keep the failure in the audit trail instead of losing the approval
        finish_execution(action_id, False, db_path)
        return {"ran": False, "reason": "failed", "result": None, "error": str(e)}
    finish_execution(action_id, True, db_path)
    return {"ran": True, "reason": "executed", "result": result, "error": None}


def mark_approval_executed(
    action_id: str,
    db_path: Path | str | None = None,
) -> bool:
    """Mark action as executed ensuring idempotency. Returns True if successfully marked."""
    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            UPDATE hitl_approvals
            SET executed = 1, exec_state = 'done', claimed_at = NULL
            WHERE action_id = ? AND executed = 0;
            """,
            (action_id,),
        )
        return cursor.rowcount > 0


def incomplete_approvals(db_path: Path | str | None = None) -> list[dict[str, Any]]:
    """Approved or edited actions that never finished (crash/failure between approval and execution)."""
    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            SELECT * FROM hitl_approvals
            WHERE decision IN ('approve', 'edit') AND exec_state IN ('pending', 'running', 'failed')
            ORDER BY requested_at ASC;
            """
        )
        return [_public_row(dict(r)) for r in cursor.fetchall()]


_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def action_lock(action_id: str) -> threading.Lock:
    """One lock per action so two simultaneous resume requests (double click) are processed one after the other."""
    with _locks_guard:
        return _locks.setdefault(action_id, threading.Lock())


# --------------------------------------------------------------------------------------------------- the gate


def _normalize_raw_decision(raw: Any) -> dict[str, Any]:
    if isinstance(raw, ApprovalDecision):
        return raw.model_dump()
    if isinstance(raw, dict):
        return dict(raw)
    return {"decision": "reject", "reason": f"keputusan tidak dikenal: {str(raw)[:80]}"}


def _settle_decision(
    action: ProposedAction,
    req: ApprovalRequest,
    raw: Any,
    db_path: Path | str | None,
) -> dict[str, Any]:
    """Turn the reviewer's answer into the final, validated, recorded decision (first decision wins)."""
    d = _normalize_raw_decision(raw)
    decision = d.get("decision") if d.get("decision") in ("approve", "edit", "reject") else "reject"
    reason = d.get("reason")
    reviewer = d.get("reviewer_id")
    final_args: dict[str, Any] | None = dict(action.args)

    expired = bool(req.expires_at) and _iso(_utc_now()) > str(req.expires_at)
    if expired and decision != "reject":
        decision, reason, final_args = "reject", "timeout", None

    if decision == "edit":
        edited = d.get("edited_args")
        allowed = set(action.args) if action.editable_args is None else set(action.editable_args)
        if not isinstance(edited, dict) or not edited or not set(edited) <= allowed:
            decision, reason, final_args = "reject", "invalid_edit", None
        else:
            final_args = {**action.args, **edited}
    elif decision == "reject":
        final_args = None

    written = update_approval_decision(
        action.action_id,
        decision,  # type: ignore[arg-type]
        json.dumps({**d, "decision": decision, "reason": reason}, default=str),
        db_path,
        reviewer_id=reviewer,
        reason=reason,
        executed_action=final_args,
        only_if_undecided=True,
    )
    if not written:
        # Someone (the timeout sweeper, or an earlier answer) already decided: the stored decision wins.
        row = get_approval_row(action.action_id, db_path) or {}
        stored = row.get("decision") or "reject"
        stored_args = _loads(row.get("executed_action_json"))
        return {
            "action_id": action.action_id,
            "decision": stored,
            "reason": row.get("decision_reason") or reason,
            "reviewer_id": row.get("reviewer_id"),
            "final_args": stored_args if stored in ("approve", "edit") else None,
            "auto": bool(row.get("auto_decided")),
        }
    return {
        "action_id": action.action_id,
        "decision": decision,
        "reason": reason,
        "reviewer_id": reviewer,
        "final_args": final_args,
        "edited_args": d.get("edited_args") if decision == "edit" else None,
        "auto": False,
    }


def _log_policy_decision(
    action: ProposedAction,
    risk: str,
    session_thread_id: str,
    decision: str,
    evidence: dict[str, Any],
    fingerprint: str | None,
    db_path: Path | str | None,
) -> None:
    """Allow/deny straight from the user's policy: no prompt, but the audit trail still records it."""
    req = ApprovalRequest(
        action_id=action.action_id,
        module=action.module,
        action_name=action.action_name,
        risk_level=risk,  # type: ignore[arg-type]
        summary=action.preview or f"Kebijakan otomatis untuk {action.action_name}",
        preview=action.preview,
        proposed_args=action.args,
        created_at=_iso(_utc_now()),
        evidence=evidence,
    )
    log_pending_approval(req, session_thread_id, db_path=db_path, fingerprint=fingerprint)
    update_approval_decision(
        action.action_id,
        decision,  # type: ignore[arg-type]
        json.dumps({"action_id": action.action_id, "decision": decision, "reason": "policy"}),
        db_path,
        reason="policy",
        executed_action=action.args if decision == "approve" else None,
        auto=True,
    )


def check_and_request_approval(
    action: ProposedAction,
    session_thread_id: str,
    module_high_risk_actions: list[str] | None = None,
    db_path: Path | str | None = None,
    nonce: str | None = None,
) -> dict[str, Any] | None:
    """Check risk. If high/critical, apply the user's policy and (by default) pause with LangGraph interrupt().

    Returns None if the action is low/medium risk and safe to execute immediately. Otherwise returns the decision dict:
    {"decision": "approve"|"edit"|"reject", "final_args": {...}|None, "reason", "reviewer_id", "auto", "action_id"}.
    `final_args` are the parameters to execute: the proposed ones on approve, the reviewer's on edit.

    A resumed LangGraph node re-runs from its first line, so the action id must be the same on every re-run: it is
    derived from thread + action + parameters + `nonce` (pass something that is constant within one request, e.g. the
    number of messages). Without that the re-run would open a second approval and orphan the one the user answered.
    """
    action = action.model_copy(update={"action_id": stable_action_id(session_thread_id, action, nonce)})
    policy = get_policy(db_path)
    risk = evaluate_action_risk(action, module_high_risk_actions, policy)
    if risk not in ("high", "critical"):
        return None  # Low risk: proceed directly

    evidence = build_evidence(action, risk)
    fingerprint = fingerprint_for(action)
    mode = effective_mode(action.action_name, risk, policy)

    if mode in ("allow", "deny"):
        decision = "approve" if mode == "allow" else "reject"
        _log_policy_decision(action, risk, session_thread_id, decision, evidence, fingerprint, db_path)
        return {
            "action_id": action.action_id,
            "decision": decision,
            "reason": "policy",
            "reviewer_id": None,
            "final_args": dict(action.args) if decision == "approve" else None,
            "auto": True,
        }

    now = _utc_now()
    existing = get_approval_row(action.action_id, db_path)
    approval_req = ApprovalRequest(
        action_id=action.action_id,
        module=action.module,
        action_name=action.action_name,
        risk_level=risk,  # type: ignore[arg-type]
        summary=action.preview or f"Requires confirmation for {action.action_name}",
        preview=action.preview,
        proposed_args=action.args,
        created_at=_iso(now),
        evidence=evidence,
        # a re-run after resume keeps the ORIGINAL deadline
        expires_at=(existing or {}).get("expires_at") or _iso(now + datetime.timedelta(minutes=policy["timeout_minutes"])),
    )

    # Persist pending approval for the UI and the audit trail (once: a re-run must not reset the deadline/decision)
    if existing is None:
        log_pending_approval(approval_req, session_thread_id, db_path=db_path, fingerprint=fingerprint)

    # Trigger LangGraph interrupt.
    # Execution halts here until Command(resume=ApprovalDecision) is received!
    raw_decision = interrupt(approval_req.model_dump())

    return _settle_decision(action, approval_req, raw_decision, db_path)


def known_actions(extra: dict[str, list[str]] | None = None) -> list[dict[str, str]]:
    """Actions the policy screen can configure: the global high-risk set plus each module's own."""
    out: dict[str, dict[str, str]] = {}
    for name in sorted(GLOBAL_HIGH_RISK_ACTIONS):
        out[name] = {"name": name, "default_risk": "critical" if name == "run_shell_command" else "high", "module": "global"}
    for module_id, names in (extra or {}).items():
        for name in names:
            out.setdefault(name, {"name": name, "default_risk": "high", "module": module_id})
    return list(out.values())


def policy_digest(policy: dict[str, Any]) -> str:
    """Short stable hash of the policy (shown in the audit so a decision can be tied to the rules in force)."""
    return hashlib.sha256(json.dumps(policy, sort_keys=True).encode()).hexdigest()[:8]
