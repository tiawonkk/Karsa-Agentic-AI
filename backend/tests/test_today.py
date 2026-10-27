import datetime

from fastapi.testclient import TestClient

from backend.api.main import app
from backend.core.today import build_nudges, build_today, greeting
from backend.modules.study_daily.tools import add_task_in_db

client = TestClient(app)
NOON = datetime.datetime(2026, 10, 14, 13, 0)  # 18 days left in a 31-day month
BUDGET = {"total_capital_idr": 2_000_000, "total_remaining_idr": 1_000_000, "remaining_days": 18, "daily_safe_spend_idr": 55_000}
WATER_OK = {"total_ml": 1000, "target_ml": 2000}


def ids(nudges):
    return [n["id"] for n in nudges]


def test_greeting_follows_the_hour():
    assert greeting(datetime.datetime(2026, 1, 1, 7)) == "Selamat pagi"
    assert greeting(datetime.datetime(2026, 1, 1, 20)) == "Selamat malam"


def test_quiet_day_has_no_nudges_when_everything_is_fine():
    tasks = [{"id": 1, "title": "Baca", "hours_left": 100}]
    assert build_nudges(NOON, tasks, BUDGET, WATER_OK) == []


def test_deadline_overdue_money_and_water_rules():
    tasks = [{"id": 1, "title": "Laporan", "hours_left": 5}, {"id": 2, "title": "PR", "hours_left": -3}]
    low_budget = {**BUDGET, "total_remaining_idr": 300_000}  # 15% left, 58% of the month left
    n = build_nudges(NOON, tasks, low_budget, {"total_ml": 200, "target_ml": 2000})
    assert ids(n) == ["overdue", "due_soon", "money_low"]  # capped at 3, water_low dropped
    assert all(x["text"] for x in n)


def test_water_nudge_only_after_noon_and_no_tasks_nudge():
    morning = datetime.datetime(2026, 10, 14, 9, 0)
    assert "water_low" not in ids(build_nudges(morning, [{"id": 1, "title": "x", "hours_left": 50}], BUDGET, {"total_ml": 0, "target_ml": 2000}))
    n = build_nudges(NOON, [], BUDGET, WATER_OK)
    assert ids(n) == ["no_tasks"]


def test_snoozed_nudge_is_skipped_until_it_expires():
    tasks = [{"id": 2, "title": "PR", "hours_left": -3}]
    until = (NOON + datetime.timedelta(hours=5)).isoformat()
    assert build_nudges(NOON, tasks, BUDGET, WATER_OK, {"overdue": until}) == []
    assert ids(build_nudges(NOON + datetime.timedelta(hours=6), tasks, BUDGET, WATER_OK, {"overdue": until})) == ["overdue"]


def test_brief_orders_focus_by_deadline_and_reports_real_numbers():
    tasks = [{"id": 1, "title": "B", "hours_left": 30}, {"id": 2, "title": "A", "hours_left": 2}, {"id": 3, "title": "C", "hours_left": None}]
    brief = build_today(NOON, tasks, BUDGET, WATER_OK)
    assert [t["title"] for t in brief["tasks"]["focus"]] == ["A", "B", "C"]
    assert brief["money"]["daily_safe_spend_idr"] == 55_000 and brief["water"] == WATER_OK


def test_today_api_empty_state_and_snooze():
    brief = client.get("/api/v1/today").json()
    assert brief["tasks"]["pending_count"] == 0 and brief["tasks"]["focus"] == []
    assert "no_tasks" in [n["id"] for n in brief["nudges"]]  # honest empty state, not a fake task

    add_task_in_db("Tugas nyata", priority=2)
    assert client.get("/api/v1/today").json()["tasks"]["focus"][0]["title"] == "Tugas nyata"

    assert client.post("/api/v1/today/nudges/no_tasks/snooze", json={"hours": 2}).status_code == 200
    assert "no_tasks" not in [n["id"] for n in client.get("/api/v1/today").json()["nudges"]]
    assert client.post("/api/v1/today/nudges/Bad Id/snooze", json={}).status_code in (404, 422)
    assert client.post("/api/v1/today/nudges/overdue/snooze", json={"hours": 0}).status_code == 422
