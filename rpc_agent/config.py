"""Agent configuration: loaded from config.json, created on first run."""

from __future__ import annotations

import copy
import json
import os
import secrets
import threading
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = Path(os.environ.get("RPC_CONFIG", BASE_DIR / "config.json"))

# Tokens that were published (committed to git or used as a placeholder).
# If a config still holds one of these, it is replaced on startup.
COMPROMISED_TOKENS = {
    "your_secure_token",
    "G-kPd_cHhILj2l4VJuEZPXX6-Y1TTm2S50aM1ob8Iys",
}

DEFAULTS: dict[str, Any] = {
    "host": "0.0.0.0",
    "port": 8000,
    "token": None,
    "session_hours": 12,
    "stats_interval": 1.0,
    "alerts": {
        "enabled": True,
        "cpu": 90,
        "memory": 90,
        "disk": 95,
        "battery": 15,
    },
}


def new_token() -> str:
    return secrets.token_urlsafe(32)


def _merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


class Config:
    def __init__(self, path: Path = CONFIG_PATH):
        self.path = path
        self._lock = threading.Lock()
        self.token_rotated_reason: str | None = None
        self.data = self._load()

    def _load(self) -> dict:
        raw: dict = {}
        if self.path.exists():
            try:
                raw = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                raw = {}
        data = _merge(DEFAULTS, raw)
        token = data.get("token")
        if not token:
            data["token"] = new_token()
            self.token_rotated_reason = "created"
        elif token in COMPROMISED_TOKENS or len(str(token)) < 16:
            data["token"] = new_token()
            self.token_rotated_reason = "compromised"
        if raw != data:
            self._write(data)
        return data

    def _write(self, data: dict) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return copy.deepcopy(self.data.get(key, default))

    def update(self, **values: Any) -> None:
        with self._lock:
            self.data = _merge(self.data, values)
            self._write(self.data)

    @property
    def token(self) -> str:
        return self.data["token"]


config = Config()
