"""
Ingest endpoint for Claude Code hook events.

Claude Code invokes `hooks/agent-tracker.sh` (repo root) on
PreToolUse/PostToolUse/Stop/UserPromptSubmit, which POSTs the raw hook
JSON here. This is the real event-driven path for agent *state*: map what
a tool call implies about what the agent is doing and broadcast it over
the existing WebSocket, no new transport needed.

Sessions are assigned round-robin to agents that are NOT running
autonomously (i.e. agents whose role is NOT in AUTONOMOUS_ROLES). This
fixes the collision bug documented in ARCHITECTURE.md where hook-driven
state changes would flicker against the autonomous agent's own state
updates.
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.domain.models.agent import Agent
from app.domain.schemas.agent import AgentOut
from app.domain.schemas.events import WSEventType, make_event
from app.ws.connection_manager import connection_manager

logger = logging.getLogger("penguinhq.hooks")

router = APIRouter(prefix="/hooks", tags=["hooks"])

# Tool name -> AgentState (app/domain/schemas/agent.py). Unmapped tools
# fall back to "thinking" rather than erroring — new tools show up
# constantly and shouldn't break ingestion.
_TOOL_TO_STATE = {
    "Edit": "coding",
    "Write": "coding",
    "NotebookEdit": "coding",
    "Bash": "debugging",
    "WebFetch": "researching",
    "WebSearch": "researching",
    "Read": "thinking",
    "Grep": "thinking",
    "Glob": "thinking",
    "Task": "meeting",
    "Agent": "meeting",
}

_session_agents: dict[str, str] = {}

# Roles that run autonomously in the agent-runner container.
# These are EXCLUDED from the hooks round-robin to prevent state collisions.
AUTONOMOUS_ROLES = {"job_hunter", "leetcode_coach", "tech_scout", "portfolio"}


async def _agent_for_session(db: AsyncSession, session_id: str) -> Agent | None:
    """Resolve a Claude Code session to an agent, excluding autonomous ones."""
    agent_id = _session_agents.get(session_id)
    if agent_id is None:
        result = await db.execute(select(Agent).order_by(Agent.created_at))
        all_agents = result.scalars().all()
        # Filter out autonomous agents — they manage their own state
        eligible = [a for a in all_agents if a.role not in AUTONOMOUS_ROLES]
        if not eligible:
            # Fallback: if no non-autonomous agents exist, use all agents
            eligible = list(all_agents)
        if not eligible:
            return None
        agent = eligible[len(_session_agents) % len(eligible)]
        _session_agents[session_id] = agent.id
        return agent

    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    return result.scalar_one_or_none()


def _state_for(hook_event: str, tool_name: str) -> str:
    if hook_event == "Stop":
        return "idle"
    if hook_event == "UserPromptSubmit":
        return "planning"
    return _TOOL_TO_STATE.get(tool_name, "thinking")


@router.post("/event")
async def receive_hook_event(body: dict, db: AsyncSession = Depends(get_db_session)) -> dict:
    session_id = body.get("session_id")
    if not session_id:
        return {"ok": False, "reason": "missing session_id"}

    agent = await _agent_for_session(db, session_id)
    if agent is None:
        return {"ok": False, "reason": "no agents to assign"}

    hook_event = body.get("hook_event_name", "")
    tool_name = body.get("tool_name", "")
    new_state = _state_for(hook_event, tool_name)

    if agent.state != new_state:
        agent.state = new_state
        await db.commit()
        await db.refresh(agent)
        await connection_manager.broadcast(
            make_event(
                WSEventType.AGENT_STATE_CHANGED,
                AgentOut.from_orm_flat(agent).model_dump(mode="json"),
            )
        )
        logger.info("agent %s (%s) -> %s via %s/%s", agent.name, agent.id, new_state, hook_event, tool_name)

    return {"ok": True, "agent": agent.name, "state": new_state}
