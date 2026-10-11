"""Remote desktop: screenshots, a live JPEG stream and mouse/keyboard input.

Pointer coordinates arrive normalised (0..1) relative to the chosen monitor, so
clicks land correctly however the browser scales the image.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import threading
import time

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

from .. import audit
from ..security import authorize_ws, client_ip

router = APIRouter(prefix="/screen")
ws_router = APIRouter()

_local = threading.local()


def _mss():
    sct = getattr(_local, "sct", None)
    if sct is None:
        import mss

        sct = mss.mss()
        _local.sct = sct
    return sct


def monitors() -> list[dict]:
    mons = _mss().monitors
    out = []
    for i, m in enumerate(mons):
        if i == 0 and len(mons) > 2:
            out.append({"index": 0, "name": "All displays", **{k: m[k] for k in ("left", "top", "width", "height")}})
        elif i > 0:
            out.append({"index": i, "name": f"Display {i}", "primary": i == 1,
                        **{k: m[k] for k in ("left", "top", "width", "height")}})
    return out


def _monitor(index: int) -> dict:
    mons = _mss().monitors
    if index < 0 or index >= len(mons):
        index = 1 if len(mons) > 1 else 0
    return mons[index]


_CURSOR = [(0, 0), (0, 17), (4, 13), (7, 20), (10, 19), (7, 12), (12, 12)]


def _draw_cursor(img, mon: dict) -> None:
    try:
        ctl = getattr(_local, "mouse", None)
        if ctl is None:
            from pynput.mouse import Controller

            ctl = _local.mouse = Controller()
        x, y = ctl.position
    except Exception:
        return
    cx, cy = x - mon["left"], y - mon["top"]
    if not (0 <= cx < mon["width"] and 0 <= cy < mon["height"]):
        return
    from PIL import ImageDraw

    d = ImageDraw.Draw(img)
    pts = [(cx + px, cy + py) for px, py in _CURSOR]
    d.polygon(pts, fill=(255, 255, 255), outline=(0, 0, 0))


def capture(index: int, scale: float = 1.0, quality: int = 70, fmt: str = "JPEG", cursor: bool = True) -> tuple[bytes, int, int, str]:
    from PIL import Image

    mon = _monitor(index)
    shot = _mss().grab(mon)
    raw = shot.bgra
    digest = hashlib.blake2b(raw, digest_size=16).hexdigest()
    img = Image.frombytes("RGB", shot.size, raw, "raw", "BGRX")
    if cursor:
        _draw_cursor(img, mon)
    if scale < 0.999:
        w, h = max(1, int(img.width * scale)), max(1, int(img.height * scale))
        img = img.resize((w, h), Image.BILINEAR)
    buf = io.BytesIO()
    if fmt == "PNG":
        img.save(buf, format="PNG", optimize=False)
    else:
        img.save(buf, format="JPEG", quality=quality, optimize=False)
    return buf.getvalue(), shot.width, shot.height, digest


@router.get("/monitors")
async def get_monitors():
    try:
        return await asyncio.to_thread(monitors)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"Screen capture unavailable: {exc}")


@router.get("/screenshot")
async def screenshot(request: Request, monitor: int = 1):
    try:
        data, *_ = await asyncio.to_thread(capture, monitor, 1.0, 90, "PNG", True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"Screen capture unavailable: {exc}")
    audit.record("screen.screenshot", f"display {monitor}", client_ip(request))
    return Response(data, media_type="image/png", headers={"Cache-Control": "no-store"})


@ws_router.websocket("/ws/screen")
async def screen_stream(websocket: WebSocket):
    if not await authorize_ws(websocket):
        return
    await websocket.accept()
    settings = {"monitor": 1, "fps": 10, "quality": 60, "scale": 0.75, "paused": False}
    ip = client_ip(websocket)
    audit.record("screen.view", "started", ip)

    async def read_settings():
        while True:
            msg = json.loads(await websocket.receive_text())
            if msg.get("type") == "config":
                settings["monitor"] = int(msg.get("monitor", settings["monitor"]))
                settings["fps"] = max(1, min(30, int(msg.get("fps", settings["fps"]))))
                settings["quality"] = max(10, min(95, int(msg.get("quality", settings["quality"]))))
                settings["scale"] = max(0.2, min(1.0, float(msg.get("scale", settings["scale"]))))
                settings["paused"] = bool(msg.get("paused", False))
                settings["force"] = True

    reader = asyncio.create_task(read_settings())
    last_digest = None
    last_sent = 0.0
    try:
        while not reader.done():
            start = time.monotonic()
            if not settings["paused"]:
                data, w, h, digest = await asyncio.to_thread(
                    capture, settings["monitor"], settings["scale"], settings["quality"])
                force = settings.pop("force", False)
                if force or digest != last_digest or time.monotonic() - last_sent > 2:
                    await websocket.send_text(json.dumps({"type": "frame", "width": w, "height": h,
                                                          "monitor": settings["monitor"]}))
                    await websocket.send_bytes(data)
                    last_digest, last_sent = digest, time.monotonic()
            delay = 1.0 / settings["fps"] - (time.monotonic() - start)
            await asyncio.sleep(max(0.005, delay))
    except (WebSocketDisconnect, RuntimeError):
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(exc)}))
            await websocket.close()
        except Exception:
            pass
    finally:
        reader.cancel()
        audit.record("screen.view", "stopped", ip)


# ------------------------------------------------------------------- input

_SPECIAL = {
    "Enter": "enter", "Backspace": "backspace", "Tab": "tab", "Escape": "esc", "Delete": "delete",
    "ArrowUp": "up", "ArrowDown": "down", "ArrowLeft": "left", "ArrowRight": "right",
    "Home": "home", "End": "end", "PageUp": "page_up", "PageDown": "page_down", "Insert": "insert",
    "Shift": "shift", "Control": "ctrl", "Alt": "alt", "AltGraph": "alt_gr", "Meta": "cmd", "OS": "cmd",
    "CapsLock": "caps_lock", "NumLock": "num_lock", "ScrollLock": "scroll_lock", "Pause": "pause",
    "PrintScreen": "print_screen", "ContextMenu": "menu", " ": "space",
    "ctrl": "ctrl", "alt": "alt", "shift": "shift", "win": "cmd", "cmd": "cmd", "esc": "esc",
    "tab": "tab", "delete": "delete", "enter": "enter",
}


class InputController:
    def __init__(self) -> None:
        from pynput import keyboard, mouse

        self.kb_mod = keyboard
        self.mouse_mod = mouse
        self.mouse = mouse.Controller()
        self.kb = keyboard.Controller()
        self.held: set = set()
        self.buttons: set = set()

    def key(self, name: str):
        if name in _SPECIAL:
            key = getattr(self.kb_mod.Key, _SPECIAL[name], None)
            if key is not None:
                return key
        if len(name) >= 2 and name[0] in "Ff" and name[1:].isdigit():
            return getattr(self.kb_mod.Key, name.lower(), None)
        if len(name) == 1:
            return self.kb_mod.KeyCode.from_char(name)
        return None

    def button(self, name: str):
        return getattr(self.mouse_mod.Button, name if name in ("left", "right", "middle") else "left")

    def move(self, mon: dict, x: float, y: float) -> None:
        x = min(max(x, 0.0), 1.0)
        y = min(max(y, 0.0), 1.0)
        self.mouse.position = (int(mon["left"] + x * (mon["width"] - 1)), int(mon["top"] + y * (mon["height"] - 1)))

    def handle(self, msg: dict, mon: dict) -> None:
        t = msg.get("type")
        if "x" in msg and "y" in msg and t in ("move", "down", "up", "click"):
            self.move(mon, float(msg["x"]), float(msg["y"]))
        if t == "down":
            b = self.button(msg.get("button", "left"))
            self.mouse.press(b)
            self.buttons.add(b)
        elif t == "up":
            b = self.button(msg.get("button", "left"))
            self.mouse.release(b)
            self.buttons.discard(b)
        elif t == "click":
            self.mouse.click(self.button(msg.get("button", "left")), 2 if msg.get("double") else 1)
        elif t == "scroll":
            self.mouse.scroll(int(msg.get("dx", 0)), int(msg.get("dy", 0)))
        elif t in ("keydown", "keyup", "key"):
            k = self.key(str(msg.get("key", "")))
            if k is None:
                return
            if t == "keydown":
                self.kb.press(k)
                self.held.add(k)
            elif t == "keyup":
                self.kb.release(k)
                self.held.discard(k)
            else:
                self.kb.press(k)
                self.kb.release(k)
        elif t == "text":
            self.kb.type(str(msg.get("text", ""))[:2000])
        elif t == "combo":
            keys = [self.key(str(n)) for n in msg.get("keys", [])]
            keys = [k for k in keys if k is not None]
            for k in keys:
                self.kb.press(k)
            for k in reversed(keys):
                self.kb.release(k)

    def release_all(self) -> None:
        for k in list(self.held):
            try:
                self.kb.release(k)
            except Exception:
                pass
        for b in list(self.buttons):
            try:
                self.mouse.release(b)
            except Exception:
                pass
        self.held.clear()
        self.buttons.clear()


@ws_router.websocket("/ws/input")
async def input_socket(websocket: WebSocket):
    if not await authorize_ws(websocket):
        return
    await websocket.accept()
    try:
        ctl = await asyncio.to_thread(InputController)
    except Exception as exc:  # noqa: BLE001
        await websocket.send_text(json.dumps({"type": "error", "message": f"Remote input unavailable: {exc}"}))
        await websocket.close()
        return
    ip = client_ip(websocket)
    audit.record("screen.control", "started", ip)
    monitor = 1
    mon = await asyncio.to_thread(_monitor, monitor)
    try:
        while True:
            msg = json.loads(await websocket.receive_text())
            if msg.get("type") == "monitor":
                monitor = int(msg.get("monitor", 1))
                mon = await asyncio.to_thread(_monitor, monitor)
                continue
            try:
                await asyncio.to_thread(ctl.handle, msg, mon)
            except Exception as exc:  # noqa: BLE001
                await websocket.send_text(json.dumps({"type": "error", "message": str(exc)}))
    except (WebSocketDisconnect, RuntimeError, json.JSONDecodeError):
        pass
    finally:
        await asyncio.to_thread(ctl.release_all)
        audit.record("screen.control", "stopped", ip)
