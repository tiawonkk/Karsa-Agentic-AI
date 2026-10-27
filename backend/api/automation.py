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
