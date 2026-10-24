from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.core.config import settings
from backend.core.database import initialize_master_database

client = TestClient(app)


def test_api_health():
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"


def test_api_system_hardware():
    resp = client.get("/api/v1/system/hardware")
    assert resp.status_code == 200
    data = resp.json()
    assert "mode" in data
    assert "ram_total_gb" in data


def test_api_system_sleep():
    resp = client.post("/api/v1/system/sleep")
    assert resp.status_code == 200
    data = resp.json()
    assert "status" in data


def test_api_model_settings_and_hot_swap(tmp_path: Path, monkeypatch):
    test_db = tmp_path / "test_api_models.db"
    initialize_master_database(test_db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    # 1. GET models
    resp_get = client.get("/api/v1/settings/models")
    assert resp_get.status_code == 200
    models_data = resp_get.json()
    assert "tier1_utility" in models_data

    # 2. PUT hot-swap
    resp_put = client.put(
        "/api/v1/settings/models",
        json={
            "tier": "tier1_utility",
            "provider": "groq",
            "model": "llama-3.3-70b-versatile",
            "temperature": 0.15,
        },
    )
    assert resp_put.status_code == 200
    assert resp_put.json()["status"] == "updated"


def test_api_chat(tmp_path: Path, monkeypatch):
    test_db = tmp_path / "test_api_chat.db"
    initialize_master_database(test_db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    resp = client.post(
        "/api/v1/chat",
        json={"message": "halo karsa apa kabar"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "thread_id" in data
    assert "response" in data


def test_api_screen_capture():
    # Privacy consent = False should return status error
    resp_no_consent = client.post(
        "/api/v1/screen/capture",
        json={"user_consented": False},
    )
    assert resp_no_consent.status_code == 200
    data = resp_no_consent.json()
    assert data["status"] == "error"


def test_api_dynamic_island_v3_endpoints(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    initialize_master_database(settings.master_db_path)

    # 1. Focus session
    resp_f_log = client.post(
        "/api/v1/focus/sessions/log",
        json={"duration_minutes": 25, "session_type": "focus"},
    )
    assert resp_f_log.status_code == 200
    assert resp_f_log.json()["status"] == "logged"

    resp_f_list = client.get("/api/v1/focus/sessions")
    assert resp_f_list.status_code == 200
    assert len(resp_f_list.json()["sessions"]) >= 1

    # 2. Hydration
    resp_h_log = client.post(
        "/api/v1/hydration/log",
        json={"amount_ml": 250, "daily_target_ml": 2000},
    )
    assert resp_h_log.status_code == 200
    assert resp_h_log.json()["status"] == "logged"

    resp_h_today = client.get("/api/v1/hydration/today")
    assert resp_h_today.status_code == 200
    assert resp_h_today.json()["total_ml"] == 250
    assert len(resp_h_today.json()["hourly_chart"]) == 13

    # 2b. Hydration settings persist in SQLite and drive the summary target
    resp_hs = client.get("/api/v1/hydration/settings")
    assert resp_hs.status_code == 200
    assert resp_hs.json() == {
        "daily_target_ml": 2000, "glass_ml": 250, "interval_minutes": 120, "reminder_enabled": True,
    }
    resp_hs_put = client.put(
        "/api/v1/hydration/settings",
        json={"daily_target_ml": 2500, "interval_minutes": 90, "reminder_enabled": False},
    )
    assert resp_hs_put.status_code == 200
    assert resp_hs_put.json()["glass_ml"] == 250  # untouched field kept
    assert client.get("/api/v1/hydration/settings").json() == {
        "daily_target_ml": 2500, "glass_ml": 250, "interval_minutes": 90, "reminder_enabled": False,
    }
    assert client.get("/api/v1/hydration/today").json()["target_ml"] == 2500
    assert client.put("/api/v1/hydration/settings", json={"interval_minutes": 0}).status_code == 422

    # 3. Shelf files
    resp_s_add = client.post(
        "/api/v1/shelf/files",
        json={"file_path": "D:/test.pdf", "file_name": "test.pdf", "file_type": "application/pdf"},
    )
    assert resp_s_add.status_code == 200
    file_id = resp_s_add.json()["file"]["id"]

    resp_s_list = client.get("/api/v1/shelf/files")
    assert resp_s_list.status_code == 200
    assert len(resp_s_list.json()["files"]) >= 1

    resp_s_del = client.delete(f"/api/v1/shelf/files/{file_id}")
    assert resp_s_del.status_code == 200
    assert resp_s_del.json()["status"] == "deleted"

    # 4. Apps search
    resp_apps = client.get("/api/v1/system/apps?q=code")
    assert resp_apps.status_code == 200
    assert "apps" in resp_apps.json()

    # 5. Thread state
    resp_state = client.get("/api/v1/threads/thread_test_123/state")
    assert resp_state.status_code == 200
    assert resp_state.json()["thread_id"] == "thread_test_123"

    # 6. Launch App (mocked)
    with patch("os.startfile", create=True) as mock_startfile:
        resp_launch = client.post("/api/v1/system/apps/launch", json={"path": "calc.lnk"})
        assert resp_launch.status_code == 200
        assert resp_launch.json()["status"] in ["launched", "error"]

    # 7. Hardware hooks endpoints
    resp_screen = client.get("/api/v1/system/screen")
    assert resp_screen.status_code == 200
    assert "width" in resp_screen.json()

    resp_vol = client.get("/api/v1/system/volume")
    assert resp_vol.status_code == 200
    assert "level" in resp_vol.json()

    resp_bright = client.get("/api/v1/system/brightness")
    assert resp_bright.status_code == 200
    assert "level" in resp_bright.json()

    resp_bat = client.get("/api/v1/system/battery")
    assert resp_bat.status_code == 200
    assert "percent" in resp_bat.json()

    resp_locks = client.get("/api/v1/system/lock-keys")
    assert resp_locks.status_code == 200
    assert "caps_lock" in resp_locks.json()

    # 8. Model Tier Hot-Swap & Settings
    resp_model_put = client.put(
        "/api/v1/settings/models",
        json={
            "tier": "tier1_utility",
            "provider": "gemini",
            "model": "gemini-3.8-flash",
            "temperature": 0.2,
        },
    )
    assert resp_model_put.status_code == 200
    assert resp_model_put.json()["status"] == "updated"

    # 9. Real Token & Cost Analytics
    resp_tokens = client.get("/api/v1/system/tokens/analytics")
    assert resp_tokens.status_code == 200
    assert "totals" in resp_tokens.json()
    assert "total_cost_idr" in resp_tokens.json()["totals"]

    # 10. Tasks API (Zero Dummy Data)
    resp_task_add = client.post(
        "/api/v1/tasks",
        json={"title": "Mengerjakan Tugas Besar AI", "is_urgent": True, "is_important": True},
    )
    assert resp_task_add.status_code == 200
    task_id = resp_task_add.json()["task"]["id"]

    resp_task_list = client.get("/api/v1/tasks")
    assert resp_task_list.status_code == 200
    assert len(resp_task_list.json()["tasks"]) >= 1

    resp_task_done = client.post(f"/api/v1/tasks/{task_id}/complete")
    assert resp_task_done.status_code == 200
    assert resp_task_done.json()["status"] == "completed"

    # 11. Finance Report API
    resp_fin = client.get("/api/v1/finance/report")
    assert resp_fin.status_code == 200
    assert "snapshot" in resp_fin.json()
    assert "transactions" in resp_fin.json()

    # 12. Wardrobe Items API
    resp_w_save = client.post(
        "/api/v1/wardrobe/items",
        json={
            "id": "hat_test_1",
            "name": "Topi Wisuda",
            "data_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            "anchor_type": "head_top",
            "is_active": True,
        },
    )
    assert resp_w_save.status_code == 200
    assert resp_w_save.json()["status"] == "saved"

    resp_w_list = client.get("/api/v1/wardrobe/items")
    assert resp_w_list.status_code == 200
    assert resp_w_list.json()["count"] >= 1

    resp_w_del = client.delete("/api/v1/wardrobe/items/hat_test_1")
    assert resp_w_del.status_code == 200
    assert resp_w_del.json()["status"] == "deleted"

    # 13. Health Models API (Instruction 5)
    resp_health = client.get("/api/health/models")
    assert resp_health.status_code == 200
    assert resp_health.json()["status"] == "healthy"
    assert "database" in resp_health.json()
    assert "badge" in resp_health.json()

    # 14. Model Auto-Router & Override API (Instruction 4)
    resp_route_daily = client.get("/api/models/route?task=money")
    assert resp_route_daily.status_code == 200
    assert resp_route_daily.json()["specialization"] == "daily_and_finance"
    assert resp_route_daily.json()["provider"] == "gemini"

    resp_route_code = client.get("/api/models/route?task=code")
    assert resp_route_code.status_code == 200
    assert resp_route_code.json()["specialization"] == "research_and_code"

    resp_override = client.post(
        "/api/models/override",
        json={"task": "code", "provider": "deepseek", "model": "deepseek-coder", "temperature": 0.1},
    )
    assert resp_override.status_code == 200
    assert resp_override.json()["status"] == "success"

    # 15. Chat Balance Inquiry via SQLite (Instruction 1)
    resp_chat = client.post(
        "/api/chat",
        json={"message": "uang saya berapa skrg"},
    )
    assert resp_chat.status_code == 200
    reply = resp_chat.json().get("response") or resp_chat.json().get("text")
    assert "Total modalmu bulan ini" in reply
    assert "sudah terpakai" in reply
    assert "sisa belanja amanmu hari ini adalah" in reply





def test_api_theme_setting_roundtrip(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    initialize_master_database(settings.master_db_path)

    assert client.get("/api/v1/settings/theme").json() == {"mode": "system"}
    assert client.put("/api/v1/settings/theme", json={"mode": "dark"}).json() == {"mode": "dark"}
    assert client.get("/api/v1/settings/theme").json() == {"mode": "dark"}
    assert client.put("/api/v1/settings/theme", json={"mode": "light"}).status_code == 200
    assert client.get("/api/v1/settings/theme").json() == {"mode": "light"}
    assert client.put("/api/v1/settings/theme", json={"mode": "neon"}).status_code == 422
