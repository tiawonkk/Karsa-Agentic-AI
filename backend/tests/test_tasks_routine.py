import datetime
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.core.config import settings
from backend.core.database import get_db_cursor, initialize_master_database
from backend.modules.study_daily.tools import (
    add_task_in_db,
    complete_task_in_db,
    dedupe_pending_tasks,
    list_tasks_from_db,
    next_routine_time,
    reopen_task_in_db,
    set_task_recurrence,
)

client = TestClient(app)
T0 = datetime.datetime(2026, 10, 21, 9, 0, 0)  # a Wednesday


def titles(rows):
    return [r["title"] for r in rows]


def test_completed_task_stays_visible_checked_for_24h_then_leaves_the_view():
    t = add_task_in_db("Baca bab 3", priority=2)
    done = complete_task_in_db(t["id"], now=T0)
    assert done["status"] == "done"

    # the default view (pending only) no longer shows it...
    assert list_tasks_from_db(status="todo", now=T0) == []
    # ...but the UI view keeps it, checked, for 24 hours
    for hours in (0, 1, 23):
        seen = list_tasks_from_db(status="todo", recent_done_hours=24, now=T0 + datetime.timedelta(hours=hours))
        assert [(r["title"], r["status"]) for r in seen] == [("Baca bab 3", "done")]
    # after 24 h it drops out of the view but is still in the database as history
    assert list_tasks_from_db(status="todo", recent_done_hours=24, now=T0 + datetime.timedelta(hours=25)) == []
    assert titles(list_tasks_from_db(status="done")) == ["Baca bab 3"]


def test_daily_routine_returns_as_a_fresh_task_after_24h():
    t = add_task_in_db("Minum vitamin", priority=3, recurrence="daily")
    done = complete_task_in_db(t["id"], now=T0)
    assert done["next_available_from"] == "2026-10-22 09:00:00"

    # right after checking: the done one is visible, the next one is still hidden
    now_view = list_tasks_from_db(status="todo", recent_done_hours=24, now=T0 + datetime.timedelta(hours=2))
    assert [(r["title"], r["status"]) for r in now_view] == [("Minum vitamin", "done")]

    # 24 h later: the old one is gone and a new pending copy appears
    later = list_tasks_from_db(status="todo", recent_done_hours=24, now=T0 + datetime.timedelta(hours=24, minutes=1))
    assert [(r["title"], r["status"]) for r in later] == [("Minum vitamin", "todo")]
    assert later[0]["recurrence"] == "daily" and later[0]["id"] != t["id"]

    # completing the same task twice never spawns two copies
    complete_task_in_db(t["id"], now=T0 + datetime.timedelta(minutes=5))
    with get_db_cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM tasks WHERE routine_parent_id = ?;", (t["id"],))
        assert cur.fetchone()[0] == 1


def test_routine_schedules():
    fri = datetime.datetime(2026, 10, 23, 18, 0)
    assert next_routine_time(fri, "daily") == datetime.datetime(2026, 10, 24, 18, 0)
    assert next_routine_time(fri, "weekdays") == datetime.datetime(2026, 10, 26, 18, 0)  # skips Sat/Sun -> Monday
    assert next_routine_time(fri, "weekly") == datetime.datetime(2026, 10, 30, 18, 0)


def test_reopen_unchecks_and_removes_the_pending_routine_copy():
    t = add_task_in_db("Olahraga", priority=4, recurrence="daily")
    complete_task_in_db(t["id"], now=T0)
    back = reopen_task_in_db(t["id"])
    assert back["status"] == "todo" and back["completed_at"] is None
    with get_db_cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM tasks WHERE title = 'Olahraga';")
        assert cur.fetchone()[0] == 1  # the scheduled copy is gone, no duplicate
    with pytest.raises(ValueError):
        reopen_task_in_db(9999)


def test_set_recurrence_validates_and_clears():
    t = add_task_in_db("Ulas catatan")
    assert set_task_recurrence(t["id"], "weekly")["recurrence"] == "weekly"
    assert set_task_recurrence(t["id"], None)["recurrence"] is None
    with pytest.raises(ValueError):
        set_task_recurrence(t["id"], "monthly")
    with pytest.raises(ValueError):
        add_task_in_db("x", recurrence="hourly")


def test_dedupe_drops_exact_duplicates_but_keeps_the_oldest_and_finished_tasks():
    keep = [add_task_in_db("Minggu 1: Dasar Python", priority=2) for _ in range(4)]
    other = add_task_in_db("Minggu 2: Pandas", priority=2)
    different_priority = add_task_in_db("Minggu 1: Dasar Python", priority=1)
    finished = add_task_in_db("Minggu 1: Dasar Python", priority=2)
    complete_task_in_db(finished["id"], now=T0)

    dropped = dedupe_pending_tasks()
    assert dropped == 3  # 4 identical pending copies -> keep the oldest
    pending = list_tasks_from_db(status="todo")
    assert sorted(r["id"] for r in pending) == sorted([keep[0]["id"], other["id"], different_priority["id"]])
    assert titles(list_tasks_from_db(status="done")) == ["Minggu 1: Dasar Python"]  # finished task untouched
    assert dedupe_pending_tasks() == 0  # idempotent


def test_old_databases_get_the_routine_columns_without_losing_tasks(tmp_path: Path):
    db = tmp_path / "old.db"
    conn = sqlite3.connect(db)
    conn.executescript(
        """
        CREATE TABLE tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, course TEXT,
            task_type TEXT NOT NULL DEFAULT 'assignment', due_at TEXT,
            is_urgent INTEGER NOT NULL DEFAULT 0, is_important INTEGER NOT NULL DEFAULT 0,
            quadrant TEXT GENERATED ALWAYS AS (CASE WHEN is_important = 1 AND is_urgent = 1 THEN 'Q1_DO'
                WHEN is_important = 1 AND is_urgent = 0 THEN 'Q2_SCHEDULE'
                WHEN is_important = 0 AND is_urgent = 1 THEN 'Q3_DELEGATE' ELSE 'Q4_ELIMINATE' END) VIRTUAL,
            status TEXT NOT NULL DEFAULT 'todo', created_at TEXT NOT NULL DEFAULT 'x', completed_at TEXT
        );
        INSERT INTO tasks (title, is_important) VALUES ('Tugas lama', 1);
        """
    )
    conn.commit()
    conn.close()

    initialize_master_database(db)
    initialize_master_database(db)  # running it twice must be harmless

    conn = sqlite3.connect(db)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(tasks);")}
    assert {"recurrence", "available_from", "routine_parent_id"} <= cols
    assert conn.execute("SELECT title FROM tasks;").fetchall() == [("Tugas lama",)]
    assert conn.execute("SELECT MAX(version) FROM schema_migrations;").fetchone()[0] >= 5
    conn.close()
    assert titles(list_tasks_from_db(status="todo", db_path=db)) == ["Tugas lama"]


# ----------------------------------------------------------------------------- API


def test_tasks_api_check_uncheck_routine_and_dedupe():
    created = client.post("/api/v1/tasks", json={"title": "Review catatan", "priority": 2, "recurrence": "daily"}).json()["task"]
    tid = created["id"]
    assert created["recurrence"] == "daily"
    for _ in range(3):
        client.post("/api/v1/tasks", json={"title": "Kembar", "priority": 3})

    ui = client.get("/api/v1/tasks?recent_done_hours=24&limit=200").json()
    assert ui["count"] == 4

    # check it: it must stay in the UI list, as done
    assert client.post(f"/api/v1/tasks/{tid}/complete").json()["status"] == "completed"
    after = {t["id"]: t for t in client.get("/api/v1/tasks?recent_done_hours=24&limit=200").json()["tasks"]}
    assert after[tid]["status"] == "done"
    # the plain pending view hides it, and the hidden routine copy does not show yet
    plain = client.get("/api/v1/tasks").json()["tasks"]
    assert tid not in [t["id"] for t in plain] and sum(t["title"] == "Review catatan" for t in plain) == 0

    # uncheck
    assert client.post(f"/api/v1/tasks/{tid}/reopen").json()["task"]["status"] == "todo"
    again = {t["id"]: t for t in client.get("/api/v1/tasks?recent_done_hours=24").json()["tasks"]}
    assert again[tid]["status"] == "todo"

    # routine toggle + validation
    assert client.put(f"/api/v1/tasks/{tid}/recurrence", json={"recurrence": "weekly"}).json()["task"]["recurrence"] == "weekly"
    assert client.put(f"/api/v1/tasks/{tid}/recurrence", json={"recurrence": "monthly"}).status_code == 422
    assert client.put("/api/v1/tasks/9999/recurrence", json={"recurrence": "daily"}).status_code == 404
    assert client.post("/api/v1/tasks/9999/complete").status_code == 404

    # duplicates
    assert client.post("/api/v1/tasks/dedupe").json()["dropped"] == 2
    assert client.get("/api/v1/tasks?limit=200").json()["count"] == 2
    assert client.get("/api/v1/tasks?limit=1").json()["count"] == 2 and len(client.get("/api/v1/tasks?limit=1").json()["tasks"]) == 1


def test_dedupe_ignores_time_of_day_but_not_the_due_date():
    # generators stamp "now + 7 days": copies differ by seconds on the same day
    for sec in (1, 22, 43):
        add_task_in_db("Minggu 1: Dasar Python", priority=2, due_at=f"2026-10-30 14:07:{sec:02d}")
    add_task_in_db("Minggu 1: Dasar Python", priority=2, due_at="2026-10-31 09:00:00")  # another day: kept
    assert dedupe_pending_tasks() == 2
    assert len(list_tasks_from_db(status="todo")) == 2


def test_roadmap_generation_is_idempotent_while_milestones_are_pending():
    from backend.modules.study_daily.tools import generate_skill_roadmap

    first = generate_skill_roadmap("python data science")
    again = generate_skill_roadmap("python data science")
    assert first["tasks_registered"] == again["tasks_registered"] and len(first["tasks_registered"]) == 4
    assert len(list_tasks_from_db(status="todo")) == 4
    # once a milestone is finished, asking again may schedule that milestone anew
    complete_task_in_db(first["tasks_registered"][0])
    third = generate_skill_roadmap("python data science")
    assert third["tasks_registered"][0] != first["tasks_registered"][0]
