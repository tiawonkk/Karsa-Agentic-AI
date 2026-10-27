"""Phone companion: other devices need the pairing token, this computer needs nothing, and sync stamps detect changes."""
import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.core import mobile

local = TestClient(app)
phone = TestClient(app, client=("192.168.1.50", 40000))


def test_local_requests_need_no_token():
    assert local.get("/api/v1/health").status_code == 200
    assert local.get("/api/v1/mobile/connection").status_code == 200


def test_a_phone_without_the_token_is_refused_everywhere_in_the_api():
    for path in ("/api/v1/health", "/api/v1/tasks", "/api/v1/shelf/files", "/api/v1/approvals/pending", "/api/v1/finance/transactions", "/api/v1/mobile/ping"):
        r = phone.get(path)
        assert r.status_code == 401, path
        assert "dipasangkan" in r.json()["detail"]


def test_a_wrong_token_is_refused_and_the_right_one_works_by_header_cookie_and_query():
    tok = mobile.get_token()
    assert phone.get("/api/v1/mobile/ping", headers={"X-Karsa-Token": "salah"}).status_code == 401
    assert phone.get("/api/v1/mobile/ping", headers={"X-Karsa-Token": tok}).status_code == 200
    assert phone.get(f"/api/v1/mobile/ping?token={tok}").status_code == 200
    assert phone.get("/api/v1/mobile/ping", cookies={"karsa_token": tok}).status_code == 200


def test_pairing_info_and_settings_are_never_served_to_a_phone():
    tok = mobile.get_token()
    h = {"X-Karsa-Token": tok}
    assert phone.get("/api/v1/mobile/connection", headers=h).status_code == 403
    assert phone.post("/api/v1/mobile/token/regenerate", headers=h).status_code == 403
    assert phone.post("/api/v1/mobile/enabled", json={"enabled": False}, headers=h).status_code == 403
    assert mobile.get_token() == tok  # the token did not change


def test_proxied_requests_are_judged_by_the_forwarded_address():
    # Vite runs on this computer, so the socket is loopback; X-Forwarded-For carries the phone
    assert local.get("/api/v1/tasks", headers={"X-Forwarded-For": "192.168.1.50"}).status_code == 401
    assert local.get("/api/v1/tasks", headers={"X-Forwarded-For": "127.0.0.1"}).status_code == 200


def test_regenerating_the_token_disconnects_paired_phones():
    old = mobile.get_token()
    assert phone.get("/api/v1/mobile/ping", headers={"X-Karsa-Token": old}).status_code == 200
    assert local.post("/api/v1/mobile/token/regenerate").status_code == 200
    assert phone.get("/api/v1/mobile/ping", headers={"X-Karsa-Token": old}).status_code == 401
    assert phone.get("/api/v1/mobile/ping", headers={"X-Karsa-Token": mobile.get_token()}).status_code == 200


def test_turning_mobile_access_off_blocks_even_a_valid_token_but_not_this_computer():
    tok = mobile.get_token()
    assert local.post("/api/v1/mobile/enabled", json={"enabled": False}).json() == {"enabled": False}
    r = phone.get("/api/v1/mobile/ping", headers={"X-Karsa-Token": tok})
    assert r.status_code == 403 and "dimatikan" in r.json()["detail"]
    assert local.get("/api/v1/tasks").status_code == 200
    local.post("/api/v1/mobile/enabled", json={"enabled": True})
    assert phone.get("/api/v1/mobile/ping", headers={"X-Karsa-Token": tok}).status_code == 200


def test_token_is_long_random_and_stable_until_regenerated():
    a = mobile.get_token()
    assert len(a) >= 20 and mobile.get_token() == a
    assert mobile.regenerate_token() != a


def test_connection_info_has_a_scannable_qr_for_the_first_address(monkeypatch):
    monkeypatch.setattr(mobile, "lan_addresses", lambda: [{"interface": "Wi-Fi", "ip": "192.168.1.20", "kind": "lan"}, {"interface": "Tailscale", "ip": "100.101.102.103", "kind": "tailscale"}])
    monkeypatch.setattr(mobile, "reachable", lambda ip, port: ip.startswith("192"))
    d = local.get("/api/v1/mobile/connection").json()
    assert d["lan_reachable"] is True and d["addresses"][0]["url"].startswith("http://192.168.1.20:8765/m.html?token=")
    assert d["addresses"][1]["reachable"] is False and d["addresses"][1]["kind"] == "tailscale"
    assert d["qr_svg"].lstrip().startswith("<svg") and "path" in d["qr_svg"]
    assert d["addresses"][0]["plain"] == "http://192.168.1.20:8765/m.html"  # without the token: safe to display
    assert all(a["qr_svg"].lstrip().startswith("<svg") for a in d["addresses"])  # one scannable code per network


def test_lan_addresses_only_returns_private_or_tailscale_ipv4():
    for a in mobile.lan_addresses():
        assert a["kind"] in ("lan", "tailscale") and not a["ip"].startswith(("127.", "169.254."))


def test_sync_stamps_change_exactly_when_the_data_changes():
    before = mobile.sync_stamps()
    assert mobile.changed_areas(None, before) == list(before)  # first event lists everything
    assert mobile.changed_areas(before, mobile.sync_stamps()) == []
    local.post("/api/v1/hydration/log", json={"amount_ml": 250})
    after = mobile.sync_stamps()
    assert mobile.changed_areas(before, after) == ["hydration"]
    local.post("/api/v1/tasks", json={"title": "Tugas sinkron", "is_important": True})
    assert "tasks" in mobile.changed_areas(after, mobile.sync_stamps())
    local.post("/api/v1/finance/transactions", json={"kind": "income", "amount_idr": 50000, "merchant": "Uang saku"})
    assert "income" in mobile.changed_areas(after, mobile.sync_stamps())


def test_mobile_entry_redirects_and_keeps_the_token():
    r = local.get("/m?token=abc", follow_redirects=False)
    assert r.status_code == 307 and r.headers["location"] == "/m.html?token=abc"
