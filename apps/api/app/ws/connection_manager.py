"""WebSocket connection registry with Redis-backed cross-replica fan-out."""

import asyncio
import json
import logging
from contextlib import suppress

from fastapi import WebSocket
from redis.asyncio import Redis

logger = logging.getLogger("penguinhq.ws")


class ConnectionManager:
    CHANNEL = "penguinhq:events"

    def __init__(self) -> None:
        self._active_connections: dict[str, WebSocket] = {}
        self._redis: Redis | None = None
        self._pubsub = None
        self._listener_task: asyncio.Task | None = None

    async def start(self, redis_url: str) -> None:
        """Subscribe this API replica to the shared event channel."""
        try:
            self._redis = Redis.from_url(redis_url, decode_responses=True)
            await self._redis.ping()
            self._pubsub = self._redis.pubsub()
            await self._pubsub.subscribe(self.CHANNEL)
            self._listener_task = asyncio.create_task(self._listen(), name="redis-ws-fanout")
            logger.info("Redis WebSocket fan-out enabled on %s", self.CHANNEL)
        except Exception:  # noqa: BLE001 — local sockets remain usable if Redis is unavailable
            logger.exception("Redis fan-out unavailable; using process-local broadcasts")
            await self.stop()

    async def stop(self) -> None:
        if self._listener_task:
            self._listener_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._listener_task
            self._listener_task = None
        if self._pubsub:
            await self._pubsub.aclose()
            self._pubsub = None
        if self._redis:
            await self._redis.aclose()
            self._redis = None

    async def _listen(self) -> None:
        assert self._pubsub is not None
        async for item in self._pubsub.listen():
            if item.get("type") != "message":
                continue
            try:
                await self._broadcast_local(json.loads(item["data"]))
            except (TypeError, json.JSONDecodeError):
                logger.warning("ignored malformed Redis event")

    async def connect(self, client_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._active_connections[client_id] = websocket
        logger.info("client connected: %s (total=%d)", client_id, len(self._active_connections))

    def disconnect(self, client_id: str) -> None:
        self._active_connections.pop(client_id, None)
        logger.info("client disconnected: %s (total=%d)", client_id, len(self._active_connections))

    async def send_to(self, client_id: str, message: dict) -> None:
        websocket = self._active_connections.get(client_id)
        if websocket is not None:
            await websocket.send_json(message)

    async def broadcast(self, message: dict) -> None:
        if self._redis is not None:
            try:
                await self._redis.publish(self.CHANNEL, json.dumps(message))
                return
            except Exception:  # noqa: BLE001 — degrade to the local replica
                logger.exception("Redis publish failed; broadcasting locally")
        await self._broadcast_local(message)

    async def _broadcast_local(self, message: dict) -> None:
        stale: list[str] = []
        for client_id, websocket in list(self._active_connections.items()):
            try:
                await websocket.send_json(message)
            except Exception:  # noqa: BLE001 — a dead socket shouldn't kill the loop
                stale.append(client_id)
        for client_id in stale:
            self.disconnect(client_id)

    @property
    def connection_count(self) -> int:
        return len(self._active_connections)


# Single shared instance for the whole process. Redis synchronizes all replicas.
connection_manager = ConnectionManager()
