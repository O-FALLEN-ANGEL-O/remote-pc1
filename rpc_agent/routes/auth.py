"""Login/logout, session status, settings, audit log and token rotation."""

from __future__ import annotations

import platform

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .. import __version__, audit
from ..config import config, new_token
from ..security import (
    SESSION_COOKIE,
    client_ip,
    is_authenticated,
    limiter,
    require_auth,
    same_origin,
    sessions,
    token_matches,
)
from .terminal import available_shells

public = APIRouter(prefix="/auth")
private = APIRouter(dependencies=[Depends(require_auth)])


class LoginBody(BaseModel):
    token: str


@public.post("/login")
def login(body: LoginBody, request: Request, response: Response):
    ip = client_ip(request)
    if not same_origin(request):
        raise HTTPException(403, "Cross-origin login refused")
    wait = limiter.retry_after(ip)
    if wait:
        raise HTTPException(429, f"Too many attempts. Try again in {wait} seconds.", headers={"Retry-After": str(wait)})
    if not token_matches(body.token.strip()):
        limiter.fail(ip)
        audit.record("auth.login", "wrong token", ip, ok=False)
        raise HTTPException(401, "That token isn't right")
    limiter.reset(ip)
    sid = sessions.create()
    response.set_cookie(
        SESSION_COOKIE, sid, httponly=True, samesite="strict",
        secure=request.url.scheme == "https", max_age=int(float(config.get("session_hours", 12)) * 3600), path="/",
    )
    audit.record("auth.login", "signed in", ip)
    return {"ok": True}


@public.post("/logout")
def logout(request: Request, response: Response):
    sessions.revoke(request.cookies.get(SESSION_COOKIE))
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@public.get("/status")
def status(request: Request):
    if not is_authenticated(request):
        return {"authenticated": False}
    return {"authenticated": True, "hostname": platform.node(), "os": platform.system(), "version": __version__}


# ------------------------------------------------------------------ settings

class Alerts(BaseModel):
    enabled: bool = True
    cpu: int = Field(90, ge=1, le=100)
    memory: int = Field(90, ge=1, le=100)
    disk: int = Field(95, ge=1, le=100)
    battery: int = Field(15, ge=0, le=100)


class SettingsBody(BaseModel):
    alerts: Alerts | None = None
    stats_interval: float | None = Field(None, ge=0.5, le=10)
    session_hours: float | None = Field(None, ge=0.25, le=720)


def _settings() -> dict:
    return {
        "alerts": config.get("alerts"),
        "stats_interval": config.get("stats_interval"),
        "session_hours": config.get("session_hours"),
        "port": config.get("port"),
        "version": __version__,
        "shells": available_shells(),
    }


@private.get("/settings")
def get_settings():
    return _settings()


@private.put("/settings")
def put_settings(body: SettingsBody, request: Request):
    values = body.model_dump(exclude_none=True)
    if values:
        config.update(**values)
        audit.record("settings.update", ", ".join(values), client_ip(request))
    return _settings()


@private.post("/auth/rotate")
def rotate_token(request: Request):
    token = new_token()
    config.update(token=token)
    sessions.revoke_all(keep=request.cookies.get(SESSION_COOKIE))
    audit.record("auth.rotate", "token changed, other sessions signed out", client_ip(request))
    return {"token": token}


@private.get("/audit")
def get_audit(limit: int = 200):
    return audit.recent(min(max(limit, 1), 500))
