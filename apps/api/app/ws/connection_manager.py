"""
In-memory WebSocket connection registry.

Holds every currently-connected client and broadcasts JSON payloads to all
of them. This is process-local — fine for a single `uvicorn` worker in
dev. Once we run multiple API replicas behind a load balancer, broadcast
needs to go through Redis pub/sub instead (each replica publishes to a
Redis channel; every replica's ConnectionManager subscribes and fans out
to its own local sockets). That swap is isolated to this one class, which
is exactly why it's factored out on its own.
"""

import logging

from fastapi import WebSocket

logger = logging.getLogger("penguinhq.ws")


class ConnectionManager:
    def __init__(self) -> None:
        self._active_connections: dict[str, WebSocket] = {}

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
        stale: list[str] = []
        for client_id, websocket in self._active_connections.items():
            try:
                await websocket.send_json(message)
            except Exception:  # noqa: BLE001 — a dead socket shouldn't kill the loop
                stale.append(client_id)
        for client_id in stale:
            self.disconnect(client_id)

    @property
    def connection_count(self) -> int:
        return len(self._active_connections)


# Single shared instance for the whole process — imported by the
# websocket route and by the background pigeon simulator so both talk to
# the same set of live sockets.
connection_manager = ConnectionManager()
