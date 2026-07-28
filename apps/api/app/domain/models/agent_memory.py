"""
ORM model for an agent's conversation/activity memory.

Every message an autonomous agent sends or receives — a human's chat
message, its own reply, or the problem/solution/critique from an
autonomous cycle — gets a row here. Unlike chat.message (pure fan-out,
no persistence — see app/api/routes/chat.py), this is durable: it's what
lets an agent actually remember something across a container restart,
not just within one running process.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _uuid_str() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AgentMemory(Base):
    __tablename__ = "agent_memory"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    agent_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)

    # "user" (something said *to* the agent) or "assistant" (something the
    # agent itself said/did) — matches the Anthropic Messages API's role
    # field directly, so building conversation history is a flat mapping.
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)
