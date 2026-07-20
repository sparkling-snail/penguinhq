"""
Redis client lifecycle.

Redis backs two things in later milestones: the Celery broker/result
backend for background jobs, and a pub/sub channel so multiple API
replicas can broadcast WebSocket events to each other. Milestone 1 only
needs a live connection to prove the wiring works end-to-end.
"""

import redis.asyncio as redis

from app.core.config import get_settings

settings = get_settings()

redis_client: redis.Redis = redis.from_url(settings.redis_url, decode_responses=True)


async def ping_redis() -> bool:
    return await redis_client.ping()
