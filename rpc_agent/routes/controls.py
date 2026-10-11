"""Power actions, clipboard, media keys and volume — on Windows, Linux and macOS."""

from __future__ import annotations

import os
import platform
import re
import shutil
import subprocess
import threading

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from .. import audit
from ..security import client_ip

router = APIRouter()
SYSTEM = platform.system()
DRY_RUN = os.environ.get("RPC_DRY_RUN") == "1"


def _run(cmd: list[str], timeout: float = 5) -> subprocess.CompletedProcess:
    kwargs = {}
    if SYSTEM == "Windows":
        kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, **kwargs)


# --------------------------------------------------------------------- power

def _power_command(action: str) -> list[list[str]]:
    """Return candidate commands; the first that exists on this system is used."""
    if SYSTEM == "Windows":
        return {
            "shutdown": [["shutdown", "/s", "/t", "5"]],
            "restart": [["shutdown", "/r", "/t", "5"]],
            "sleep": [["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"]],
            "hibernate": [["shutdown", "/h"]],
            "lock": [["rundll32.exe", "user32.dll,LockWorkStation"]],
            "logout": [["shutdown", "/l"]],
            "cancel": [["shutdown", "/a"]],
        }[action]
    if SYSTEM == "Darwin":
        osa = lambda s: ["osascript", "-e", s]  # noqa: E731
        return {
            "shutdown": [osa('tell application "System Events" to shut down')],
            "restart": [osa('tell application "System Events" to restart')],
            "sleep": [["pmset", "sleepnow"]],
            "hibernate": [["pmset", "sleepnow"]],
            "lock": [["pmset", "displaysleepnow"]],
            "logout": [osa('tell application "System Events" to log out')],
            "cancel": [],
        }[action]
    session = os.environ.get("XDG_SESSION_ID")
    return {
        "shutdown": [["systemctl", "poweroff"], ["shutdown", "-h", "now"]],
        "restart": [["systemctl", "reboot"], ["shutdown", "-r", "now"]],
        "sleep": [["systemctl", "suspend"]],
        "hibernate": [["systemctl", "hibernate"]],
        "lock": [["loginctl", "lock-session"] + ([session] if session else []), ["xdg-screensaver", "lock"]],
        "logout": ([["loginctl", "terminate-session", session]] if session else [])
                  + [["gnome-session-quit", "--logout", "--no-prompt"], ["qdbus", "org.kde.ksmserver", "/KSMServer", "logout", "0", "0", "0"]],
        "cancel": [["shutdown", "-c"]],
    }[action]


POWER_ACTIONS = ("shutdown", "restart", "sleep", "hibernate", "lock", "logout", "cancel")


@router.post("/power/{action}")
def power(action: str, request: Request):
    if action not in POWER_ACTIONS:
        raise HTTPException(404, "Unknown action")
    candidates = [c for c in _power_command(action) if shutil.which(c[0])]
    if not candidates:
        raise HTTPException(501, f"'{action}' isn't supported on this system")
    cmd = candidates[0]
    audit.record(f"power.{action}", " ".join(cmd), client_ip(request))
    if DRY_RUN:
        return {"ok": True, "command": cmd, "dry_run": True}

    def later():
        try:
            subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError as exc:
            print(f"[power] {action} failed: {exc}")

    # Let the HTTP response reach the browser before the machine goes away.
    threading.Timer(0.5, later).start()
    return {"ok": True, "command": cmd}


# ----------------------------------------------------------------- clipboard

class ClipboardBody(BaseModel):
    text: str


@router.get("/clipboard")
def get_clipboard():
    try:
        import pyperclip

        return {"text": pyperclip.paste()}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"Clipboard unavailable: {exc}")


@router.post("/clipboard")
def set_clipboard(body: ClipboardBody, request: Request):
    try:
        import pyperclip

        pyperclip.copy(body.text)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"Clipboard unavailable: {exc}")
    audit.record("clipboard.set", f"{len(body.text)} chars", client_ip(request))
    return {"ok": True}


# --------------------------------------------------------------------- media

MEDIA_KEYS = {
    "play_pause": "media_play_pause", "next": "media_next", "previous": "media_previous",
    "volume_up": "media_volume_up", "volume_down": "media_volume_down", "mute": "media_volume_mute",
}


@router.post("/media/{action}")
def media(action: str):
    if action not in MEDIA_KEYS:
        raise HTTPException(404, "Unknown media action")
    try:
        from pynput.keyboard import Controller, Key

        key = getattr(Key, MEDIA_KEYS[action])
        kb = Controller()
        kb.press(key)
        kb.release(key)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"Media keys unavailable: {exc}")
    return {"ok": True}


# -------------------------------------------------------------------- volume

class _Volume:
    """Master volume as 0-100 plus mute, per platform."""

    def _win_endpoint(self):
        import comtypes  # type: ignore
        from pycaw.pycaw import AudioUtilities  # type: ignore

        comtypes.CoInitialize()
        speakers = AudioUtilities.GetSpeakers()
        ep = getattr(speakers, "EndpointVolume", None)
        if ep is not None:
            return ep
        from ctypes import POINTER, cast

        from comtypes import CLSCTX_ALL  # type: ignore
        from pycaw.pycaw import IAudioEndpointVolume  # type: ignore

        iface = speakers.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        return cast(iface, POINTER(IAudioEndpointVolume))

    def get(self) -> dict:
        if SYSTEM == "Windows":
            ep = self._win_endpoint()
            return {"level": round(ep.GetMasterVolumeLevelScalar() * 100), "muted": bool(ep.GetMute())}
        if SYSTEM == "Darwin":
            out = _run(["osascript", "-e", "get volume settings"]).stdout
            level = re.search(r"output volume:(\d+)", out)
            muted = re.search(r"output muted:(true|false)", out)
            if not level:
                raise RuntimeError("Could not read volume")
            return {"level": int(level.group(1)), "muted": bool(muted and muted.group(1) == "true")}
        if shutil.which("pactl"):
            vol = _run(["pactl", "get-sink-volume", "@DEFAULT_SINK@"])
            mute = _run(["pactl", "get-sink-mute", "@DEFAULT_SINK@"])
            m = re.search(r"(\d+)%", vol.stdout)
            if vol.returncode == 0 and m:
                return {"level": int(m.group(1)), "muted": "yes" in mute.stdout}
        if shutil.which("amixer"):
            out = _run(["amixer", "sget", "Master"]).stdout
            m = re.search(r"\[(\d+)%\]", out)
            if m:
                return {"level": int(m.group(1)), "muted": "[off]" in out}
        raise RuntimeError("No volume control found (install pulseaudio-utils or alsa-utils)")

    def set(self, level: int | None, muted: bool | None) -> None:
        if SYSTEM == "Windows":
            ep = self._win_endpoint()
            if level is not None:
                ep.SetMasterVolumeLevelScalar(level / 100, None)
            if muted is not None:
                ep.SetMute(1 if muted else 0, None)
            return
        if SYSTEM == "Darwin":
            if level is not None:
                _run(["osascript", "-e", f"set volume output volume {level}"])
            if muted is not None:
                _run(["osascript", "-e", f"set volume output muted {'true' if muted else 'false'}"])
            return
        if shutil.which("pactl"):
            if level is not None:
                _run(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{level}%"])
            if muted is not None:
                _run(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "1" if muted else "0"])
            return
        if shutil.which("amixer"):
            if level is not None:
                _run(["amixer", "-q", "sset", "Master", f"{level}%"])
            if muted is not None:
                _run(["amixer", "-q", "sset", "Master", "mute" if muted else "unmute"])
            return
        raise RuntimeError("No volume control found")


volume_ctl = _Volume()


class VolumeBody(BaseModel):
    level: int | None = None
    muted: bool | None = None


@router.get("/volume")
def get_volume():
    try:
        return {"supported": True, **volume_ctl.get()}
    except Exception as exc:  # noqa: BLE001
        return {"supported": False, "level": None, "muted": None, "error": str(exc)}


@router.post("/volume")
def set_volume(body: VolumeBody):
    level = None if body.level is None else max(0, min(100, body.level))
    try:
        volume_ctl.set(level, body.muted)
        return {"supported": True, **volume_ctl.get()}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"Volume control unavailable: {exc}")
