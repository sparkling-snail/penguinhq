"""
Read-only agent listing.

Milestone 1 only needs to prove agents round-trip through Postgres and
back out over HTTP. Agent lifecycle mutation (spawning, state transitions
triggered by real task execution) arrives with the agent runtime
milestone.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.domain.models.agent import Agent
from app.domain.schemas.agent import AgentOut

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("", response_model=list[AgentOut])
async def list_agents(db: AsyncSession = Depends(get_db_session)) -> list[AgentOut]:
    result = await db.execute(select(Agent))
    agents = result.scalars().all()
    return [AgentOut.from_orm_flat(agent) for agent in agents]
