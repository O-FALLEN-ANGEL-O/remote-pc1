"""Audit log: every sensitive action is recorded in memory and in audit.log."""

from __future__ import annotations

import json
import threading
import time
from collections import deque
from typing import Any

from .config import BASE_DIR

LOG_PATH = BASE_DIR / "audit.log"
_entries: deque[dict[str, Any]] = deque(maxlen=500)
_lock = threading.Lock()


def _load_tail() -> None:
    if not LOG_PATH.exists():
        return
    try:
        lines = LOG_PATH.read_text(encoding="utf-8", errors="replace").splitlines()[-500:]
    except OSError:
        return
    for line in lines:
        try:
            _entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue


_load_tail()


def record(action: str, detail: str = "", ip: str | None = None, ok: bool = True) -> None:
    entry = {"ts": time.time(), "action": action, "detail": detail[:500], "ip": ip or "-", "ok": ok}
    with _lock:
        _entries.append(entry)
        try:
            with LOG_PATH.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry) + "\n")
        except OSError:
            pass


def recent(limit: int = 200) -> list[dict[str, Any]]:
    with _lock:
        items = list(_entries)[-limit:]
    items.reverse()
    return items
