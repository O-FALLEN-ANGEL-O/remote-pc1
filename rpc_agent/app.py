"""FastAPI application: API routers, auth, security headers and the built web UI."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from . import __version__
from .config import BASE_DIR
from .routes import auth, controls, files, screen, system, terminal
from .security import require_auth, same_origin
from .stats import sampler

WEB_DIST = BASE_DIR / "web" / "dist"

CSP = (
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
    "style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' ws: wss:; "
    "frame-src 'self' blob:; object-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'"
)


class SecurityHeaders(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method not in ("GET", "HEAD", "OPTIONS") and not same_origin(request):
            return JSONResponse({"detail": "Cross-origin request refused"}, status_code=403)
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Content-Security-Policy", CSP)
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response


@asynccontextmanager
async def lifespan(_: FastAPI):
    sampler.start()
    yield
    await sampler.stop()


def create_app() -> FastAPI:
    app = FastAPI(title="Remote PC Control", version=__version__, docs_url=None, redoc_url=None,
                  openapi_url=None, lifespan=lifespan)
    app.add_middleware(SecurityHeaders)

    guarded = [Depends(require_auth)]
    app.include_router(auth.public, prefix="/api")
    app.include_router(auth.private, prefix="/api")
    app.include_router(system.router, prefix="/api", dependencies=guarded)
    app.include_router(files.router, prefix="/api", dependencies=guarded)
    app.include_router(screen.router, prefix="/api", dependencies=guarded)
    app.include_router(controls.router, prefix="/api", dependencies=guarded)
    # WebSockets authorise themselves in the handler (see security.authorize_ws).
    app.include_router(system.ws_router, prefix="/api")
    app.include_router(screen.ws_router, prefix="/api")
    app.include_router(terminal.ws_router, prefix="/api")

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "DELETE"], include_in_schema=False)
    async def api_not_found(rest: str):
        return JSONResponse({"detail": "Not found"}, status_code=404)

    dist = WEB_DIST.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    async def web(path: str):
        if not dist.exists():
            return HTMLResponse("<h1>Web UI not built</h1><p>Run <code>npm install && npm run build</code> in <code>web/</code>.</p>", 500)
        candidate = (dist / path).resolve() if path else dist / "index.html"
        if path and candidate.is_file() and dist in candidate.parents:
            headers = {"Cache-Control": "public, max-age=31536000, immutable"} if "/assets/" in f"/{path}" else {}
            if candidate.name == "sw.js":
                headers = {"Cache-Control": "no-cache"}
            return FileResponse(candidate, headers=headers)
        return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
