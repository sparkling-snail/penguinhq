"""
ORM model for an AI agent (a "penguin").

This is intentionally minimal for Milestone 1 — just enough columns to
persist an agent's identity and where it is in the world. Later milestones
add: memory/conversation history, token usage, cost tracking, and task
queue relationships (Job Hunter -> Portfolio Penguin task edges, etc).
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _uuid_str() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    role: Mapped[str] = mapped_column(String(128), nullable=False)

    # One of AgentState (see app/domain/schemas/agent.py) — kept as a plain
    # string column rather than a DB enum so new states don't require a
    # migration while the state machine is still evolving.
    state: Mapped[str] = mapped_column(String(32), nullable=False, default="idle")

    room: Mapped[str] = mapped_column(String(32), nullable=False, default="mission_control")
    position_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    position_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    avatar_color: Mapped[str] = mapped_column(String(16), nullable=False, default="#3B82F6")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
