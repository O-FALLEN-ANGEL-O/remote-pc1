"""Authentication: token login -> HttpOnly session cookie, with brute-force protection.

Every API route and every WebSocket goes through `require_auth` / `authorize_ws`.
Programmatic clients may send the token directly in `Authorization: Bearer <token>`
or `X-API-Token`. WebSockets additionally accept `?token=` because browsers cannot
set headers on a WebSocket handshake.
"""

from __future__ import annotations

import secrets
import threading
import time
from collections import defaultdict, deque
from urllib.parse import urlparse

from fastapi import HTTPException, Request, WebSocket, status

from .config import config

SESSION_COOKIE = "rpc_session"
MAX_FAILURES = 5
FAILURE_WINDOW = 300  # seconds


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, float] = {}
        self._lock = threading.Lock()

    def create(self) -> str:
        sid = secrets.token_urlsafe(32)
        ttl = float(config.get("session_hours", 12)) * 3600
        with self._lock:
            self._sessions[sid] = time.time() + ttl
        return sid

    def valid(self, sid: str | None) -> bool:
        if not sid:
            return False
        with self._lock:
            expires = self._sessions.get(sid)
            if expires is None:
                return False
            if expires < time.time():
                self._sessions.pop(sid, None)
                return False
            return True

    def revoke(self, sid: str | None) -> None:
        with self._lock:
            self._sessions.pop(sid or "", None)

    def revoke_all(self, keep: str | None = None) -> None:
        with self._lock:
            self._sessions = {k: v for k, v in self._sessions.items() if k == keep}


class RateLimiter:
    def __init__(self) -> None:
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, ip: str) -> deque[float]:
        q = self._failures[ip]
        cutoff = time.time() - FAILURE_WINDOW
        while q and q[0] < cutoff:
            q.popleft()
        return q

    def retry_after(self, ip: str) -> int:
        with self._lock:
            q = self._prune(ip)
            if len(q) < MAX_FAILURES:
                return 0
            return max(1, int(q[0] + FAILURE_WINDOW - time.time()))

    def fail(self, ip: str) -> None:
        with self._lock:
            self._prune(ip).append(time.time())

    def reset(self, ip: str) -> None:
        with self._lock:
            self._failures.pop(ip, None)


sessions = SessionStore()
limiter = RateLimiter()


def token_matches(candidate: str | None) -> bool:
    if not candidate:
        return False
    return secrets.compare_digest(candidate.encode(), config.token.encode())


def client_ip(conn: Request | WebSocket) -> str:
    return conn.client.host if conn.client else "unknown"


def _header_token(conn: Request | WebSocket) -> str | None:
    auth = conn.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return conn.headers.get("x-api-token")


def same_origin(conn: Request | WebSocket) -> bool:
    """Reject cross-site use of the session cookie (CSRF / WebSocket hijacking)."""
    origin = conn.headers.get("origin")
    if not origin:
        return True  # non-browser clients and same-origin GETs
    host = conn.headers.get("host", "")
    return urlparse(origin).netloc == host


def is_authenticated(conn: Request | WebSocket) -> bool:
    if token_matches(_header_token(conn)):
        return True
    return sessions.valid(conn.cookies.get(SESSION_COOKIE)) and same_origin(conn)


async def require_auth(request: Request) -> None:
    if not is_authenticated(request):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")


async def authorize_ws(websocket: WebSocket) -> bool:
    """Call before accept(). Closes the socket and returns False if unauthorised."""
    ok = is_authenticated(websocket) or (
        token_matches(websocket.query_params.get("token")) and same_origin(websocket)
    )
    if not ok:
        await websocket.close(code=4401)
    return ok
