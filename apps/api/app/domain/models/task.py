"""
ORM model for inter-agent tasks.

This is the DB-backed representation of a "pigeon" — a task dispatched
from one agent to another. Every dispatch_task call creates a row here,
and the API broadcasts pigeon.dispatched over WebSocket so the frontend
can animate the flight. When the receiving agent completes the task,
pigeon.delivered is broadcast.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _uuid_str() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)

    source_agent_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    destination_agent_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    destination_role: Mapped[str] = mapped_column(String(128), nullable=False)

    task_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    priority: Mapped[str] = mapped_column(String(16), nullable=False, default="normal")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)

    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
