import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException
from .config import get_settings
from .db import Base, engine
from .errors import DomainError, ImmutableRecord
from .routers import auth, masters, operations, reports, sales
from .security import RateLimiter

settings = get_settings()
log = logging.getLogger("o2a")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.validate_for_runtime()
    if not settings.is_prod:
        Base.metadata.create_all(engine)  # dev convenience; production uses `alembic upgrade head`
    yield


app = FastAPI(title="Order-to-Audit API", version="1.0.0", lifespan=lifespan,
              docs_url="/docs" if settings.docs_enabled else None, redoc_url=None, openapi_url="/openapi.json" if settings.docs_enabled else None)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_list, allow_credentials=False, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                   allow_headers=["Authorization", "Content-Type", "X-Request-ID"], expose_headers=["Content-Disposition", "X-Request-ID"])
limiter = RateLimiter(settings.rate_limit_per_minute)


@app.middleware("http")
async def guard(request: Request, call_next):
    rid = request.headers.get("x-request-id", "")[:64] or uuid.uuid4().hex
    ip = request.client.host if request.client else "unknown"
    if not limiter.allow(ip):
        return JSONResponse({"error": {"code": "rate_limited", "message": "Too many requests"}}, status_code=429, headers={"Retry-After": "60"})
    t0 = time.time()
    try:
        resp = await call_next(request)
    except Exception:  # noqa: BLE001
        log.exception("unhandled error rid=%s %s %s", rid, request.method, request.url.path)
        resp = JSONResponse({"error": {"code": "internal_error", "message": "Something went wrong. Quote request id " + rid}}, status_code=500)
    resp.headers.update({"X-Request-ID": rid, "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer"})
    if request.url.path.startswith("/api"):
        resp.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        if "cache-control" not in resp.headers:
            resp.headers["Cache-Control"] = "no-store"
    elif not request.url.path.startswith("/docs"):
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'"
        )
    if settings.is_prod:
        resp.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    log.info("%s %s %s %dms rid=%s", request.method, request.url.path, resp.status_code, (time.time() - t0) * 1000, rid)
    return resp


def _err(status, code, message, details=None):
    return JSONResponse({"error": {"code": code, "message": message, "details": details or {}}}, status_code=status)


@app.exception_handler(DomainError)
async def domain_handler(_, e: DomainError): return _err(e.status, e.code, e.message, e.details)


@app.exception_handler(RequestValidationError)
async def validation_handler(_, e: RequestValidationError):
    return _err(422, "validation_error", "Invalid request", {"fields": [{"loc": ".".join(str(x) for x in x["loc"][1:]), "msg": x["msg"]} for x in e.errors()]})


@app.exception_handler(StarletteHTTPException)
async def http_handler(_, e: StarletteHTTPException): return _err(e.status_code, "http_error", str(e.detail))


@app.exception_handler(IntegrityError)
async def integrity_handler(_, e: IntegrityError):
    log.warning("integrity error: %s", e.orig)
    return _err(409, "conflict", "The change conflicts with existing data (duplicate or in use)")


@app.exception_handler(ImmutableRecord)
async def immutable_handler(_, e): return _err(409, "immutable", str(e))


for r in (auth.router, masters.router, sales.router, operations.router, reports.router):
    app.include_router(r, prefix="/api/v1")


@app.get("/health")
def health():
    from sqlalchemy import text
    with engine.connect() as c:
        c.execute(text("SELECT 1"))
    return {"status": "ok"}


_DIST = Path(__file__).resolve().parent.parent / "dist"
if (_DIST / "index.html").is_file():
    if (_DIST / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        candidate = (_DIST / full_path).resolve()
        if full_path and candidate.is_file() and _DIST in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(_DIST / "index.html")
