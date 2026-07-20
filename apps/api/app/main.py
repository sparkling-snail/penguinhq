"""
FastAPI application entrypoint.

Responsibilities kept deliberately narrow: create the app, wire
middleware, mount routers, and manage process-lifetime background tasks
(DB init, seed data, the pigeon simulator). Business logic never lives
here — it lives in app/domain and app/api/routes.
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import agents, health, websocket
from app.core.config import get_settings
from app.core.database import init_db
from app.seed import seed_agents_if_empty
from app.ws.pigeon_simulator import run_pigeon_simulator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("penguinhq")

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("PenguinHQ API starting up (env=%s)", settings.environment)
    await init_db()
    await seed_agents_if_empty()

    simulator_task = asyncio.create_task(run_pigeon_simulator())
    try:
        yield
    finally:
        simulator_task.cancel()
        logger.info("PenguinHQ API shutting down")


app = FastAPI(
    title="PenguinHQ API",
    version="0.1.0",
    description="Backend for PenguinHQ — an interactive AI operating system.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(agents.router)
app.include_router(websocket.router)


@app.get("/")
async def root() -> dict:
    return {"name": "PenguinHQ API", "status": "waddling"}
