from pathlib import Path
from backend.core.database import initialize_master_database
from backend.core.config import settings
from backend.core.state import ApprovalRequest, ProposedAction
from backend.orchestrator.hitl_gate import (
    evaluate_action_risk,
    log_pending_approval,
    update_approval_decision,
    mark_approval_executed,
    get_pending_approvals,
)


def test_evaluate_action_risk(tmp_path: Path):
    # Low risk
    act_read = ProposedAction(
        action_id="act-1",
        module="finance",
        action_name="compute_budget_snapshot",
        args={},
    )
    assert evaluate_action_risk(act_read) == "low"

    # Medium risk
    act_record = ProposedAction(
        action_id="act-2",
        module="finance",
        action_name="record_transaction",
        args={"amount_idr": 50000},
    )
    assert evaluate_action_risk(act_record) == "medium"

    # High risk
    act_overwrite = ProposedAction(
        action_id="act-3",
        module="writer",
        action_name="compile_docx_overwrite",
        args={},
    )
    assert evaluate_action_risk(act_overwrite) == "high"

    # Critical risk
    act_shell = ProposedAction(
        action_id="act-4",
        module="datascience_code",
        action_name="run_shell_command",
        args={"cmd": "pytest"},
    )
    assert evaluate_action_risk(act_shell) == "critical"


def test_hitl_approval_lifecycle(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    initialize_master_database(settings.master_db_path)

    req = ApprovalRequest(
        action_id="req-test-1",
        module="writer",
        action_name="compile_docx_overwrite",
        risk_level="high",
        summary="Overwrite manuscript",
        proposed_args={"path": "paper.docx"},
        created_at="2026-10-22T00:00:00Z",
    )

    # 1. Log pending approval
    log_pending_approval(req, session_thread_id="thread-xyz")
    pending = get_pending_approvals("thread-xyz")
    assert len(pending) == 1
    assert pending[0]["action_id"] == "req-test-1"

    # 2. Update decision
    update_approval_decision("req-test-1", "approve")
    # Should no longer be pending
    pending_after = get_pending_approvals("thread-xyz")
    assert len(pending_after) == 0

    # 3. Test execution idempotency
    first_exec = mark_approval_executed("req-test-1")
    assert first_exec is True
    # Second execution should return False (prevent double-spend/double-write)
    second_exec = mark_approval_executed("req-test-1")
    assert second_exec is False
