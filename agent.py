from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
import pyautogui
import psutil
import subprocess
import os
import platform
import json
import pathlib
import asyncio
import base64
import io
from typing import Optional
from PIL import Image

# Load config
CONFIG_PATH = "config.json"
if not os.path.exists(CONFIG_PATH):
    default_config = {
        "port": 8000,
        "token": "your_secure_token"
    }
    with open(CONFIG_PATH, "w") as f:
        json.dump(default_config, f, indent=2)

with open(CONFIG_PATH, "r") as f:
    config = json.load(f)

AUTH_TOKEN = config["token"]

app = FastAPI(
    title="Remote PC Control Agent",
    description="A lightweight remote PC control agent with system monitoring and file management capabilities",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

BASE_DIR = pathlib.Path(__file__).parent.resolve()
STATIC_DIR = BASE_DIR
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def check_auth(token: str):
    if token != AUTH_TOKEN:
        raise HTTPException(status_code=403, detail="Unauthorized")


@app.websocket("/ws/screen")
async def websocket_screen(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            screenshot = pyautogui.screenshot()
            buf = io.BytesIO()
            screenshot.save(buf, format='JPEG', quality=50)
            jpeg_bytes = buf.getvalue()
            b64_str = base64.b64encode(jpeg_bytes).decode('utf-8')
            await websocket.send_text(b64_str)
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        print("Screen websocket disconnected")
    except Exception as e:
        print(f"Error in screen websocket: {e}")


@app.websocket("/ws/control")
async def websocket_control(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            event_type = data.get("type")

            if event_type == "mouse_move":
                x = data.get("x")
                y = data.get("y")
                if x is not None and y is not None:
                    pyautogui.moveTo(x, y)

            elif event_type == "mouse_click":
                button = data.get("button", "left")
                pyautogui.click(button=button)

            elif event_type == "key_press":
                key = data.get("key")
                if key:
                    pyautogui.press(key)

    except WebSocketDisconnect:
        print("Control websocket disconnected")
    except Exception as e:
        print(f"Error in control websocket: {e}")


@app.get("/stats")
def get_stats():
    import time
    uptime_seconds = time.time() - psutil.boot_time()
    total_storage = psutil.disk_usage('/').total
    total_ram = psutil.virtual_memory().total
    uname = platform.uname()

    return {
        "cpu_percent": psutil.cpu_percent(interval=0),
        "ram_percent": psutil.virtual_memory().percent,
        "total_ram": total_ram,
        "disk_percent": psutil.disk_usage('/').percent,
        "total_storage": total_storage,
        "battery": psutil.sensors_battery().percent if psutil.sensors_battery() else "N/A",
        "platform": platform.platform(),
        "device_name": platform.node(),
        "cpu_model": platform.processor() or uname.processor or "Unknown CPU",
        "cpu_freq": psutil.cpu_freq().current if psutil.cpu_freq() else None,
        "os_name": uname.system,
        "os_version": uname.version,
        "os_arch": uname.machine,
        "uptime": uptime_seconds
    }


@app.get("/screenshot")
async def screenshot(background_tasks: BackgroundTasks):
    screenshot_path = "screenshot.png"
    await asyncio.to_thread(pyautogui.screenshot, screenshot_path)

    def cleanup():
        try:
            os.remove(screenshot_path)
        except Exception:
            pass

    background_tasks.add_task(cleanup)
    return FileResponse(screenshot_path)


@app.get("/files/list")
def list_files(path: Optional[str] = None):
    try:
        if not path:
            if platform.system().lower() == 'windows':
                drives = []
                for p in psutil.disk_partitions(all=False):
                    try:
                        usage = psutil.disk_usage(p.device)
                        drives.append({
                            "name": p.device,
                            "path": p.device,
                            "is_dir": True,
                            "type": "drive",
                            "size": None,
                            "modified": None,
                            "free": usage.free,
                            "total": usage.total
                        })
                    except OSError as e:
                        if hasattr(e, 'winerror') and e.winerror == 21:
                            continue
                        print(f"Error accessing drive {p.device}: {e}")
                return {"path": None, "items": drives}
            else:
                path = "/"

        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Path not found")

        items = []
        for entry in os.scandir(path):
            items.append({
                "name": entry.name,
                "path": os.path.abspath(entry.path),
                "is_dir": entry.is_dir(),
                "type": "directory" if entry.is_dir() else "file",
                "size": entry.stat().st_size if entry.is_file() else None,
                "modified": entry.stat().st_mtime
            })
        return {"path": path, "items": items}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/files/download")
def download_file(path: str):
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path)


@app.post("/command")
def run_command(command: str):
    try:
        result = subprocess.check_output(command, shell=True, stderr=subprocess.STDOUT, timeout=10, text=True)
        return {"output": result}
    except subprocess.CalledProcessError as e:
        return {"error": str(e.output)}
    except Exception as e:
        return {"error": str(e)}


@app.post("/control/shutdown")
def shutdown():
    os.system("shutdown /s /t 1")
    return {"status": "Shutdown initiated"}


@app.post("/control/reboot")
def reboot():
    os.system("shutdown /r /t 1")
    return {"status": "Reboot initiated"}


@app.get("/", response_class=HTMLResponse)
async def root():
    index_path = BASE_DIR / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    else:
        return HTMLResponse(content="<h1>index.html not found</h1>", status_code=404)


@app.get("/{filename}")
async def serve_static_files(filename: str):
    valid_extensions = [
        ".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg",
        ".woff", ".woff2", ".ttf", ".eot", ".json"
    ]
    file_path = BASE_DIR / filename
    if file_path.exists() and file_path.suffix.lower() in valid_extensions:
        return FileResponse(str(file_path))
    return HTMLResponse(content="<h1>File not found</h1>", status_code=404)


if __name__ == "__main__":
    import socket
    import webbrowser
    import threading

    hostname = socket.gethostname()
    local_ip = socket.gethostbyname(hostname)
    url = f"http://{local_ip}:{config['port']}/?token={AUTH_TOKEN}"
    print(f"🔗 Agent running at {url}")

    def open_browser():
        webbrowser.open(url)

    threading.Timer(1.5, open_browser).start()
    uvicorn.run(app, host=config.get("host", "0.0.0.0"), port=config["port"])
