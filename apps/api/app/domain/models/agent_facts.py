"""
ORM model for an agent's durable fact store.

Unlike agent_memory (a growing timeline of raw turns, bounded by a
fetch limit), this is a small, fixed key-value profile per agent — e.g.
target_role/target_location for Job Hunter — that's injected into every
conversational reply regardless of how much unrelated autonomous activity
has happened in between. That's the actual gap this closes: a fact that
falls outside agent_memory's recency window is otherwise gone.

Composite (agent_id, key) primary key makes storing a fact an upsert by
construction — a later, updated value for the same key overwrites rather
than accumulating duplicates.
"""

from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AgentFact(Base):
    __tablename__ = "agent_facts"

    agent_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )
