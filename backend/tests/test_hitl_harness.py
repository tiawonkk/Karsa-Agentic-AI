"""SDET harness for the human-in-the-loop gate: the 7 failure modes plus policy, audit and migration.

A tiny LangGraph (real `interrupt()` / `Command(resume=...)` / checkpointer) stands in for a module, so each test drives
the same path production uses: propose -> pause -> human decision -> resume -> execute.
"""
import datetime
import sqlite3
from pathlib import Path
from typing import Any, TypedDict

import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command

from backend.api import main as api_main
from backend.core.database import get_db_cursor, initialize_master_database
from backend.core.state import ProposedAction
from backend.orchestrator import hitl_gate as gate

client = TestClient(api_main.app)


class S(TypedDict, total=False):
    out: str


class Rig:
    """One approval-gated action: records every real execution in `effects`."""

    def __init__(self, action_name: str = "set_monthly_capital", args: dict[str, Any] | None = None, fail_times: int = 0):
        self.effects: list[dict[str, Any]] = []
        self.world = "v1"  # what the action's fingerprint is computed from
        self.fail_times = fail_times
        self.args = args or {"amount": 100}
        self.action_name = action_name
        self.nonce = "n1"
        rig = self

        def node(state: S) -> S:
            action = ProposedAction(
                action_id="ignored",
                module="finance",
                action_name=rig.action_name,
                args=dict(rig.args),
                preview="Ubah sesuatu",
                reason="tes",
                impact="tes",
                fingerprint=f"world:{rig.world}",
            )
            d = gate.check_and_request_approval(action, "thread-1", nonce=rig.nonce)
            if d is None or d["decision"] not in ("approve", "edit"):
                return {"out": f"batal:{(d or {}).get('reason')}"}

            def run() -> str:
                if rig.fail_times > 0:
                    rig.fail_times -= 1
                    raise RuntimeError("disk penuh")
                rig.effects.append(dict(d["final_args"]))
                return "ok"

            res = gate.execute_approved(d["action_id"], run, current_fingerprint=f"world:{rig.world}")
            return {"out": "jalan" if res["ran"] else f"tidak:{res['reason']}"}

        g = StateGraph(S)
        g.add_node("n", node)
        g.add_edge(START, "n")
        g.add_edge("n", END)
        self.graph = g.compile(checkpointer=MemorySaver())
        self.config = {"configurable": {"thread_id": "thread-1"}}

    def start(self) -> dict[str, Any]:
        self.graph.invoke({}, self.config)
        pending = gate.get_pending_approvals("thread-1")
        assert len(pending) == 1, "the action must pause and wait for a human"
        return pending[0]

    def resume(self, action_id: str, decision: str, **kw: Any) -> S:
        return self.graph.invoke(Command(resume={"action_id": action_id, "decision": decision, **kw}), self.config)


@pytest.fixture
def rig(monkeypatch) -> Rig:
    r = Rig()
    monkeypatch.setattr(api_main, "GRAPH_FACTORY", lambda: r.graph)
    return r


def row(action_id: str) -> dict[str, Any]:
    r = gate.get_approval_row(action_id)
    assert r is not None
    return r


# ----------------------------------------------------------------------------- 1. approval
def test_approve_executes_exactly_once_with_the_proposed_args(rig: Rig):
    p = rig.start()
    assert rig.effects == []  # nothing runs before the human answers
    out = rig.resume(p["action_id"], "approve", reviewer_id="mahasiswa")
    assert out["out"] == "jalan"
    assert rig.effects == [{"amount": 100}]
    r = row(p["action_id"])
    assert (r["decision"], r["exec_state"], r["executed"], r["reviewer_id"]) == ("approve", "done", 1, "mahasiswa")


# ----------------------------------------------------------------------------- 2. rejection
def test_reject_never_executes_and_is_audited(rig: Rig):
    p = rig.start()
    out = rig.resume(p["action_id"], "reject", reason="salah angka")
    assert out["out"].startswith("batal") and rig.effects == []
    r = row(p["action_id"])
    assert (r["decision"], r["decision_reason"], r["executed"]) == ("reject", "salah angka", 0)
    assert gate.claim_execution(p["action_id"]) == (False, "not_approved")


# ----------------------------------------------------------------------------- 3. edit executes B, not A
def test_edit_executes_the_edited_args_not_the_proposed_ones(rig: Rig):
    p = rig.start()
    rig.resume(p["action_id"], "edit", edited_args={"amount": 250})
    assert rig.effects == [{"amount": 250}]
    r = row(p["action_id"])
    assert r["decision"] == "edit"
    audit = gate.list_audit()[0]
    assert audit["proposed_args"] == {"amount": 100} and audit["executed_args"] == {"amount": 250}


def test_edit_cannot_smuggle_in_new_parameters_or_be_empty(rig: Rig):
    p = rig.start()
    out = rig.resume(p["action_id"], "edit", edited_args={"amount": 1, "path": "C:/Windows"})
    assert rig.effects == [] and out["out"] == "batal:invalid_edit"
    assert row(p["action_id"])["decision"] == "reject"


def test_edit_respects_the_editable_whitelist(monkeypatch):
    r = Rig(args={"amount": 100, "currency": "IDR"})
    monkeypatch.setattr(api_main, "GRAPH_FACTORY", lambda: r.graph)
    # patch the action to allow only `amount`
    orig = gate.check_and_request_approval

    def only_amount(action, *a, **k):
        return orig(action.model_copy(update={"editable_args": ["amount"]}), *a, **k)

    monkeypatch.setattr(gate, "check_and_request_approval", only_amount)
    p = r.start()
    out = r.resume(p["action_id"], "edit", edited_args={"currency": "USD"})
    assert r.effects == [] and out["out"] == "batal:invalid_edit"


# ----------------------------------------------------------------------------- 4. duplicate approval
def test_duplicate_approval_is_idempotent_through_the_api(rig: Rig):
    p = rig.start()
    body = {"action_id": p["action_id"], "decision": "approve"}
    first = client.post("/api/v1/threads/thread-1/resume", json=body).json()
    second = client.post("/api/v1/threads/thread-1/resume", json=body).json()
    third = client.post("/api/v1/threads/thread-1/resume", json={**body, "decision": "reject"}).json()  # conflicting late answer
    assert first["status"] == "resumed" and second["status"] == "already_decided" and third["status"] == "already_decided"
    assert third["decision"] == "approve"  # first decision wins
    assert rig.effects == [{"amount": 100}]  # exactly once


def test_execute_approved_twice_runs_the_function_once(rig: Rig):
    p = rig.start()
    rig.resume(p["action_id"], "approve")
    again = gate.execute_approved(p["action_id"], lambda: rig.effects.append({"x": 1}))
    assert again == {"ran": False, "reason": "already_executed", "result": None, "error": None}
    assert len(rig.effects) == 1


def test_resume_of_unknown_or_foreign_approval_is_rejected():
    assert client.post("/api/v1/threads/thread-1/resume", json={"action_id": "nope", "decision": "approve"}).status_code == 404


# ----------------------------------------------------------------------------- 5. stale approval
def test_stale_approval_is_void_when_the_world_changed(rig: Rig):
    p = rig.start()
    rig.world = "v2"  # e.g. the target file was modified while the card sat there
    out = rig.resume(p["action_id"], "approve")
    assert out["out"] == "tidak:stale" and rig.effects == []
    assert row(p["action_id"])["exec_state"] == "stale"
    assert gate.claim_execution(p["action_id"], "world:v1") == (False, "stale")  # stays void


def test_file_fingerprint_changes_when_the_file_does(tmp_path: Path):
    f = tmp_path / "a.docx"
    assert gate.fingerprint_path(f) == "absent"
    f.write_text("one")
    before = gate.fingerprint_path(f)
    f.write_text("two!")
    assert gate.fingerprint_path(f) != before


# ----------------------------------------------------------------------------- 6. reviewer timeout
def test_unanswered_approval_expires_into_a_rejection(rig: Rig):
    p = rig.start()
    assert row(p["action_id"])["expires_at"]
    later = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=2)
    expired = gate.expire_overdue_approvals(now=later)
    assert [e["action_id"] for e in expired] == [p["action_id"]]
    r = row(p["action_id"])
    assert (r["decision"], r["decision_reason"], r["auto_decided"]) == ("reject", "timeout", 1)
    # a late "approve" cannot resurrect it, and closing the paused thread executes nothing
    late = client.post("/api/v1/threads/thread-1/resume", json={"action_id": p["action_id"], "decision": "approve"}).json()
    assert late["status"] == "already_decided" and late["decision"] == "reject"
    assert rig.effects == []
    assert gate.get_pending_approvals() == []


def test_approving_after_the_deadline_without_the_sweeper_still_counts_as_timeout(rig: Rig):
    p = rig.start()
    with get_db_cursor() as cur:
        cur.execute("UPDATE hitl_approvals SET expires_at = '2000-01-01T00:00:00.000Z' WHERE action_id = ?;", (p["action_id"],))
    out = rig.resume(p["action_id"], "approve")
    assert out["out"] == "batal:timeout" and rig.effects == []


# ----------------------------------------------------------------------------- 7. resume after failure
def test_failed_execution_is_listed_and_retried_exactly_once(monkeypatch):
    r = Rig(fail_times=1)
    monkeypatch.setattr(api_main, "GRAPH_FACTORY", lambda: r.graph)
    p = r.start()
    out = r.resume(p["action_id"], "approve")
    assert out["out"] == "tidak:failed" and r.effects == []
    assert [i["action_id"] for i in gate.incomplete_approvals()] == [p["action_id"]]

    # recovery: the failed action can be claimed again (once) and then never again
    claimed, why = gate.claim_execution(p["action_id"], "world:v1")
    assert (claimed, why) == (True, "claimed")
    gate.finish_execution(p["action_id"], True)
    assert gate.incomplete_approvals() == []
    assert gate.claim_execution(p["action_id"], "world:v1") == (False, "already_executed")


def test_crashed_claim_is_taken_over_only_after_the_timeout():
    req = _plain_request("crash-1")
    gate.log_pending_approval(req, "t")
    gate.update_approval_decision("crash-1", "approve")
    t0 = datetime.datetime.now(datetime.timezone.utc)
    assert gate.claim_execution("crash-1", now=t0) == (True, "claimed")
    # another worker immediately after: still in progress
    assert gate.claim_execution("crash-1", now=t0 + datetime.timedelta(seconds=5)) == (False, "in_progress")
    # the first worker died: after the claim timeout it can be taken over
    later = t0 + datetime.timedelta(seconds=gate.CLAIM_TIMEOUT_SECONDS + 5)
    assert gate.claim_execution("crash-1", now=later) == (True, "claimed")


def test_retry_endpoint_conflicts_when_there_is_nothing_to_retry(rig: Rig):
    p = rig.start()
    rig.resume(p["action_id"], "approve")
    assert client.post(f"/api/v1/approvals/{p['action_id']}/retry").status_code == 409
    assert client.post("/api/v1/approvals/ghost/retry").status_code == 404


# ----------------------------------------------------------------------------- resume re-runs the node: same approval row
def test_rerun_after_resume_reuses_the_same_approval_row(rig: Rig):
    p = rig.start()
    rig.resume(p["action_id"], "approve")
    with get_db_cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM hitl_approvals;")
        assert cur.fetchone()[0] == 1  # a re-run must not open a second approval and orphan the answered one


def test_same_request_in_a_new_turn_gets_its_own_approval():
    a = ProposedAction(action_id="x", module="m", action_name="delete_file", args={"p": 1})
    assert gate.stable_action_id("t", a, "n1") == gate.stable_action_id("t", a, "n1")
    assert gate.stable_action_id("t", a, "n1") != gate.stable_action_id("t", a, "n2")
    assert gate.stable_action_id("t", a, "n1") != gate.stable_action_id("other", a, "n1")


# ----------------------------------------------------------------------------- policy
def test_policy_deny_blocks_without_asking_and_is_audited(rig: Rig):
    gate.set_policy({"timeout_minutes": 30, "actions": {"set_monthly_capital": "deny"}, "risk_overrides": {}})
    out = rig.graph.invoke({}, rig.config)
    assert out["out"] == "batal:policy" and rig.effects == []
    assert gate.get_pending_approvals() == []
    a = gate.list_audit()[0]
    assert (a["decision"], a["auto"], a["reason"]) == ("reject", True, "policy")


def test_policy_allow_runs_without_asking_but_critical_is_never_auto_allowed(monkeypatch):
    gate.set_policy({"timeout_minutes": 30, "actions": {"set_monthly_capital": "allow", "run_shell_command": "allow"}, "risk_overrides": {}})
    r = Rig()
    out = r.graph.invoke({}, r.config)
    assert out["out"] == "jalan" and r.effects == [{"amount": 100}]  # high risk + allow -> auto, logged
    assert gate.list_audit()[0]["auto"] is True

    shell = Rig(action_name="run_shell_command", args={"cmd": "dir"})
    shell.graph.invoke({}, shell.config)
    assert shell.effects == []  # critical still waits for a human
    assert len(gate.get_pending_approvals("thread-1")) == 1


def test_risk_override_can_raise_or_lower_risk():
    pol = {"risk_overrides": {"record_transaction": "high", "delete_file": "low"}}
    rec = ProposedAction(action_id="a", module="m", action_name="record_transaction", args={})
    dele = ProposedAction(action_id="b", module="m", action_name="delete_file", args={})
    assert gate.evaluate_action_risk(rec, policy=pol) == "high"
    assert gate.evaluate_action_risk(dele, policy=pol) == "low"
    assert gate.evaluate_action_risk(dele) == "high"


def test_policy_validation_and_api():
    assert client.get("/api/v1/approvals/policy").json()["policy"]["timeout_minutes"] == 30
    ok = client.put("/api/v1/approvals/policy", json={"timeout_minutes": 10, "actions": {"delete_file": "deny"}, "risk_overrides": {}})
    assert ok.status_code == 200 and ok.json()["policy"]["actions"] == {"delete_file": "deny"}
    for bad in (
        {"timeout_minutes": 0},
        {"timeout_minutes": 5000},
        {"actions": {"delete_file": "maybe"}},
        {"actions": {"Bad Name!": "deny"}},
        {"risk_overrides": {"delete_file": "extreme"}},
    ):
        assert client.put("/api/v1/approvals/policy", json=bad).status_code == 422
    names = {a["name"] for a in client.get("/api/v1/approvals/policy").json()["actions"]}
    assert {"run_shell_command", "set_monthly_capital"} <= names


def test_timeout_comes_from_the_policy(rig: Rig):
    gate.set_policy({"timeout_minutes": 5, "actions": {}, "risk_overrides": {}})
    p = rig.start()
    exp = datetime.datetime.strptime(row(p["action_id"])["expires_at"], "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=datetime.timezone.utc)
    delta = exp - datetime.datetime.now(datetime.timezone.utc)
    assert datetime.timedelta(minutes=4) < delta <= datetime.timedelta(minutes=5)


# ----------------------------------------------------------------------------- audit + evidence
def test_audit_trail_carries_evidence_reviewer_and_both_argument_sets(rig: Rig):
    p = rig.start()
    ev = p["evidence"]
    assert ev["operation"] == "set_monthly_capital" and ev["reason"] == "tes" and ev["impact"] == "tes" and ev["risk"] == "high"
    rig.resume(p["action_id"], "approve", reviewer_id="rina", reason="oke")
    body = client.get("/api/v1/approvals/audit").json()["audit"][0]
    assert body["reviewer_id"] == "rina" and body["decision"] == "approve" and body["exec_state"] == "done"
    assert body["evidence"]["operation"] == "set_monthly_capital" and body["decided_at"]


def test_pending_endpoint_lists_across_threads_and_sweeps_expired(rig: Rig):
    p = rig.start()
    assert [a["action_id"] for a in client.get("/api/v1/approvals/pending").json()["pending_approvals"]] == [p["action_id"]]
    with get_db_cursor() as cur:
        cur.execute("UPDATE hitl_approvals SET expires_at = '2000-01-01T00:00:00.000Z';")
    assert client.get("/api/v1/approvals/pending").json()["pending_approvals"] == []


# ----------------------------------------------------------------------------- migration
def test_old_hitl_table_is_upgraded_without_losing_rows(tmp_path: Path):
    db = tmp_path / "old.db"
    conn = sqlite3.connect(db)
    conn.executescript(
        """
        CREATE TABLE hitl_approvals (
            action_id TEXT PRIMARY KEY, session_thread_id TEXT NOT NULL, module TEXT NOT NULL, action_name TEXT NOT NULL,
            risk_level TEXT NOT NULL, request_json TEXT NOT NULL, decision TEXT, decision_json TEXT,
            requested_at TEXT NOT NULL DEFAULT 'x', decided_at TEXT, executed INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO hitl_approvals (action_id, session_thread_id, module, action_name, risk_level, request_json, decision, executed)
        VALUES ('old-1', 't', 'finance', 'set_monthly_capital', 'high', '{}', 'approve', 1),
               ('old-2', 't', 'finance', 'set_monthly_capital', 'high', '{}', NULL, 0);
        """
    )
    conn.commit()
    conn.close()
    initialize_master_database(db)
    initialize_master_database(db)
    conn = sqlite3.connect(db)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(hitl_approvals);")}
    assert {"reviewer_id", "evidence_json", "fingerprint", "expires_at", "exec_state", "claimed_at", "auto_decided"} <= cols
    states = dict(conn.execute("SELECT action_id, exec_state FROM hitl_approvals;").fetchall())
    assert states == {"old-1": "done", "old-2": "pending"}
    conn.close()


# ----------------------------------------------------------------------------- end to end through the real finance module
def test_real_finance_flow_approve_edit_and_reject_through_the_api():
    from backend.modules.finance.tools import get_budget_snapshot

    def capital() -> int:
        return get_budget_snapshot()["total_capital_idr"]

    # approve
    r = client.post("/api/v1/chat", json={"message": "ubah modal bulanan jadi 2jt", "thread_id": "fin-1"})
    assert r.status_code == 200, r.text
    pend = client.get("/api/v1/approvals/pending?thread_id=fin-1").json()["pending_approvals"]
    assert len(pend) == 1 and pend[0]["action_name"] == "set_monthly_capital"
    before = capital()
    res = client.post("/api/v1/threads/fin-1/resume", json={"action_id": pend[0]["action_id"], "decision": "edit", "edited_args": {"new_total_capital_idr": 1_500_000}})
    assert res.status_code == 200, res.text
    assert capital() == 1_500_000 != before  # the EDITED value was written, not the proposed 2.000.000
    dup = client.post("/api/v1/threads/fin-1/resume", json={"action_id": pend[0]["action_id"], "decision": "approve"}).json()
    assert dup["status"] == "already_decided" and capital() == 1_500_000

    # reject leaves the budget alone
    client.post("/api/v1/chat", json={"message": "ubah modal bulanan jadi 9jt", "thread_id": "fin-2"})
    pend2 = client.get("/api/v1/approvals/pending?thread_id=fin-2").json()["pending_approvals"]
    client.post("/api/v1/threads/fin-2/resume", json={"action_id": pend2[0]["action_id"], "decision": "reject"})
    assert capital() == 1_500_000


def _plain_request(action_id: str):
    from backend.core.state import ApprovalRequest

    return ApprovalRequest(
        action_id=action_id, module="finance", action_name="set_monthly_capital", risk_level="high",
        summary="s", proposed_args={}, created_at="2026-10-24T00:00:00Z",
    )
