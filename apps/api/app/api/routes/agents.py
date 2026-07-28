"""
Agent listing + state mutation.

Milestone 1 only needed agents to round-trip through Postgres and back
out over HTTP (list_agents). `update_agent_state` is the seam a real,
autonomous agent process (see app/autonomous/leetcode_coach.py) uses to
report its own state changes — as opposed to app/api/routes/hooks.py,
which reports state changes *inferred* from a Claude Code session's tool
use. Same broadcast, different source of truth.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.domain.models.agent import Agent
from app.domain.schemas.agent import AgentOut
from app.domain.schemas.events import WSEventType, make_event
from app.ws.connection_manager import connection_manager

router = APIRouter(prefix="/agents", tags=["agents"])


class AgentStateUpdate(BaseModel):
    state: str


@router.get("", response_model=list[AgentOut])
async def list_agents(db: AsyncSession = Depends(get_db_session)) -> list[AgentOut]:
    result = await db.execute(select(Agent))
    agents = result.scalars().all()
    return [AgentOut.from_orm_flat(agent) for agent in agents]


@router.post("/{agent_id}/state", response_model=AgentOut)
async def update_agent_state(
    agent_id: str, body: AgentStateUpdate, db: AsyncSession = Depends(get_db_session)
) -> AgentOut:
    agent = await db.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="agent not found")

    agent.state = body.state
    await db.commit()
    await db.refresh(agent)

    out = AgentOut.from_orm_flat(agent)
    await connection_manager.broadcast(make_event(WSEventType.AGENT_STATE_CHANGED, out.model_dump(mode="json")))
    return out
