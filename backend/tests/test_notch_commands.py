"""Everything a person can create, change or undo from the notch input (@Money / @Todo), including wrong inputs."""
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.modules.finance.tools import get_budget_snapshot
from backend.orchestrator.directive_parser import parse_directive
from backend.modules.study_daily.tools import list_tasks_from_db

client = TestClient(app)


def run(text: str) -> str:
    d = parse_directive(text)
    assert d.is_directive
    return d.execution_result or ""


def ledger_items():
    return client.get("/api/v1/finance/transactions").json()["items"]


# ----------------------------------------------------------------------------- @Money
def test_plus_amount_really_saves_income():
    out = run("@Money +500k uang saku")
    assert "Pemasukan Dicatat" in out and "uang saku" in out
    assert get_budget_snapshot()["total_income_idr"] == 500_000  # used to say "berhasil dicatat" and save nothing
    assert [i["kind"] for i in ledger_items()] == ["income"]


def test_expense_then_history_then_undo_in_creation_order():
    run("@Money +500k uang saku")
    run("@Money -25k makan siang")
    hist = run("@Money riwayat")
    assert "25.000" in hist and "500.000" in hist and "#E1" in hist and "#I1" in hist
    assert "Dihapus" in run("@Money hapus terakhir")
    assert [i["kind"] for i in ledger_items()] == ["income"]  # the expense (newest) went first
    assert "Dihapus" in run("@Money hapus terakhir")
    assert "Tidak ada catatan" in run("@Money hapus terakhir")
    assert get_budget_snapshot()["total_remaining_idr"] == get_budget_snapshot()["total_capital_idr"]


def test_correct_the_last_entry_amount_and_category():
    run("@Money -250k makan siang")  # typo
    assert "Diubah" in run("@Money ubah terakhir 25k")
    assert ledger_items()[0]["amount_idr"] == 25_000
    assert "Diubah" in run("@Money ubah terakhir kategori kesenangan")
    assert ledger_items()[0]["category"] == "kesenangan"
    assert "Mau diubah jadi apa" in run("@Money ubah terakhir")
    assert "Tidak diubah" in run("@Money ubah terakhir kategori hiburan")  # not one of the five categories
    assert ledger_items()[0]["category"] == "kesenangan"  # the refused edit changed nothing
    run("@Money +10k bonus")
    assert "tidak punya kategori" in run("@Money ubah terakhir kategori makanan")  # the last entry is income


def test_wrong_money_inputs_are_explained_not_silently_ignored():
    assert "Cara memakai @Money" in run("@Money")
    assert "Tidak ada catatan" in run("@Money hapus terakhir")
    assert "Belum ada catatan" in run("@Money riwayat")
    assert "Tidak ada catatan untuk diubah" in run("@Money ubah terakhir 5k")
    assert "tidak dicatat" in run("@Money -99999999999k boros")  # absurd amount: refused with a reason
    assert ledger_items() == []


# ----------------------------------------------------------------------------- @Todo
def titles():
    return [t["title"] for t in list_tasks_from_db(status="todo")]


def test_todo_create_list_complete_edit_prioritise_delete():
    run("@Todo laprak kimia besok")
    run("@Todo tambah baca bab 3")
    lst = run("@Todo daftar")
    assert "laprak kimia" in lst and "baca bab 3" in lst
    assert "Selesai" in run("@Todo selesai baca bab")  # by a piece of the title
    assert titles() == ["laprak kimia besok"]
    tid = list_tasks_from_db(status="todo")[0]["id"]
    assert "Judul diubah" in run(f"@Todo ubah {tid} laprak kimia organik")
    assert "Q1_DO" in run(f"@Todo prioritas {tid} 1")
    assert "dihapus" in run(f"@Todo hapus {tid}")
    assert titles() == []
    assert "Tidak ada tugas yang menunggu" in run("@Todo daftar")


def test_todo_wrong_inputs():
    assert "Cara memakai @Todo" in run("@Todo")  # used to try to save an empty title
    assert "tidak disimpan" in run("@Todo " + "x" * 300)
    assert "tidak ditemukan" in run("@Todo selesai 99")
    assert "Tidak ada tugas yang cocok" in run("@Todo selesai tidak-ada")
    out = run("@Todo hapus sampah dapur")  # looks like a delete, but there is no such task
    assert "@Todo tambah hapus sampah dapur" in out and titles() == []  # nothing was created by accident


def test_todo_ambiguous_title_asks_for_the_number():
    run("@Todo laprak kimia")
    run("@Todo laprak fisika")
    out = run("@Todo selesai laprak")
    assert "beberapa yang cocok" in out and "#1" in out and "#2" in out
    assert len(titles()) == 2  # nothing was completed by guessing


def test_todo_priority_out_of_range_is_refused():
    run("@Todo tugas a")
    before = list_tasks_from_db(status="todo")[0]["quadrant"]
    assert "Tidak diubah" in run("@Todo prioritas 1 9")
    assert list_tasks_from_db(status="todo")[0]["quadrant"] == before


def test_directives_work_through_the_api_too():
    r = client.post("/api/v1/directives/parse", json={"text": "@Money +100k kiriman"})
    assert r.status_code == 200 and "Pemasukan Dicatat" in r.json()["execution_result"]
