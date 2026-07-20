"""
Placeholder Kafka-pigeon event generator.

There is no real task queue yet (that's a later milestone, backed by
actual Kafka/Redis Streams event flow between agents). Until then, this
background task manufactures a plausible `pigeon.dispatched` event every
few seconds so the frontend's pigeon-flight animation has real WebSocket
traffic to render against — not a hardcoded frontend mock.

When the real event-driven task pipeline ships, this file is deleted and
`connection_manager.broadcast(...)` gets called from the actual task
dispatch code path instead. Nothing else changes: the WSEvent contract is
identical either way.
"""

import asyncio
import logging
import random
import uuid

from app.domain.schemas.events import PigeonPayload, WSEventType, make_event
from app.ws.connection_manager import connection_manager

logger = logging.getLogger("penguinhq.ws.pigeon_simulator")

_AGENT_IDS = [
    "job-hunter",
    "leetcode-coach",
    "office-assistant",
    "tech-scout",
    "portfolio",
    "finance",
]
_QUEUES = ["tasks.high", "tasks.default", "tasks.retry"]
_STATUSES = ["success", "success", "success", "retry", "ai_collab", "high_priority"]


async def run_pigeon_simulator(interval_seconds: float = 6.0) -> None:
    """Runs forever; started as an asyncio background task on app startup."""
    while True:
        await asyncio.sleep(interval_seconds)
        if connection_manager.connection_count == 0:
            continue  # don't bother generating events nobody will see

        source, destination = random.sample(_AGENT_IDS, 2)
        payload = PigeonPayload(
            task_id=str(uuid.uuid4())[:8],
            source_agent_id=source,
            destination_agent_id=destination,
            priority=random.choice(["low", "normal", "high"]),
            latency_ms=random.randint(40, 900),
            retries=random.choice([0, 0, 0, 1, 2]),
            queue=random.choice(_QUEUES),
            payload_size_bytes=random.randint(200, 8000),
            status=random.choice(_STATUSES),
        )
        event = make_event(WSEventType.PIGEON_DISPATCHED, payload.model_dump())
        logger.debug("dispatching pigeon: %s -> %s", source, destination)
        await connection_manager.broadcast(event)
