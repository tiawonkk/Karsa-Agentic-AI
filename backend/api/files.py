"""Real file uploads, the active project folder and the native folder dialog."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from backend.api.mobile import client_host
from backend.core import files as files_core
from backend.core import mobile
from backend.core import project_folder as pf
from backend.core.config import settings

router = APIRouter()


def _local_only(request: Request) -> None:
    """Opening dialogs and folders happens on the laptop; a paired phone must not be able to trigger it."""
    if not mobile.is_local(client_host(request)):
        raise HTTPException(status_code=403, detail="Hanya bisa dilakukan dari komputer ini.")


def _folder_http(e: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail=str(e))


def _upload_http(e: files_core.UploadError) -> HTTPException:
    return HTTPException(status_code=e.status, detail=str(e))


# ------------------------------------------------------------------------------------------------ uploads
@router.post("/api/files/upload")
@router.post("/api/v1/files/upload")
async def upload_file_endpoint(kind: str = Form("chat"), file: UploadFile = File(...)) -> dict[str, Any]:
    """Save an uploaded file. `prd` also returns the extracted text + outline, `dataset` a real preview of the original."""
    data = await file.read()
    try:
        path = files_core.save_upload(kind, file.filename or "berkas", data)
        out: dict[str, Any] = {"kind": kind, "name": path.name, "path": str(path), "size": len(data)}
        if kind == "prd":
            out.update(await asyncio.to_thread(files_core.extract_prd, path))
        elif kind == "dataset":
            out["preview"] = await asyncio.to_thread(files_core.dataset_preview, path)
        return out
    except files_core.UploadError as e:
        raise _upload_http(e)


class CleanRequest(BaseModel):
    path: str
    options: dict[str, Any] | None = None
    save_to_project: bool = True
    formats: list[str] = ["csv", "xlsx"]


@router.post("/api/v1/files/dataset/clean")
async def clean_uploaded_dataset_endpoint(req: CleanRequest) -> dict[str, Any]:
    """Clean an uploaded dataset. Results go to the active project folder (or Karsa's outputs folder if none is set)."""
    try:
        src = files_core.resolve_upload(req.path)
        if src.suffix.lower() not in (".csv", ".xlsx", ".xls", ".json"):
            raise files_core.UploadError("Hanya dataset (.csv, .xlsx, .xls, .json) yang bisa dibersihkan.", 415)
        folder = pf.get_folder() if req.save_to_project else None
        out_dir = Path(folder) if folder else settings.outputs_dir
        fmts = tuple(f for f in req.formats if f in ("csv", "xlsx")) or ("csv",)
        report = await asyncio.to_thread(files_core.clean_dataset, src, req.options, out_dir, fmts)
    except files_core.UploadError as e:
        raise _upload_http(e)
    except Exception as e:  # NotebookError from the cleaner carries a user-facing message
        raise HTTPException(status_code=422, detail=str(e))
    report["saved_in"] = str(out_dir)
    report["in_project_folder"] = bool(folder)
    return report


# ------------------------------------------------------------------------------------------------ project folder
class FolderRequest(BaseModel):
    path: str


class NewFolderRequest(BaseModel):
    name: str
    parent: str | None = None


class OpenFolderRequest(BaseModel):
    path: str | None = None
    app: str = "explorer"  # explorer | vscode


@router.get("/api/v1/project/folder")
def get_project_folder_endpoint() -> dict[str, Any]:
    return {"path": pf.get_folder()}


@router.put("/api/v1/project/folder")
def set_project_folder_endpoint(req: FolderRequest, request: Request) -> dict[str, Any]:
    _local_only(request)
    try:
        return {"path": pf.set_folder(req.path)}
    except pf.FolderError as e:
        raise _folder_http(e)


@router.delete("/api/v1/project/folder")
def clear_project_folder_endpoint(request: Request) -> dict[str, Any]:
    _local_only(request)
    pf.clear_folder()
    return {"path": None}


@router.post("/api/v1/project/folder/create")
def create_project_folder_endpoint(req: NewFolderRequest, request: Request) -> dict[str, Any]:
    """Create `<parent or active folder>/<name>` and make it the active project folder."""
    _local_only(request)
    try:
        return {"path": pf.create_subfolder(req.name, req.parent)}
    except pf.FolderError as e:
        raise _folder_http(e)


@router.post("/api/system/pick-folder")
@router.post("/api/v1/system/pick-folder")
async def pick_folder_endpoint(request: Request) -> dict[str, Any]:
    """Native Windows folder dialog. The chosen folder becomes the active project folder."""
    _local_only(request)
    try:
        chosen = await asyncio.to_thread(pf.pick_folder_dialog, pf.get_folder())
        if not chosen:
            return {"path": None, "cancelled": True}
        return {"path": pf.set_folder(chosen), "cancelled": False}
    except pf.FolderError as e:
        raise _folder_http(e)


@router.get("/api/system/list-dirs")
@router.get("/api/v1/system/list-dirs")
def list_dirs_endpoint(request: Request, path: str | None = None) -> dict[str, Any]:
    _local_only(request)
    try:
        return pf.list_dirs(path)
    except pf.FolderError as e:
        raise _folder_http(e)


@router.post("/api/v1/system/open-folder")
def open_folder_endpoint(req: OpenFolderRequest, request: Request) -> dict[str, Any]:
    _local_only(request)
    target = req.path or pf.get_folder()
    if not target:
        raise HTTPException(status_code=400, detail="Belum ada folder project yang dipilih.")
    try:
        (pf.open_in_vscode if req.app == "vscode" else pf.open_in_explorer)(target)
    except pf.FolderError as e:
        raise _folder_http(e)
    return {"opened": target, "app": req.app}
