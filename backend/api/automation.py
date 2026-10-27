"""Endpoints for the right-hand Karsa Studio automations (finance reports/news, business, projects, PRD-to-app ...)."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.core.llm_helpers import default_llm
from backend.modules.finance import news as finance_news
from backend.modules.finance import reports as finance_reports

router = APIRouter(prefix="/api/v1")


# ------------------------------------------------------------------------------------------------ finance
class ExportReportRequest(BaseModel):
    period: str | None = None
    format: str = "docx"


@router.get("/finance/monthly-report")
def monthly_report_endpoint(period: str | None = None) -> dict[str, Any]:
    try:
        return finance_reports.monthly_report(period)
    except finance_reports.ReportError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.post("/finance/monthly-report/export")
def export_monthly_report_endpoint(req: ExportReportRequest) -> dict[str, Any]:
    if req.format not in ("csv", "docx"):
        raise HTTPException(status_code=422, detail="Format harus csv atau docx.")
    try:
        out = finance_reports.export_csv(req.period) if req.format == "csv" else finance_reports.export_docx(req.period)
    except finance_reports.ReportError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {**out, "download_url": f"/api/v1/files/outputs/{out['name']}"}


@router.get("/finance/news")
async def finance_news_endpoint(limit: int = 12) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(finance_news.fetch_news, max(1, min(limit, 30)))
    except finance_news.NewsError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/finance/news/summary")
async def finance_news_summary_endpoint() -> dict[str, Any]:
    try:
        data = await asyncio.to_thread(finance_news.fetch_news, 10)
    except finance_news.NewsError as e:
        raise HTTPException(status_code=502, detail=str(e))
    summary = await asyncio.to_thread(finance_news.summarize_news, data["items"], default_llm("finance"))
    return {**summary, "items": data["items"]}


# ------------------------------------------------------------------------------------------------ studio
import threading  # noqa: E402

from backend.core.llm_helpers import llm_available  # noqa: E402
from backend.modules.studio import business, literature, prd_app, store  # noqa: E402


def _studio_error(e: store.StudioError) -> HTTPException:
    return HTTPException(status_code={"not_found": 404, "conflict": 409}.get(e.code, 400), detail=str(e))


def _llm(purpose: str):
    """A model call when at least one provider is ready, else None (every automation has an honest no-model path)."""
    return default_llm(purpose) if llm_available() else None


class ProjectCreate(BaseModel):
    kind: str
    name: str
    topic: str | None = None


@router.get("/studio/projects")
def list_projects_endpoint(kind: str | None = None) -> dict[str, Any]:
    return {"projects": store.list_projects(kind)}


@router.post("/studio/projects")
def create_project_endpoint(req: ProjectCreate) -> dict[str, Any]:
    try:
        return store.create_project(req.kind, req.name, req.topic)
    except store.StudioError as e:
        raise _studio_error(e)


@router.get("/studio/projects/{project_id}")
def get_project_endpoint(project_id: int) -> dict[str, Any]:
    try:
        return store.get_project(project_id)
    except store.StudioError as e:
        raise _studio_error(e)


@router.delete("/studio/projects/{project_id}")
def delete_project_endpoint(project_id: int) -> dict[str, Any]:
    try:
        store.delete_project(project_id)
    except store.StudioError as e:
        raise _studio_error(e)
    return {"status": "deleted"}


@router.post("/studio/projects/{project_id}/analyze")
async def analyze_project_endpoint(project_id: int) -> dict[str, Any]:
    """@Project: real literature search + novelty assessment for the project's topic."""
    try:
        p = store.get_project(project_id)
        result = await asyncio.to_thread(literature.analyze_topic, p["name"], p["topic"] or p["name"], None, _llm("research"))
    except store.StudioError as e:
        raise _studio_error(e)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return store.update_project_data(project_id, {"analysis": result})["data"]["analysis"]


class CanvasRequest(BaseModel):
    idea: str


@router.post("/studio/business/{project_id}/canvas")
async def business_canvas_endpoint(project_id: int, req: CanvasRequest) -> dict[str, Any]:
    try:
        store.get_project(project_id)
        out = await asyncio.to_thread(business.lean_canvas, req.idea, _llm("chat"))
        store.update_project_data(project_id, {"idea": req.idea.strip(), "canvas": out})
        return out
    except store.StudioError as e:
        raise _studio_error(e)


@router.post("/studio/business/{project_id}/capital")
def business_capital_endpoint(project_id: int, inputs: dict[str, Any]) -> dict[str, Any]:
    try:
        store.get_project(project_id)
        out = business.capital_plan(inputs)
        store.update_project_data(project_id, {"capital": out})
        return out
    except store.StudioError as e:
        raise _studio_error(e)


class DevelopRequest(BaseModel):
    target_dir: str


@router.post("/studio/business/{project_id}/develop")
def business_develop_endpoint(project_id: int, req: DevelopRequest) -> dict[str, Any]:
    """'Lanjut ke Developing': the business blueprint becomes a PRD and a PRD-to-App build (still needs plan approval)."""
    try:
        p = store.get_project(project_id)
        d = p["data"]
        prd = business.business_to_prd(p["name"], d.get("idea") or p["topic"] or p["name"], (d.get("canvas") or {}).get("canvas"), d.get("capital"))
        prd_prd = prd_app.validate_target(req.target_dir)
        return store.create_build(p["name"], prd, str(prd_prd), source_project_id=project_id)
    except store.StudioError as e:
        raise _studio_error(e)


# ------------------------------------------------------------------------------------------------ PRD-to-App
class BuildCreate(BaseModel):
    name: str
    prd: str
    target_dir: str


@router.get("/app-builds")
def list_builds_endpoint() -> dict[str, Any]:
    return {"builds": store.list_builds()}


@router.post("/app-builds")
def create_build_endpoint(req: BuildCreate) -> dict[str, Any]:
    try:
        target = prd_app.validate_target(req.target_dir)
        return store.create_build(req.name, req.prd, str(target))
    except store.StudioError as e:
        raise _studio_error(e)


@router.get("/app-builds/{build_id}")
def get_build_endpoint(build_id: int) -> dict[str, Any]:
    try:
        return store.get_build(build_id)
    except store.StudioError as e:
        raise _studio_error(e)


@router.post("/app-builds/{build_id}/plan")
async def plan_build_endpoint(build_id: int) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(prd_app.make_plan, build_id, _llm("code"))
    except store.StudioError as e:
        raise _studio_error(e)


@router.post("/app-builds/{build_id}/approve")
def approve_build_endpoint(build_id: int) -> dict[str, Any]:
    try:
        return prd_app.approve_plan(build_id)
    except store.StudioError as e:
        raise _studio_error(e)


@router.post("/app-builds/{build_id}/reject")
def reject_build_endpoint(build_id: int) -> dict[str, Any]:
    try:
        return prd_app.reject_plan(build_id)
    except store.StudioError as e:
        raise _studio_error(e)


@router.post("/app-builds/{build_id}/run")
def run_build_endpoint(build_id: int) -> dict[str, Any]:
    """Starts the approved build in the background; poll GET /app-builds/{id} for the log and status."""
    try:
        b = store.get_build(build_id)
        if b["status"] != "approved":
            raise store.StudioError("Setujui rencana dulu sebelum membangun.", "conflict")
    except store.StudioError as e:
        raise _studio_error(e)
    llm = _llm("code")

    def job() -> None:
        try:
            prd_app.run_build(build_id, llm)
        except Exception as e:  # keep the failure visible in the build log
            store.save_build(build_id, status="failed", log_entry={"step": "error", "ok": False, "detail": str(e)[:600]})

    threading.Thread(target=job, daemon=True, name=f"build-{build_id}").start()
    return {"status": "started", "id": build_id}


@router.delete("/app-builds/{build_id}")
def delete_build_endpoint(build_id: int) -> dict[str, Any]:
    try:
        store.delete_build(build_id)
    except store.StudioError as e:
        raise _studio_error(e)
    return {"status": "deleted"}


# ------------------------------------------------------------------------------------------------ notebook extras
from backend.modules.notebook import extras as nb_extras  # noqa: E402
from backend.modules.notebook import ml_export  # noqa: E402
from backend.modules.notebook.store import NotebookError  # noqa: E402


def _nb_http(e: NotebookError) -> HTTPException:
    status = {"not_found": 404, "too_large": 413, "no_api_key": 400}.get(getattr(e, "code", ""), 400)
    return HTTPException(status_code=status, detail=str(e))


class UrlSourceRequest(BaseModel):
    url: str


@router.post("/notebooks/{notebook_id}/sources/url")
async def add_url_source_endpoint(notebook_id: int, req: UrlSourceRequest) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(nb_extras.add_url_source, notebook_id, req.url)
    except NotebookError as e:
        raise _nb_http(e)


@router.post("/notebooks/{notebook_id}/audio-overview")
async def audio_overview_endpoint(notebook_id: int) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(nb_extras.audio_overview, notebook_id, _llm("study"))
    except NotebookError as e:
        raise _nb_http(e)


class QuizRequest(BaseModel):
    count: int = 6


@router.post("/notebooks/{notebook_id}/quiz")
async def quiz_endpoint(notebook_id: int, req: QuizRequest) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(nb_extras.generate_quiz, notebook_id, req.count, _llm("study"))
    except NotebookError as e:
        raise _nb_http(e)


# ------------------------------------------------------------------------------------------------ @Data one-click
class MlReadyRequest(BaseModel):
    shelf_id: int | None = None
    source_id: int | None = None
    target: str | None = None
    scale: str = "standard"
    encode: str = "auto"


@router.post("/studio/data/ml-ready")
async def ml_ready_endpoint(req: MlReadyRequest) -> dict[str, Any]:
    """Clean + impute + encode + scale a CSV/XLSX from the file shelf or a notebook dataset; writes new files only."""
    from pathlib import Path

    from backend.core import shelf as shelf_store
    from backend.modules.notebook import store as nb_store

    if req.shelf_id is not None:
        try:
            path, _ = shelf_store.file_path_of(req.shelf_id)
        except shelf_store.ShelfError as e:
            raise HTTPException(status_code=404, detail=str(e))
    elif req.source_id is not None:
        try:
            src = nb_store.get_source(req.source_id)
        except NotebookError as e:
            raise _nb_http(e)
        path = Path(src["path"]) if src.get("path") and src["kind"] == "dataset" else None
        if path is None or not path.exists():
            raise HTTPException(status_code=400, detail="Sumber ini bukan dataset yang tersimpan.")
    else:
        raise HTTPException(status_code=422, detail="Pilih file dari Laci (shelf_id) atau dataset Notebook (source_id).")
    if path.suffix.lower() not in (".csv", ".xlsx", ".xls"):
        raise HTTPException(status_code=415, detail="Hanya file CSV atau Excel yang bisa disiapkan.")
    try:
        out = await asyncio.to_thread(ml_export.build_ml_ready, path, req.target, req.scale, req.encode)
    except NotebookError as e:
        raise _nb_http(e)
    base = "/api/v1/files/outputs/"
    f = out["files"]
    out["downloads"] = {"ml_csv": base + f["ml_csv"], "stats_csv": base + f["stats_csv"], "stats_docx": base + f["stats_docx"], "charts": [base + c for c in f["charts"]]}
    return out


# ------------------------------------------------------------------------------------------------ @Search
class LiteratureRequest(BaseModel):
    query: str
    per_source: int = 4


@router.post("/studio/literature")
async def literature_endpoint(req: LiteratureRequest) -> dict[str, Any]:
    """Real papers from arXiv, Crossref and Semantic Scholar plus the extracted literature matrix."""
    q = req.query.strip()
    if len(q) < 3:
        raise HTTPException(status_code=422, detail="Tulis kata kunci minimal 3 huruf.")
    found = await asyncio.to_thread(literature.search_all, q, max(1, min(req.per_source, 8)))
    return {"query": q, "papers": found["papers"], "matrix": literature.literature_matrix(found["papers"]), "errors": found["errors"]}
