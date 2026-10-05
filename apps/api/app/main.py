"""
FastAPI application entrypoint.

Responsibilities kept deliberately narrow: create the app, wire
middleware, mount routers, and manage process-lifetime background tasks
(DB init, seed data). Business logic never lives here — it lives in
app/domain and app/api/routes.

Note: the pigeon simulator has been replaced by real inter-agent task
dispatch (see app/api/routes/tasks.py). Pigeons now fly when agents
dispatch tasks to each other, not on a fake timer.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.routes import agents, chat, health, hooks, jobs, memory, practice, tasks, websocket
from app.core.config import get_settings
from app.core.database import init_db
from app.core.security import is_valid_bearer
from app.domain.models.job_listing import JobListing  # noqa: F401 — ensure table is created by init_db
from app.domain.models.practice import AttemptFeedback, PracticeAttempt, PracticeSession  # noqa: F401
from app.domain.models.task import Task  # noqa: F401 — ensure table is created by init_db
from app.seed import seed_agents_if_empty
from app.ws.connection_manager import connection_manager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("penguinhq")

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("PenguinHQ API starting up (env=%s)", settings.environment)
    if settings.is_production and not settings.api_token:
        raise RuntimeError("API_ACCESS_TOKEN is required in production")
    await init_db()
    await seed_agents_if_empty()
    await connection_manager.start(settings.redis_url)
    try:
        yield
    finally:
        await connection_manager.stop()
        logger.info("PenguinHQ API shutting down")


app = FastAPI(
    title="PenguinHQ API",
    version="0.1.0",
    description="Backend for PenguinHQ — an interactive AI operating system.",
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_host_list)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_service_token(request: Request, call_next):
    """Keep health probes public; protect all portfolio data and mutations."""
    public_paths = {"/", "/health", "/health/ready"}
    if request.method == "OPTIONS" or request.url.path in public_paths:
        return await call_next(request)
    if not settings.api_token and not settings.is_production:
        return await call_next(request)
    if not is_valid_bearer(request.headers.get("authorization")):
        return JSONResponse(
            status_code=401,
            content={"detail": "A valid PenguinHQ service token is required."},
            headers={"WWW-Authenticate": "Bearer"},
        )
    return await call_next(request)

app.include_router(health.router)
app.include_router(agents.router)
app.include_router(hooks.router)
app.include_router(chat.router)
app.include_router(memory.router)
app.include_router(jobs.router)
app.include_router(tasks.router)
app.include_router(practice.router)
app.include_router(websocket.router)


@app.get("/")
async def root() -> dict:
    return {"name": "PenguinHQ API", "status": "waddling"}
