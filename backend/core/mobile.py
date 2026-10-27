"""Phone companion: pairing token, LAN/Tailscale addresses, QR code, and the change stamps behind live sync.

Security model: the API is only ever served to other devices with the pairing token. Requests from this computer
(loopback) need nothing; any other client must send the token (header, cookie, or `token=` query for SSE). The token is
shown only to the local user (Settings > Koneksi HP) inside the QR code and can be regenerated at any time, which
immediately disconnects every paired phone.
"""
from __future__ import annotations

import hmac
import ipaddress
import secrets
import socket
from typing import Any

from backend.core.config import settings
from backend.core.database import get_db_cursor, get_system_setting, set_system_setting

TOKEN_KEY = "mobile.token"
ENABLED_KEY = "mobile.enabled"
LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}


def is_local(host: str | None) -> bool:
    if not host:
        return False
    if host in LOCAL_HOSTS:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def get_token() -> str:
    tok = get_system_setting(TOKEN_KEY, "")
    if not tok or len(str(tok)) < 16:
        tok = regenerate_token()
    return str(tok)


def regenerate_token() -> str:
    tok = secrets.token_urlsafe(18)
    set_system_setting(TOKEN_KEY, tok)
    return tok


def token_ok(candidate: str | None) -> bool:
    return bool(candidate) and hmac.compare_digest(str(candidate), get_token())


def is_enabled() -> bool:
    v = get_system_setting(ENABLED_KEY, True)
    return v is not False and str(v).lower() not in ("false", "0", "off")


def set_enabled(value: bool) -> None:
    set_system_setting(ENABLED_KEY, bool(value))


def lan_addresses() -> list[dict[str, str]]:
    """IPv4 addresses of this computer that a phone could reach, labelled wifi/lan or tailscale."""
    import psutil

    out: list[dict[str, str]] = []
    stats = psutil.net_if_stats()
    for name, addrs in psutil.net_if_addrs().items():
        st = stats.get(name)
        if st is not None and not st.isup:
            continue
        for a in addrs:
            if a.family != socket.AF_INET:
                continue
            try:
                ip = ipaddress.ip_address(a.address)
            except ValueError:
                continue
            if ip.is_loopback or ip.is_link_local or ip.is_unspecified:
                continue
            kind = "tailscale" if ip in ipaddress.ip_network("100.64.0.0/10") else "lan"
            if kind == "lan" and not ip.is_private:
                continue
            out.append({"interface": name, "ip": a.address, "kind": kind})
    out.sort(key=lambda x: (x["kind"] != "lan", x["interface"]))
    return out


def pairing_urls(port: int | None = None, addresses: list[dict[str, str]] | None = None) -> list[dict[str, str]]:
    port = port or settings.port
    tok = get_token()
    return [{**a, "url": f"http://{a['ip']}:{port}/m.html?token={tok}", "plain": f"http://{a['ip']}:{port}/m.html"} for a in (addresses if addresses is not None else lan_addresses())]


def qr_svg(text: str) -> str:
    import segno

    import io

    buf = io.BytesIO()
    segno.make(text, error="m").save(buf, kind="svg", scale=6, border=2, xmldecl=False, svgns=True, nl=False)
    return buf.getvalue().decode("utf-8")


# ----------------------------------------------------------------------------------------------- live sync stamps
def sync_stamps() -> dict[str, str]:
    """One cheap fingerprint per data area. When a fingerprint changes, clients refetch that area."""
    q = {
        "tasks": "SELECT COUNT(*) || ':' || COALESCE(SUM(status='done'),0) || ':' || COALESCE(MAX(id),0) || ':' || COALESCE(SUM(LENGTH(title)),0) || ':' || COALESCE(SUM(is_urgent*3+is_important*5),0) || ':' || COALESCE(MAX(completed_at),'') || ':' || COALESCE(SUM(status='dropped'),0) FROM tasks",
        "hydration": "SELECT COUNT(*) || ':' || COALESCE(MAX(id),0) FROM hydration_logs",
        "expenses": "SELECT COUNT(*) || ':' || COALESCE(MAX(id),0) || ':' || COALESCE(SUM(amount_idr),0) FROM financial_transactions",
        "income": "SELECT COUNT(*) || ':' || COALESCE(MAX(id),0) || ':' || COALESCE(SUM(amount_idr),0) FROM financial_income",
        "approvals": "SELECT COUNT(*) || ':' || COALESCE(SUM(decision IS NULL),0) || ':' || COALESCE(MAX(requested_at),'') || ':' || COALESCE(MAX(decided_at),'') FROM hitl_approvals",
        "shelf": "SELECT COUNT(*) || ':' || COALESCE(MAX(id),0) FROM shelf_files",
    }
    out: dict[str, str] = {}
    with get_db_cursor() as cur:
        for k, sql in q.items():
            try:
                cur.execute(sql)
                out[k] = str(cur.fetchone()[0])
            except Exception:
                out[k] = "?"
    return out


def changed_areas(prev: dict[str, str] | None, now: dict[str, str]) -> list[str]:
    return list(now) if prev is None else [k for k, v in now.items() if prev.get(k) != v]


def reachable(ip: str, port: int) -> bool:
    """Does the Karsa server answer on this address? (False means it is bound to 127.0.0.1 only, or a firewall blocks it.)"""
    try:
        with socket.create_connection((ip, port), timeout=0.6):
            return True
    except OSError:
        return False


def connection_info(port: int | None = None) -> dict[str, Any]:
    port = port or settings.port
    urls = pairing_urls(port)
    for u in urls:
        u["reachable"] = reachable(u["ip"], port)
        u["qr_svg"] = qr_svg(u["url"])
    return {
        "enabled": is_enabled(),
        "port": port,
        "lan_reachable": any(u["reachable"] for u in urls),
        "addresses": urls,
        "qr_svg": qr_svg(urls[0]["url"]) if urls else None,
    }
