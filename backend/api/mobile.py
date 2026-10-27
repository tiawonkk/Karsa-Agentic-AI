"""Phone companion API: pairing info, the access guard for non-local clients, and the live-sync event stream."""
from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from backend.core import mobile

router = APIRouter()


def client_host(request: Request) -> str | None:
    """The real caller: a dev proxy (Vite) runs on this computer, so its X-Forwarded-For wins over the loopback socket."""
    fwd = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if fwd:
        return fwd
    return request.client.host if request.client else None


def request_token(request: Request) -> str | None:
    return request.headers.get("x-karsa-token") or request.cookies.get("karsa_token") or request.query_params.get("token")


async def mobile_guard(request: Request, call_next):
    """Requests from this computer pass. Any other device needs the pairing token for /api/, and nothing else is exposed."""
    if request.url.path.startswith("/api/") and not mobile.is_local(client_host(request)):
        if not await asyncio.to_thread(mobile.is_enabled):
            return JSONResponse({"detail": "Akses dari HP dimatikan di Settings > Koneksi HP."}, status_code=403)
        if not await asyncio.to_thread(mobile.token_ok, request_token(request)):
            return JSONResponse({"detail": "Perangkat belum dipasangkan. Pindai ulang kode QR dari Settings > Koneksi HP."}, status_code=401)
    return await call_next(request)


def _local_only(request: Request) -> None:
    if not mobile.is_local(client_host(request)):
        raise HTTPException(status_code=403, detail="Hanya bisa dibuka dari komputer ini.")


@router.get("/api/v1/mobile/connection")
async def connection_endpoint(request: Request) -> dict[str, Any]:
    _local_only(request)
    return await asyncio.to_thread(mobile.connection_info)


class EnabledRequest(BaseModel):
    enabled: bool


@router.post("/api/v1/mobile/enabled")
def set_enabled_endpoint(req: EnabledRequest, request: Request) -> dict[str, Any]:
    _local_only(request)
    mobile.set_enabled(req.enabled)
    return {"enabled": mobile.is_enabled()}


@router.post("/api/v1/mobile/token/regenerate")
def regenerate_endpoint(request: Request) -> dict[str, Any]:
    """A new token: every phone paired before is disconnected at once."""
    _local_only(request)
    mobile.regenerate_token()
    return {"status": "regenerated"}


@router.get("/api/v1/mobile/ping")
def ping_endpoint() -> dict[str, Any]:
    """Lets the phone app check that its token works (the guard already ran)."""
    return {"status": "ok"}


@router.get("/api/v1/sync/stream")
async def sync_stream(request: Request) -> EventSourceResponse:
    """Server-sent events: `sync` carries the list of data areas that changed (tasks, hydration, expenses, ...)."""

    async def gen():
        prev: dict[str, str] | None = None
        while True:
            if await request.is_disconnected():
                break
            now = await asyncio.to_thread(mobile.sync_stamps)
            changed = mobile.changed_areas(prev, now)
            if changed:
                yield {"event": "sync", "data": json.dumps({"areas": changed, "initial": prev is None})}
            prev = now
            await asyncio.sleep(2.0)

    return EventSourceResponse(gen())


@router.get("/m")
def mobile_entry(request: Request) -> RedirectResponse:
    q = request.url.query
    return RedirectResponse(url="/m.html" + (f"?{q}" if q else ""), status_code=307)
