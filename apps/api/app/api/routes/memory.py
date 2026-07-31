"""
Read/write access to an agent's durable memory and fact store.

Every autonomous agent in app/autonomous/agents/ appends to /memory for
every human message it receives, every reply it gives, and every step of
its own autonomous cycles, then reads the last N rows back before each
Claude call to build real multi-turn conversation history.

/facts is a separate, much smaller store: a fixed key-value profile per
agent (e.g. target_role/target_location for Job Hunter) that's injected
into every reply regardless of how much unrelated autonomous activity has
piled up in agent_memory since. A fact that only lived in the last-N
memory window would eventually fall out of it; this doesn't.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.domain.models.agent_facts import AgentFact
from app.domain.models.agent_memory import AgentMemory

router = APIRouter(prefix="/agents", tags=["memory"])


class MemoryEntryIn(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class MemoryEntryOut(BaseModel):
    role: str
    content: str


class FactsUpsert(BaseModel):
    facts: dict[str, str]


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


@router.get("/{agent_id}/facts")
async def get_facts(agent_id: str, db: AsyncSession = Depends(get_db_session)) -> dict[str, str]:
    result = await db.execute(select(AgentFact).where(AgentFact.agent_id == agent_id))
    return {row.key: row.value for row in result.scalars().all()}


@router.post("/{agent_id}/facts")
async def upsert_facts(
    agent_id: str, body: FactsUpsert, db: AsyncSession = Depends(get_db_session)
) -> dict:
    now = datetime.now(timezone.utc)
    for key, value in body.facts.items():
        stmt = pg_insert(AgentFact).values(agent_id=agent_id, key=key, value=value, updated_at=now)
        stmt = stmt.on_conflict_do_update(
            index_elements=[AgentFact.agent_id, AgentFact.key],
            set_={"value": value, "updated_at": now},
        )
        await db.execute(stmt)
    await db.commit()
    return {"ok": True}
