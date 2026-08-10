"""Persisted Leetcode practice sessions, code snapshots, and coach feedback."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.domain.models.practice import AttemptFeedback, PracticeAttempt, PracticeSession
from app.domain.schemas.practice import (
    AttemptFeedbackCreate,
    AttemptFeedbackOut,
    PracticeAttemptCreate,
    PracticeAttemptOut,
    PracticeSessionCreate,
    PracticeSessionDraftUpdate,
    PracticeSessionOut,
)

router = APIRouter(prefix="/practice", tags=["practice"])
LOCAL_USER_ID = "local-user"


async def _session_or_404(session_id: str, db: AsyncSession) -> PracticeSession:
    session = await db.get(PracticeSession, session_id)
    if session is None or session.user_id != LOCAL_USER_ID:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Practice session not found")
    return session


@router.get("/sessions/active", response_model=PracticeSessionOut | None)
async def get_active_session(db: AsyncSession = Depends(get_db_session)) -> PracticeSession | None:
    result = await db.execute(
        select(PracticeSession)
        .where(PracticeSession.user_id == LOCAL_USER_ID, PracticeSession.status == "active")
        .order_by(PracticeSession.updated_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


@router.post("/sessions", response_model=PracticeSessionOut, status_code=status.HTTP_201_CREATED)
async def create_session(
    body: PracticeSessionCreate, db: AsyncSession = Depends(get_db_session)
) -> PracticeSession:
    session = PracticeSession(user_id=LOCAL_USER_ID, **body.model_dump())
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.patch("/sessions/{session_id}/draft", response_model=PracticeSessionOut)
async def save_draft(
    session_id: str, body: PracticeSessionDraftUpdate, db: AsyncSession = Depends(get_db_session)
) -> PracticeSession:
    session = await _session_or_404(session_id, db)
    session.title = body.title
    session.draft_code = body.draft_code
    await db.commit()
    await db.refresh(session)
    return session


@router.post("/sessions/{session_id}/attempts", response_model=PracticeAttemptOut, status_code=status.HTTP_201_CREATED)
async def create_attempt(
    session_id: str, body: PracticeAttemptCreate, db: AsyncSession = Depends(get_db_session)
) -> PracticeAttempt:
    await _session_or_404(session_id, db)
    attempt = PracticeAttempt(session_id=session_id, **body.model_dump())
    db.add(attempt)
    await db.commit()
    await db.refresh(attempt)
    return attempt


@router.post("/attempts/{attempt_id}/feedback", response_model=AttemptFeedbackOut, status_code=status.HTTP_201_CREATED)
async def create_feedback(
    attempt_id: str, body: AttemptFeedbackCreate, db: AsyncSession = Depends(get_db_session)
) -> AttemptFeedback:
    if await db.get(PracticeAttempt, attempt_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Practice attempt not found")
    feedback = AttemptFeedback(attempt_id=attempt_id, **body.model_dump())
    db.add(feedback)
    await db.commit()
    await db.refresh(feedback)
    return feedback
