import pytest
from pydantic import ValidationError

from backend.core.state import (
    KarsaState,
    RouteDecision,
    ProposedAction,
    ApprovalRequest,
    ApprovalDecision,
    ToolError,
    HardwareProfile,
)


def test_route_decision_contract():
    decision = RouteDecision(module="finance", confidence=0.95, reason="User wants to track expense")
    assert decision.module == "finance"
    assert decision.confidence == 0.95

    # Test extra field forbidden
    with pytest.raises(ValidationError):
        RouteDecision(module="finance", confidence=0.95, reason="ok", extra_field="invalid")

    # Test confidence out of bounds
    with pytest.raises(ValidationError):
        RouteDecision(module="finance", confidence=1.5, reason="too high")


def test_proposed_action_and_hitl_contracts():
    action = ProposedAction(
        action_id="act-123",
        module="writer",
        action_name="compile_docx",
        args={"target_path": "paper.docx"},
        target_path="paper.docx",
    )
    assert action.action_id == "act-123"

    req = ApprovalRequest(
        action_id="act-123",
        module="writer",
        action_name="compile_docx",
        risk_level="high",
        summary="Overwrite existing document",
        proposed_args={"target_path": "paper.docx"},
        created_at="2026-10-22T00:00:00Z",
    )
    assert req.risk_level == "high"

    decision = ApprovalDecision(action_id="act-123", decision="approve")
    assert decision.decision == "approve"


def test_tool_error_poka_yoke():
    err = ToolError(
        error_code="INVALID_PATH",
        message="Path is outside active workspace",
        hint="Provide a path within the active project directory",
        received={"path": "C:/Windows"},
    )
    assert err.ok is False
    assert err.error_code == "INVALID_PATH"
