"""
Read/write access to an agent's durable memory.

The autonomous Leetcode Coach process (app/autonomous/leetcode_coach.py)
is the only writer today: it appends a row here for every human message
it receives, every reply it gives, and every step of its own practice
cycles, then reads the last N rows back before each Claude call to build
real multi-turn conversation history — the actual fix for "it has no
memory between messages."
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.domain.models.agent_memory import AgentMemory

router = APIRouter(prefix="/agents", tags=["memory"])


class MemoryEntryIn(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class MemoryEntryOut(BaseModel):
    role: str
    content: str


@router.post("/{agent_id}/memory")
async def append_memory(
    agent_id: str, body: MemoryEntryIn, db: AsyncSession = Depends(get_db_session)
) -> dict:
    db.add(AgentMemory(agent_id=agent_id, role=body.role, content=body.content))
    await db.commit()
    return {"ok": True}


@router.get("/{agent_id}/memory", response_model=list[MemoryEntryOut])
async def get_memory(
    agent_id: str, limit: int = 20, db: AsyncSession = Depends(get_db_session)
) -> list[MemoryEntryOut]:
    result = await db.execute(
        select(AgentMemory)
        .where(AgentMemory.agent_id == agent_id)
        .order_by(AgentMemory.created_at.desc())
        .limit(limit)
    )
    rows = result.scalars().all()
    # Reverse to chronological order — callers build conversation history
    # directly off this, and the Anthropic Messages API needs oldest-first.
    return [MemoryEntryOut(role=r.role, content=r.content) for r in reversed(rows)]
