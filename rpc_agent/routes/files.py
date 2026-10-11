"""File manager: browse, preview, edit text, upload, download (files and zipped folders),
create, rename, delete (to the recycle bin by default) and search."""

from __future__ import annotations

import asyncio
import fnmatch
import os
import platform
import shutil
import stat
import tempfile
import time
import zipfile
from pathlib import Path

import psutil
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from .. import audit
from ..security import client_ip

router = APIRouter(prefix="/files")

IS_WINDOWS = platform.system() == "Windows"
TEXT_PREVIEW_LIMIT = 1024 * 1024  # 1 MB


def _resolve(path: str | None) -> Path:
    if not path:
        raise HTTPException(400, "Path is required")
    p = Path(os.path.expanduser(path))
    if not p.is_absolute():
        raise HTTPException(400, "Path must be absolute")
    return p


def _is_hidden(entry: os.DirEntry, st: os.stat_result | None) -> bool:
    if entry.name.startswith("."):
        return True
    if IS_WINDOWS and st is not None:
        attrs = getattr(st, "st_file_attributes", 0)
        return bool(attrs & getattr(stat, "FILE_ATTRIBUTE_HIDDEN", 2))
    return False


def _entry(entry: os.DirEntry) -> dict | None:
    try:
        is_dir = entry.is_dir()
    except OSError:
        is_dir = False
    try:
        st = entry.stat()
    except OSError:
        st = None
    return {
        "name": entry.name,
        "path": os.path.abspath(entry.path),
        "is_dir": is_dir,
        "size": (st.st_size if st and not is_dir else None),
        "modified": st.st_mtime if st else None,
        "hidden": _is_hidden(entry, st),
        "ext": "" if is_dir else Path(entry.name).suffix.lower().lstrip("."),
        "symlink": entry.is_symlink(),
    }


def _unique(dest: Path) -> Path:
    if not dest.exists():
        return dest
    stem, suffix = dest.stem, dest.suffix
    for i in range(1, 1000):
        candidate = dest.with_name(f"{stem} ({i}){suffix}")
        if not candidate.exists():
            return candidate
    raise HTTPException(409, "Too many files with that name")


def _safe_name(name: str) -> str:
    name = name.strip()
    if not name or name in (".", "..") or any(c in name for c in '/\\') or (IS_WINDOWS and any(c in name for c in ':*?"<>|')):
        raise HTTPException(400, "Invalid name")
    return name


@router.get("/roots")
def roots():
    items = []
    if IS_WINDOWS:
        for p in psutil.disk_partitions(all=False):
            entry = {"name": p.device.rstrip("\\"), "path": p.mountpoint, "kind": "drive", "total": None, "free": None}
            try:
                u = psutil.disk_usage(p.mountpoint)
                entry.update(total=u.total, free=u.free)
            except OSError:
                pass
            items.append(entry)
    else:
        u = psutil.disk_usage("/")
        items.append({"name": "/", "path": "/", "kind": "drive", "total": u.total, "free": u.free})
    home = Path.home()
    places = [("Home", home)] + [(n, home / n) for n in ("Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos")]
    for name, p in places:
        if p.is_dir():
            items.append({"name": name, "path": str(p), "kind": "place", "total": None, "free": None})
    return {"items": items, "home": str(home), "sep": os.sep}


@router.get("/list")
def list_dir(path: str):
    p = _resolve(path)
    if not p.exists():
        raise HTTPException(404, "Folder not found")
    if not p.is_dir():
        raise HTTPException(400, "Not a folder")
    try:
        with os.scandir(p) as it:
            items = [e for e in (_entry(x) for x in it) if e]
    except PermissionError:
        raise HTTPException(403, "Permission denied")
    items.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))
    parent = str(p.parent) if p.parent != p else None
    return {"path": str(p), "parent": parent, "items": items}


@router.get("/download")
def download(path: str, request: Request, inline: bool = False):
    p = _resolve(path)
    if not p.is_file():
        raise HTTPException(404, "File not found")
    if not inline:
        audit.record("file.download", str(p), client_ip(request))
    return FileResponse(p, filename=p.name, content_disposition_type="inline" if inline else "attachment")


def _zip_folder(src: Path) -> str:
    fd, tmp = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
        for root, dirs, files in os.walk(src):
            for name in files:
                full = Path(root) / name
                try:
                    zf.write(full, full.relative_to(src.parent))
                except (OSError, ValueError):
                    continue
            if not files and not dirs:
                zf.writestr(str(Path(root).relative_to(src.parent)) + "/", "")
    return tmp


@router.get("/zip")
async def download_zip(path: str, request: Request):
    p = _resolve(path)
    if not p.is_dir():
        raise HTTPException(404, "Folder not found")
    tmp = await asyncio.to_thread(_zip_folder, p)
    audit.record("file.zip", str(p), client_ip(request))
    return FileResponse(tmp, filename=f"{p.name or 'root'}.zip", background=BackgroundTask(os.remove, tmp))


@router.get("/text")
def read_text(path: str):
    p = _resolve(path)
    if not p.is_file():
        raise HTTPException(404, "File not found")
    size = p.stat().st_size
    with p.open("rb") as fh:
        raw = fh.read(TEXT_PREVIEW_LIMIT)
    if b"\x00" in raw[:8192]:
        raise HTTPException(415, "This looks like a binary file")
    return {"path": str(p), "content": raw.decode("utf-8", errors="replace"),
            "truncated": size > TEXT_PREVIEW_LIMIT, "size": size}


class TextWrite(BaseModel):
    path: str
    content: str


@router.put("/text")
def write_text(body: TextWrite, request: Request):
    p = _resolve(body.path)
    if p.exists() and p.stat().st_size > TEXT_PREVIEW_LIMIT:
        raise HTTPException(400, "File too large to edit here")
    try:
        p.write_text(body.content, encoding="utf-8", newline="")
    except PermissionError:
        raise HTTPException(403, "Permission denied")
    audit.record("file.edit", str(p), client_ip(request))
    return {"ok": True}


@router.post("/upload")
async def upload(request: Request, path: str = Form(...), files: list[UploadFile] = File(...)):
    dest_dir = _resolve(path)
    if not dest_dir.is_dir():
        raise HTTPException(404, "Destination folder not found")
    saved = []
    for f in files:
        name = _safe_name(Path(f.filename or "upload").name)
        dest = _unique(dest_dir / name)
        try:
            with dest.open("wb") as out:
                while chunk := await f.read(1024 * 1024):
                    out.write(chunk)
        except PermissionError:
            raise HTTPException(403, f"Permission denied writing {dest}")
        saved.append(str(dest))
    audit.record("file.upload", f"{len(saved)} file(s) to {dest_dir}", client_ip(request))
    return {"saved": saved}


class MkdirRequest(BaseModel):
    path: str
    name: str


@router.post("/mkdir")
def mkdir(body: MkdirRequest, request: Request):
    parent = _resolve(body.path)
    target = parent / _safe_name(body.name)
    if target.exists():
        raise HTTPException(409, "Already exists")
    try:
        target.mkdir()
    except PermissionError:
        raise HTTPException(403, "Permission denied")
    audit.record("file.mkdir", str(target), client_ip(request))
    return {"path": str(target)}


class RenameRequest(BaseModel):
    path: str
    name: str


@router.post("/rename")
def rename(body: RenameRequest, request: Request):
    src = _resolve(body.path)
    if not src.exists():
        raise HTTPException(404, "Not found")
    dest = src.with_name(_safe_name(body.name))
    if dest.exists():
        raise HTTPException(409, "A file with that name already exists")
    try:
        src.rename(dest)
    except PermissionError:
        raise HTTPException(403, "Permission denied")
    audit.record("file.rename", f"{src} -> {dest.name}", client_ip(request))
    return {"path": str(dest)}


class DeleteRequest(BaseModel):
    paths: list[str]
    permanent: bool = False


@router.post("/delete")
def delete(body: DeleteRequest, request: Request):
    results = []
    for raw in body.paths:
        p = _resolve(raw)
        if not p.exists() and not p.is_symlink():
            results.append({"path": raw, "ok": False, "error": "Not found"})
            continue
        if p.parent == p:
            results.append({"path": raw, "ok": False, "error": "Refusing to delete a drive root"})
            continue
        try:
            if body.permanent:
                if p.is_dir() and not p.is_symlink():
                    shutil.rmtree(p)
                else:
                    p.unlink()
            else:
                from send2trash import send2trash
                send2trash(str(p))
            results.append({"path": raw, "ok": True})
        except Exception as exc:  # noqa: BLE001 - report every failure to the UI
            results.append({"path": raw, "ok": False, "error": str(exc) or exc.__class__.__name__})
    ok = sum(r["ok"] for r in results)
    audit.record("file.delete", f"{ok}/{len(results)} item(s){' permanently' if body.permanent else ' to trash'}: "
                 + ", ".join(body.paths[:5]), client_ip(request), ok=ok == len(results))
    return {"results": results}


def _search(root: Path, query: str, limit: int, deadline: float):
    pattern = query if any(c in query for c in "*?[") else f"*{query}*"
    pattern = pattern.lower()
    hits = []
    for dirpath, dirnames, filenames in os.walk(root):
        if time.time() > deadline:
            return hits, True
        dirnames[:] = [d for d in dirnames if not d.startswith((".", "$")) and d not in ("node_modules", "__pycache__")]
        for name in dirnames + filenames:
            if fnmatch.fnmatch(name.lower(), pattern):
                full = os.path.join(dirpath, name)
                is_dir = name in dirnames
                try:
                    st = os.stat(full)
                    size, mtime = (None if is_dir else st.st_size), st.st_mtime
                except OSError:
                    size, mtime = None, None
                hits.append({"name": name, "path": full, "is_dir": is_dir, "size": size, "modified": mtime,
                             "hidden": name.startswith("."), "ext": "" if is_dir else Path(name).suffix.lower().lstrip("."),
                             "symlink": False})
                if len(hits) >= limit:
                    return hits, True
    return hits, False


@router.get("/search")
async def search(path: str, q: str, limit: int = 300):
    root = _resolve(path)
    if not q.strip():
        raise HTTPException(400, "Empty search")
    hits, truncated = await asyncio.to_thread(_search, root, q.strip(), min(limit, 1000), time.time() + 15)
    return {"items": hits, "truncated": truncated}
