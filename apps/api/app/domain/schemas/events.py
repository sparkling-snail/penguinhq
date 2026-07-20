"""
WebSocket event envelope + the "pigeon" event payload.

Every real-time thing PenguinHQ shows the user — an agent moving, a task
being handed off, a chat message — travels as one of these envelopes. The
frontend's `types/events.ts` mirrors this shape exactly (see
packages/shared-types/src/index.ts for the canonical cross-language
contract note).

Milestone 1 ships `connection.ack` (sent on connect) and
`pigeon.dispatched` (a fake, periodic event so the frontend has something
real to render before any actual agent task queue exists). Real pigeon
events start flowing once the task queue lands in a later milestone.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, Field

PayloadT = TypeVar("PayloadT")


class WSEventType(str, Enum):
    CONNECTION_ACK = "connection.ack"
    AGENT_STATE_CHANGED = "agent.state_changed"
    AGENT_MOVED = "agent.moved"
    PIGEON_DISPATCHED = "pigeon.dispatched"
    PIGEON_DELIVERED = "pigeon.delivered"
    CHAT_MESSAGE = "chat.message"


class WSEvent(BaseModel, Generic[PayloadT]):
    type: WSEventType
    payload: PayloadT
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


PigeonStatus = Literal["success", "retry", "dead_letter", "high_priority", "ai_collab"]


class PigeonPayload(BaseModel):
    task_id: str
    source_agent_id: str
    destination_agent_id: str
    priority: Literal["low", "normal", "high"]
    latency_ms: int
    retries: int
    queue: str
    payload_size_bytes: int
    status: PigeonStatus


class ConnectionAckPayload(BaseModel):
    message: str = "connected"
    client_id: str


def make_event(event_type: WSEventType, payload: Any) -> dict:
    """Serialize an event envelope to a JSON-ready dict for `websocket.send_json`."""
    return WSEvent(type=event_type, payload=payload).model_dump(mode="json")
