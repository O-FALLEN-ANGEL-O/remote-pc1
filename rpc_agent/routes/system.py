"""System info, live stats stream, processes and network connections."""

from __future__ import annotations

import asyncio
import os
import time

import psutil
from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from .. import audit
from ..security import authorize_ws, client_ip
from ..stats import sampler, system_info

router = APIRouter()
ws_router = APIRouter()

_info_cache: dict | None = None
_info_at = 0.0


@router.get("/system/info")
def get_info():
    global _info_cache, _info_at
    if _info_cache is None or time.time() - _info_at > 30:
        _info_cache, _info_at = system_info(), time.time()
    return _info_cache


@router.get("/system/stats")
async def get_stats():
    if sampler.latest is None:
        await asyncio.wait_for(sampler.wait_next(), timeout=5)
    return sampler.latest


@router.get("/system/history")
def get_history():
    return list(sampler.history)


@ws_router.websocket("/ws/stats")
async def stats_stream(websocket: WebSocket):
    if not await authorize_ws(websocket):
        return
    await websocket.accept()
    try:
        if sampler.latest:
            await websocket.send_json(sampler.latest)
        while True:
            snap = await sampler.wait_next()
            await websocket.send_json(snap)
    except (WebSocketDisconnect, RuntimeError):
        pass


# ---------------------------------------------------------------- processes

_PROC_ATTRS = ["pid", "name", "username", "cpu_percent", "memory_info", "memory_percent",
               "status", "create_time", "num_threads", "exe"]


def _list_processes():
    cores = psutil.cpu_count() or 1
    out = []
    for p in psutil.process_iter(_PROC_ATTRS, ad_value=None):
        info = p.info
        mem = info.get("memory_info")
        out.append({
            "pid": info["pid"],
            "name": info.get("name") or "?",
            "user": (info.get("username") or "").split("\\")[-1] or None,
            "cpu": round((info.get("cpu_percent") or 0.0) / cores, 1),
            "rss": mem.rss if mem else 0,
            "mem_percent": round(info.get("memory_percent") or 0.0, 2),
            "status": info.get("status"),
            "started": info.get("create_time"),
            "threads": info.get("num_threads"),
            "exe": info.get("exe"),
        })
    return out


@router.get("/processes")
async def processes():
    return await asyncio.to_thread(_list_processes)


class KillRequest(BaseModel):
    force: bool = False


@router.post("/processes/{pid}/kill")
def kill_process(pid: int, body: KillRequest, request: Request):
    if pid in (0, os.getpid()):
        raise HTTPException(400, "Refusing to end this process")
    try:
        p = psutil.Process(pid)
        name = p.name()
        if body.force:
            p.kill()
        else:
            p.terminate()
        try:
            p.wait(timeout=3)
        except psutil.TimeoutExpired:
            pass
    except psutil.NoSuchProcess:
        raise HTTPException(404, "Process not found")
    except psutil.AccessDenied:
        audit.record("process.kill", f"{pid} denied", client_ip(request), ok=False)
        raise HTTPException(403, "Access denied (try running the agent as administrator)")
    audit.record("process.kill", f"{name} ({pid}){' force' if body.force else ''}", client_ip(request))
    return {"ok": True, "running": psutil.pid_exists(pid)}


# --------------------------------------------------------------- connections

def _connections():
    names: dict[int, str] = {}
    try:
        conns = psutil.net_connections(kind="inet")
    except psutil.AccessDenied:
        return {"error": "Listing connections needs administrator rights on this OS.", "items": []}
    items = []
    for c in conns:
        pid = c.pid
        if pid and pid not in names:
            try:
                names[pid] = psutil.Process(pid).name()
            except Exception:
                names[pid] = "?"
        items.append({
            "proto": "tcp" if c.type == 1 else "udp",
            "laddr": f"{c.laddr.ip}:{c.laddr.port}" if c.laddr else "",
            "raddr": f"{c.raddr.ip}:{c.raddr.port}" if c.raddr else "",
            "status": c.status if c.status != "NONE" else "",
            "pid": pid,
            "process": names.get(pid) if pid else None,
        })
    items.sort(key=lambda x: (x["status"] != "ESTABLISHED", x["status"] != "LISTEN", x["laddr"]))
    return {"error": None, "items": items[:1000]}


@router.get("/network/connections")
async def connections():
    return await asyncio.to_thread(_connections)
