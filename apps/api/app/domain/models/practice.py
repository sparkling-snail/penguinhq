"""Durable Leetcode practice records.

Draft code belongs to the current session. An immutable attempt is created only
when the learner explicitly asks the coach for a review, so edit-by-edit
autosaves do not pollute their learning history.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _uuid_str() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class PracticeSession(Base):
    __tablename__ = "practice_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    # Auth is not yet implemented; this stable local identity keeps the schema
    # ready for a future authenticated user id without losing existing history.
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True, default="local-user")
    title: Mapped[str] = mapped_column(String(240), nullable=False, default="Today's practice")
    problem_statement: Mapped[str | None] = mapped_column(Text, nullable=True)
    language: Mapped[str] = mapped_column(String(32), nullable=False, default="python")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    draft_code: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


class PracticeAttempt(Base):
    __tablename__ = "practice_attempts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("practice_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_code: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str] = mapped_column(String(32), nullable=False, default="python")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)


class AttemptFeedback(Base):
    __tablename__ = "attempt_feedback"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    attempt_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("practice_attempts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author: Mapped[str] = mapped_column(String(64), nullable=False, default="leetcode_coach")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)
