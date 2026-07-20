"""
Liveness/readiness endpoint.

Split into two concerns on purpose: `/health` is a cheap liveness check
(is the process up), `/health/ready` actually touches Postgres and Redis
(is the process able to do its job). Kubernetes probes in the deployment
milestone will point at these two separately.
"""

from fastapi import APIRouter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from app.core.database import get_db_session
from app.core.redis import ping_redis

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
async def health() -> dict:
    return {"status": "ok"}


@router.get("/ready")
async def readiness(db: AsyncSession = Depends(get_db_session)) -> dict:
    await db.execute(text("SELECT 1"))
    redis_ok = await ping_redis()
    return {"status": "ok", "postgres": True, "redis": redis_ok}
