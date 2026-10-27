"""Create / read / update / delete scenarios for every user-editable module, including the ways users get it wrong.

Each test is a situation a real person can end up in: wrong amount, wrong date, double tap, editing something that no
longer exists, deleting twice. The API must answer with a clear 4xx (never a 500, never a silent 200) and must not
leave half-written data behind.
"""
import datetime

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app

client = TestClient(app)
THIS_MONTH = datetime.datetime.now().strftime("%Y-%m")
PREV = (datetime.datetime.now().replace(day=1) - datetime.timedelta(days=1))
PREV_MONTH = PREV.strftime("%Y-%m")
PREV_DATE = PREV.strftime("%Y-%m-%d")


def post_tx(**kw):
    body = {"kind": "expense", "amount_idr": 25_000, "category": "makanan", "description": "makan siang"}
    body.update(kw)
    return client.post("/api/v1/finance/transactions", json=body)


def snap():
    return client.get("/api/v1/finance/report").json()["snapshot"]


# ============================================================================= finance: create
def test_manual_expense_is_saved_listed_and_counted():
    r = post_tx()
    assert r.status_code == 200
    item = r.json()["item"]
    assert (item["kind"], item["amount_idr"], item["category"], item["source"]) == ("expense", 25_000, "makanan", "manual")
    assert snap()["total_spent_idr"] == 25_000
    listed = client.get("/api/v1/finance/transactions").json()["items"]
    assert [i["id"] for i in listed] == [item["id"]]


def test_manual_income_raises_remaining_money_and_every_category_room():
    before = snap()
    r = post_tx(kind="income", amount_idr=1_000_001, category=None, merchant="Uang saku", description="bulan ini")
    assert r.status_code == 200 and r.json()["item"]["label"] == "Uang saku"
    after = snap()
    assert after["total_income_idr"] == 1_000_001
    assert after["total_remaining_idr"] == before["total_remaining_idr"] + 1_000_001
    gained = sum(after["categories"][c]["allocated"] - before["categories"][c]["allocated"] for c in after["categories"])
    assert gained == 1_000_001  # spread exactly, no rupiah lost to rounding
    assert after["daily_safe_spend_idr"] > before["daily_safe_spend_idr"]


@pytest.mark.parametrize("amount", [0, -5, 1.5, "abc", None, 1_000_000_001])
def test_bad_amounts_are_refused_for_both_kinds(amount):
    assert post_tx(amount_idr=amount).status_code == 422
    assert post_tx(kind="income", amount_idr=amount, category=None).status_code == 422
    assert client.get("/api/v1/finance/transactions").json()["count"] == 0  # nothing half-saved


def test_category_rules():
    assert post_tx(category=None).status_code == 422  # expense needs a category
    assert post_tx(category="hiburan").status_code == 422  # not one of the five
    assert post_tx(kind="income", category="makanan").status_code == 422  # income has no category
    assert post_tx(kind="transfer").status_code == 422


@pytest.mark.parametrize("date", ["2999-01-01", "31/12/2026", "kemarin", "1999-05-05", "2026-02-30"])
def test_bad_dates_are_refused(date):
    assert post_tx(date=date).status_code == 422


def test_back_dated_entry_lands_in_its_own_month():
    r = post_tx(date=PREV_DATE)
    assert r.status_code == 200 and r.json()["item"]["period"] == PREV_MONTH
    assert snap()["total_spent_idr"] == 0  # not counted in this month
    assert client.get(f"/api/v1/finance/report?period={PREV_MONTH}").json()["snapshot"]["total_spent_idr"] == 25_000
    assert client.get("/api/v1/finance/report?period=2026-13").status_code == 422


def test_text_fields_are_trimmed_and_limited():
    ok = post_tx(description="  makan   siang  \n enak ").json()["item"]
    assert ok["description"] == "makan siang enak"
    assert post_tx(description="x" * 201).status_code == 422
    assert post_tx(merchant="y" * 81).status_code == 422


# ============================================================================= finance: read / update / delete
def test_list_filters():
    post_tx()
    post_tx(kind="income", amount_idr=500_000, category=None)
    assert client.get("/api/v1/finance/transactions?kind=income").json()["count"] == 1
    assert client.get("/api/v1/finance/transactions?kind=expense").json()["count"] == 1
    assert client.get("/api/v1/finance/transactions?kind=nope").status_code == 422
    assert client.get("/api/v1/finance/transactions?period=bulan-ini").status_code == 422
    assert client.get("/api/v1/finance/transactions?limit=0").json()["count"] == 1  # limit is clamped, not an error


def test_edit_a_wrong_amount_and_category_updates_the_budget():
    item = post_tx(amount_idr=250_000).json()["item"]  # typo: meant 25.000
    assert snap()["total_spent_idr"] == 250_000
    r = client.put(f"/api/v1/finance/transactions/expense/{item['id']}", json={"amount_idr": 25_000, "category": "kesenangan"})
    assert r.status_code == 200 and r.json()["item"]["category"] == "kesenangan"
    s = snap()
    assert s["total_spent_idr"] == 25_000 and s["categories"]["kesenangan"]["spent"] == 25_000 and s["categories"]["makanan"]["spent"] == 0


def test_edit_moves_an_entry_to_another_month():
    item = post_tx().json()["item"]
    r = client.put(f"/api/v1/finance/transactions/expense/{item['id']}", json={"date": PREV_DATE})
    assert r.json()["item"]["period"] == PREV_MONTH and snap()["total_spent_idr"] == 0


def test_bad_edits_change_nothing():
    item = post_tx().json()["item"]
    url = f"/api/v1/finance/transactions/expense/{item['id']}"
    assert client.put(url, json={"amount_idr": -1, "category": "kesehatan"}).status_code == 422
    assert client.put(url, json={"category": "hiburan"}).status_code == 422
    assert client.put(url, json={}).status_code == 422
    assert client.put(url, json={"label": "x"}).status_code == 422  # a column that belongs to income
    kept = client.get("/api/v1/finance/transactions").json()["items"][0]
    assert (kept["amount_idr"], kept["category"]) == (25_000, "makanan")  # the valid half of a bad request was NOT applied


def test_editing_or_deleting_something_that_is_gone():
    assert client.put("/api/v1/finance/transactions/expense/999", json={"amount_idr": 5}).status_code == 404
    assert client.delete("/api/v1/finance/transactions/income/999").status_code == 404
    assert client.put("/api/v1/finance/transactions/gift/1", json={"amount_idr": 5}).status_code == 422
    assert client.delete("/api/v1/finance/transactions/gift/1").status_code == 422


def test_delete_restores_the_budget_and_a_second_delete_is_404():
    e = post_tx().json()["item"]
    i = post_tx(kind="income", amount_idr=100_000, category=None).json()["item"]
    assert client.delete(f"/api/v1/finance/transactions/expense/{e['id']}").status_code == 200
    assert client.delete(f"/api/v1/finance/transactions/income/{i['id']}").status_code == 200
    s = snap()
    assert (s["total_spent_idr"], s["total_income_idr"], s["total_remaining_idr"]) == (0, 0, s["total_capital_idr"])
    assert client.delete(f"/api/v1/finance/transactions/expense/{e['id']}").status_code == 404
    assert client.get("/api/v1/finance/transactions").json()["count"] == 0


def test_expense_and_income_ids_do_not_collide():
    e = post_tx().json()["item"]
    i = post_tx(kind="income", amount_idr=9_000, category=None).json()["item"]
    assert e["id"] == i["id"] == 1  # each table counts on its own, so the kind in the URL matters
    client.delete("/api/v1/finance/transactions/income/1")
    kinds = [x["kind"] for x in client.get("/api/v1/finance/transactions").json()["items"]]
    assert kinds == ["expense"]


def test_overspending_never_makes_daily_safe_spend_negative():
    for _ in range(3):
        post_tx(amount_idr=900_000, category="makanan")
    s = snap()
    assert s["categories"]["makanan"]["remaining"] < 0 and s["daily_safe_spend_idr"] >= 0


# ============================================================================= tasks
def add_task(**kw):
    body = {"title": "Laporan kimia", "priority": 2}
    body.update(kw)
    return client.post("/api/v1/tasks", json=body)


def test_task_create_validation():
    assert add_task(title="   ").status_code == 422
    assert add_task(title="x" * 201).status_code == 422
    assert add_task(priority=9).status_code == 422
    assert add_task(task_type="hobi").status_code == 422
    assert client.get("/api/v1/tasks?limit=50").json()["count"] == 0  # nothing leaked in by the failed attempts


def test_task_edit_rename_reprioritise_and_new_deadline():
    t = add_task().json()["task"]
    r = client.put(f"/api/v1/tasks/{t['id']}", json={"title": "  Laporan kimia organik ", "priority": 1, "due_at": "2026-12-31 10:00"})
    assert r.status_code == 200
    got = r.json()["task"]
    assert got["title"] == "Laporan kimia organik" and got["quadrant"] == "Q1_DO" and got["due_at"] == "2026-12-31 10:00:00"
    assert client.put(f"/api/v1/tasks/{t['id']}", json={"due_at": ""}).json()["task"]["due_at"] is None  # clear the deadline


def test_task_bad_edits_change_nothing():
    t = add_task().json()["task"]
    url = f"/api/v1/tasks/{t['id']}"
    assert client.put(url, json={"title": "baru", "priority": 7}).status_code == 422
    assert client.put(url, json={"title": ""}).status_code == 422
    assert client.put(url, json={"due_at": "kapan-kapan"}).status_code == 422
    assert client.put(url, json={}).status_code == 422
    assert client.put(url, json={"task_type": "hobi"}).status_code == 422
    kept = client.get("/api/v1/tasks").json()["tasks"][0]
    assert kept["title"] == "Laporan kimia"  # the good title in a bad request was not applied


def test_task_missing_ids():
    assert client.put("/api/v1/tasks/999", json={"title": "x"}).status_code == 404
    assert client.delete("/api/v1/tasks/999").status_code == 404  # used to answer 200 "error"
    assert client.post("/api/v1/tasks/999/complete").status_code == 404
    assert client.post("/api/v1/tasks/999/reopen").status_code == 404


def test_task_delete_then_delete_again_and_completed_tasks_can_be_edited_or_deleted():
    t = add_task().json()["task"]
    client.post(f"/api/v1/tasks/{t['id']}/complete")
    assert client.put(f"/api/v1/tasks/{t['id']}", json={"title": "Sudah selesai, judul dirapikan"}).status_code == 200
    assert client.delete(f"/api/v1/tasks/{t['id']}").status_code == 200
    assert client.delete(f"/api/v1/tasks/{t['id']}").status_code == 404
    assert client.get("/api/v1/tasks?status=done").json()["count"] == 0


def test_double_tap_complete_and_reopen_do_not_duplicate():
    t = add_task(recurrence="daily").json()["task"]
    for _ in range(3):
        assert client.post(f"/api/v1/tasks/{t['id']}/complete").status_code == 200
    all_rows = client.get("/api/v1/tasks?status=todo&recent_done_hours=24").json()["tasks"]
    assert len([r for r in all_rows if r["title"] == "Laporan kimia"]) == 1
    assert client.post(f"/api/v1/tasks/{t['id']}/reopen").status_code == 200
    assert client.post(f"/api/v1/tasks/{t['id']}/reopen").status_code in (200, 409, 422)  # unchecking twice must not crash


# ============================================================================= water
def test_water_log_validation_undo_and_reset():
    assert client.post("/api/v1/hydration/log", json={"amount_ml": 0}).status_code == 422
    assert client.post("/api/v1/hydration/log", json={"amount_ml": -250}).status_code == 422
    assert client.post("/api/v1/hydration/log", json={"amount_ml": 50_000}).status_code == 422  # a typo of 250
    a = client.post("/api/v1/hydration/log", json={"amount_ml": 250}).json()
    client.post("/api/v1/hydration/log", json={"amount_ml": 500})
    logs = client.get("/api/v1/hydration/logs").json()["logs"]
    assert [l["amount_ml"] for l in logs] == [500, 250]
    assert a["summary"]["total_ml"] == 250
    undone = client.delete(f"/api/v1/hydration/log/{logs[0]['id']}").json()
    assert undone["summary"]["total_ml"] == 250  # the mistaken 500 is gone
    assert client.delete(f"/api/v1/hydration/log/{logs[0]['id']}").status_code == 404
    assert client.post("/api/v1/hydration/reset").json()["summary"]["total_ml"] == 0
    assert client.post("/api/v1/hydration/reset").status_code == 200  # reset on an empty day is fine


def test_water_settings_validation():
    assert client.put("/api/v1/hydration/settings", json={"daily_target_ml": -1}).status_code == 422
    assert client.put("/api/v1/hydration/settings", json={"interval_minutes": 0}).status_code == 422
    ok = client.put("/api/v1/hydration/settings", json={"daily_target_ml": 2500, "interval_minutes": 90})
    assert ok.status_code == 200 and client.get("/api/v1/hydration/settings").json()["daily_target_ml"] == 2500


# ============================================================================= notebooks
def test_notebook_lifecycle_and_wrong_ids():
    assert client.post("/api/v1/notebooks", json={"title": ""}).status_code == 422
    nb = client.post("/api/v1/notebooks", json={"title": "Riset NLP"}).json()
    nid = nb.get("id") or nb.get("notebook", {}).get("id")
    assert nid
    assert client.get("/api/v1/notebooks/9999").status_code == 404
    assert client.delete("/api/v1/notebooks/9999").status_code == 404
    assert client.post("/api/v1/notebooks/9999/sources/text", json={"title": "x", "text": "isi"}).status_code in (404, 422)
    src = client.post(f"/api/v1/notebooks/{nid}/sources/text", json={"title": "Catatan", "text": "Transformer memakai self-attention."})
    assert src.status_code == 200
    ask = client.post(f"/api/v1/notebooks/{nid}/ask", json={"question": "apa itu self-attention?"})
    assert ask.status_code == 200
    assert client.delete(f"/api/v1/notebooks/{nid}").status_code == 200
    assert client.delete(f"/api/v1/notebooks/{nid}").status_code == 404
    assert client.post(f"/api/v1/notebooks/{nid}/ask", json={"question": "masih ada?"}).status_code == 404


# ============================================================================= wardrobe
def test_wardrobe_item_lifecycle():
    ok = client.post("/api/v1/wardrobe/items", json={"id": "acc_1", "name": "Topi", "data_url": "data:image/png;base64,AAAA"})
    assert ok.status_code == 200
    assert client.get("/api/v1/wardrobe/items").json()["count"] == 1
    assert client.delete("/api/v1/wardrobe/items/acc_1").status_code == 200
    assert client.delete("/api/v1/wardrobe/items/acc_1").status_code == 404  # was a 200 "not_found"
