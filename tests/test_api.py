"""End-to-end API checks against a running agent.

    RPC_DRY_RUN=1 python agent.py --no-browser --port 8765 &
    python tests/test_api.py http://127.0.0.1:8765 <token>

Power actions are only safe to test with RPC_DRY_RUN=1.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

import httpx
import websockets

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765"
TOKEN = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("RPC_TOKEN", "")
WS = BASE.replace("http", "ws", 1)
passed, failed = 0, []


def check(name: str, cond: bool, info: str = "") -> None:
    global passed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed.append(name)
        print(f"  FAIL {name} {info}")


def main() -> None:
    anon = httpx.Client(base_url=BASE, timeout=30)
    print("auth")
    protected = [("GET", "/api/system/info"), ("GET", "/api/processes"), ("GET", "/api/files/roots"),
                 ("GET", "/api/screen/screenshot"), ("POST", "/api/power/shutdown"), ("GET", "/api/clipboard"),
                 ("GET", "/api/settings"), ("GET", "/api/audit"), ("POST", "/api/auth/rotate")]
    for method, path in protected:
        r = anon.request(method, path)
        check(f"anonymous {method} {path} -> 401", r.status_code == 401, str(r.status_code))
    check("config.json not served", "token" not in anon.get("/config.json").text)
    check("agent source not served", "import" not in anon.get("/agent.py").text)
    check("status anonymous", anon.get("/api/auth/status").json() == {"authenticated": False})
    r = anon.post("/api/auth/login", json={"token": "nope"})
    check("wrong token -> 401", r.status_code == 401)
    r = anon.post("/api/auth/login", json={"token": TOKEN}, headers={"Origin": "http://evil.example"})
    check("cross-origin login refused", r.status_code == 403, str(r.status_code))

    s = httpx.Client(base_url=BASE, timeout=60)
    r = s.post("/api/auth/login", json={"token": TOKEN})
    check("login", r.status_code == 200 and "rpc_session" in s.cookies, r.text)
    check("cookie httponly+strict", "httponly" in r.headers.get("set-cookie", "").lower()
          and "samesite=strict" in r.headers.get("set-cookie", "").lower())
    check("status authed", s.get("/api/auth/status").json().get("authenticated") is True)
    r = s.post("/api/media/play_pause", headers={"Origin": "http://evil.example"})
    check("cross-origin POST with cookie refused", r.status_code == 403)
    bearer = httpx.Client(base_url=BASE, headers={"Authorization": f"Bearer {TOKEN}"}, timeout=30)
    check("bearer token works", bearer.get("/api/system/info").status_code == 200)

    print("system")
    info = s.get("/api/system/info").json()
    check("info hostname/cpu", bool(info.get("hostname")) and bool(info.get("cpu_model")) and info["cores_logical"] > 0)
    stats = s.get("/api/system/stats").json()
    check("stats shape", {"cpu", "memory", "disks", "net", "uptime"} <= set(stats))
    check("history", isinstance(s.get("/api/system/history").json(), list))
    procs = s.get("/api/processes").json()
    check("processes", len(procs) > 3 and {"pid", "name", "cpu", "rss"} <= set(procs[0]))
    conns = s.get("/api/network/connections").json()
    check("connections", "items" in conns)

    print("processes: kill")
    import subprocess
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    r = s.post(f"/api/processes/{child.pid}/kill", json={"force": False})
    child.wait(timeout=5)
    check("kill process", r.status_code == 200 and child.poll() is not None, r.text)

    print("files")
    roots = s.get("/api/files/roots").json()
    check("roots", len(roots["items"]) >= 1)
    tmp = Path(tempfile.mkdtemp(prefix="rpc-test-"))
    r = s.post("/api/files/mkdir", json={"path": str(tmp), "name": "sub"})
    check("mkdir", r.status_code == 200 and (tmp / "sub").is_dir())
    r = s.post("/api/files/upload", data={"path": str(tmp / "sub")},
               files=[("files", ("hello.txt", b"hello world", "text/plain")), ("files", ("hello.txt", b"again", "text/plain"))])
    check("upload x2 (no overwrite)", r.status_code == 200 and (tmp / "sub" / "hello (1).txt").exists(), r.text)
    listing = s.get("/api/files/list", params={"path": str(tmp / "sub")}).json()
    check("list", sorted(i["name"] for i in listing["items"]) == ["hello (1).txt", "hello.txt"])
    t = s.get("/api/files/text", params={"path": str(tmp / "sub" / "hello.txt")}).json()
    check("read text", t["content"] == "hello world")
    s.put("/api/files/text", json={"path": str(tmp / "sub" / "hello.txt"), "content": "edited"})
    check("write text", (tmp / "sub" / "hello.txt").read_text() == "edited")
    r = s.get("/api/files/download", params={"path": str(tmp / "sub" / "hello.txt")})
    check("download", r.content == b"edited" and "attachment" in r.headers.get("content-disposition", ""))
    r = s.get("/api/files/zip", params={"path": str(tmp / "sub")})
    check("zip folder", r.status_code == 200 and r.content[:2] == b"PK")
    r = s.post("/api/files/rename", json={"path": str(tmp / "sub" / "hello (1).txt"), "name": "renamed.txt"})
    check("rename", (tmp / "sub" / "renamed.txt").exists())
    r = s.post("/api/files/rename", json={"path": str(tmp / "sub" / "renamed.txt"), "name": "../escape.txt"})
    check("rename rejects traversal", r.status_code == 400)
    found = s.get("/api/files/search", params={"path": str(tmp), "q": "renamed"}).json()
    check("search", any(i["name"] == "renamed.txt" for i in found["items"]))
    r = s.post("/api/files/delete", json={"paths": [str(tmp / "sub" / "renamed.txt")], "permanent": True})
    check("delete permanent", not (tmp / "sub" / "renamed.txt").exists())
    r = s.post("/api/files/delete", json={"paths": [str(tmp / "sub" / "hello.txt")], "permanent": False})
    res = r.json()["results"][0]
    check("delete to trash (or clear error)", res["ok"] or bool(res.get("error")), str(res))

    print("screen")
    mons = s.get("/api/screen/monitors")
    check("monitors", mons.status_code == 200 and len(mons.json()) >= 1, mons.text)
    shot = s.get("/api/screen/screenshot")
    check("screenshot png", shot.status_code == 200 and shot.content[:4] == b"\x89PNG")

    print("controls")
    r = s.post("/api/clipboard", json={"text": "rpc-clip-123"})
    check("clipboard set", r.status_code == 200, r.text)
    check("clipboard get", s.get("/api/clipboard").json().get("text") == "rpc-clip-123")
    check("media key", s.post("/api/media/play_pause").status_code == 200)
    v = s.get("/api/volume").json()
    check("volume reports support flag", "supported" in v)
    for action in ("lock", "shutdown", "restart"):
        r = s.post(f"/api/power/{action}")
        check(f"power {action} (dry run)", r.status_code in (200, 501) and (r.status_code == 501 or r.json().get("dry_run")), r.text)
    check("unknown power action 404", s.post("/api/power/explode").status_code == 404)

    print("settings + audit")
    st = s.get("/api/settings").json()
    check("settings", "alerts" in st and isinstance(st["shells"], list))
    r = s.put("/api/settings", json={"alerts": {"enabled": True, "cpu": 80, "memory": 90, "disk": 95, "battery": 15}})
    check("settings update", r.json()["alerts"]["cpu"] == 80)
    s.put("/api/settings", json={"alerts": {"enabled": True, "cpu": 90, "memory": 90, "disk": 95, "battery": 15}})
    log = s.get("/api/audit").json()
    check("audit has entries", any(e["action"] == "file.upload" for e in log))

    asyncio.run(ws_checks(s.cookies.get("rpc_session")))

    print("logout")
    s.post("/api/auth/logout")
    check("logged out -> 401", s.get("/api/system/info").status_code == 401)

    print(f"\n{passed} passed, {len(failed)} failed")
    if failed:
        print("failed:", ", ".join(failed))
        sys.exit(1)


async def ws_checks(sid: str) -> None:
    print("websockets")
    cookie = {"Cookie": f"rpc_session={sid}"}
    try:
        async with websockets.connect(f"{WS}/api/ws/stats") as ws:
            await asyncio.wait_for(ws.recv(), 3)
        check("ws anonymous rejected", False)
    except Exception:
        check("ws anonymous rejected", True)
    try:
        async with websockets.connect(f"{WS}/api/ws/terminal", additional_headers={**cookie, "Origin": "http://evil.example"}) as ws:
            await asyncio.wait_for(ws.recv(), 3)
        check("ws cross-origin rejected", False)
    except Exception:
        check("ws cross-origin rejected", True)

    async with websockets.connect(f"{WS}/api/ws/stats", additional_headers=cookie) as ws:
        a = json.loads(await asyncio.wait_for(ws.recv(), 5))
        b = json.loads(await asyncio.wait_for(ws.recv(), 5))
        check("ws stats streams", b["ts"] > a["ts"])

    async with websockets.connect(f"{WS}/api/ws/terminal?cols=80&rows=24", additional_headers=cookie) as ws:
        await ws.send(json.dumps({"type": "input", "data": "echo RPC_$((40+2))\r"}))
        out = ""
        try:
            while "RPC_42" not in out:
                out += await asyncio.wait_for(ws.recv(), 5)
        except asyncio.TimeoutError:
            pass
        check("ws terminal runs commands", "RPC_42" in out, repr(out[-200:]))
        await ws.send(json.dumps({"type": "resize", "cols": 120, "rows": 40}))
        await ws.send(json.dumps({"type": "input", "data": "stty size\r"}))
        out = ""
        try:
            while "40 120" not in out:
                out += await asyncio.wait_for(ws.recv(), 5)
        except asyncio.TimeoutError:
            pass
        check("ws terminal resize", "40 120" in out, repr(out[-200:]))

    async with websockets.connect(f"{WS}/api/ws/screen", additional_headers=cookie) as ws:
        await ws.send(json.dumps({"type": "config", "monitor": 1, "fps": 5, "quality": 50, "scale": 0.5}))
        meta = json.loads(await asyncio.wait_for(ws.recv(), 5))
        frame = await asyncio.wait_for(ws.recv(), 5)
        check("ws screen frame", meta["type"] == "frame" and isinstance(frame, bytes) and frame[:2] == b"\xff\xd8")

    async with websockets.connect(f"{WS}/api/ws/input", additional_headers=cookie) as ws:
        await ws.send(json.dumps({"type": "move", "x": 0.25, "y": 0.5}))
        await ws.send(json.dumps({"type": "click", "button": "left", "x": 0.25, "y": 0.5}))
        await ws.send(json.dumps({"type": "key", "key": "a"}))
        try:
            msg = await asyncio.wait_for(ws.recv(), 1.5)
            check("ws input accepted", "error" not in msg, msg)
        except asyncio.TimeoutError:
            check("ws input accepted", True)


if __name__ == "__main__":
    main()
