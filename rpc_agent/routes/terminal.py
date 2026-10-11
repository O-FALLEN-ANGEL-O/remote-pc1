"""Interactive terminal over WebSocket, backed by a real PTY.

Windows uses ConPTY via pywinpty; Linux and macOS use ptyprocess.
Client -> server: {"type": "input", "data": "..."} | {"type": "resize", "cols": n, "rows": n}
Server -> client: raw terminal output as text frames.
"""

from __future__ import annotations

import asyncio
import json
import os
import platform
import shutil
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .. import audit
from ..security import authorize_ws, client_ip

ws_router = APIRouter()
IS_WINDOWS = platform.system() == "Windows"


def available_shells() -> list[dict]:
    shells = []
    if IS_WINDOWS:
        for name, exe in (("PowerShell 7", "pwsh.exe"), ("Windows PowerShell", "powershell.exe"), ("Command Prompt", "cmd.exe")):
            if shutil.which(exe):
                shells.append({"id": exe, "name": name})
    else:
        default = os.environ.get("SHELL")
        seen = set()
        for exe in [default, "/bin/zsh", "/bin/bash", "/usr/bin/fish", "/bin/sh"]:
            if exe and exe not in seen and Path(exe).exists():
                seen.add(exe)
                shells.append({"id": exe, "name": Path(exe).name})
    return shells


def _spawn(shell: str, cols: int, rows: int):
    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    cwd = str(Path.home())
    if IS_WINDOWS:
        from winpty import PtyProcess  # pywinpty

        return PtyProcess.spawn(shell, dimensions=(rows, cols), cwd=cwd, env=env)
    from ptyprocess import PtyProcessUnicode

    argv = [shell]
    if Path(shell).name in ("bash", "zsh", "fish", "sh"):
        argv.append("-l")
    return PtyProcessUnicode.spawn(argv, dimensions=(rows, cols), cwd=cwd, env=env)


@ws_router.websocket("/ws/terminal")
async def terminal(websocket: WebSocket):
    if not await authorize_ws(websocket):
        return
    await websocket.accept()
    shells = available_shells()
    requested = websocket.query_params.get("shell")
    valid_ids = {s["id"] for s in shells}
    shell = requested if requested in valid_ids else (shells[0]["id"] if shells else ("cmd.exe" if IS_WINDOWS else "/bin/sh"))
    cols = int(websocket.query_params.get("cols", 100))
    rows = int(websocket.query_params.get("rows", 30))
    try:
        proc = await asyncio.to_thread(_spawn, shell, cols, rows)
    except Exception as exc:  # noqa: BLE001
        await websocket.send_text(f"\r\n\x1b[31mCould not start {shell}: {exc}\x1b[0m\r\n")
        await websocket.close()
        return
    ip = client_ip(websocket)
    audit.record("terminal.open", shell, ip)

    async def pump_output():
        while True:
            try:
                data = await asyncio.to_thread(proc.read, 65536)
            except EOFError:
                break
            except Exception:
                break
            if data:
                await websocket.send_text(data)
        try:
            await websocket.send_text("\r\n\x1b[90m[process exited]\x1b[0m\r\n")
            await websocket.close()
        except Exception:
            pass

    reader = asyncio.create_task(pump_output())
    try:
        while True:
            msg = json.loads(await websocket.receive_text())
            if msg.get("type") == "input":
                await asyncio.to_thread(proc.write, msg.get("data", ""))
            elif msg.get("type") == "resize":
                c, r = int(msg.get("cols", cols)), int(msg.get("rows", rows))
                if 2 <= c <= 1000 and 2 <= r <= 500:
                    proc.setwinsize(r, c)
    except (WebSocketDisconnect, RuntimeError, json.JSONDecodeError):
        pass
    finally:
        try:
            if proc.isalive():
                proc.terminate(force=True)
        except Exception:
            pass
        reader.cancel()
        audit.record("terminal.close", shell, ip)
