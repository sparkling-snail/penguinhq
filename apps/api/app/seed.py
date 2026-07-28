"""
Dev-only seed data.

Inserts the four named agents from the product spec exactly once (idempotent
— checks count first). This lets `/agents` and, later, the frontend roster
return something meaningful without a real agent-provisioning flow, which
doesn't exist yet.
"""

from sqlalchemy import func, select

from app.core.database import AsyncSessionLocal
from app.domain.models.agent import Agent

_SEED_AGENTS = [
    {"name": "Job Hunter", "role": "job_hunter", "room": "engineering", "avatar_color": "#F97316"},
    {"name": "Leetcode Coach", "role": "leetcode_coach", "room": "library", "avatar_color": "#8B5CF6"},
    {"name": "Tech Scout", "role": "tech_scout", "room": "research_lab", "avatar_color": "#EAB308"},
    {"name": "Portfolio Penguin", "role": "portfolio", "room": "launch_pad", "avatar_color": "#EC4899"},
]


async def seed_agents_if_empty() -> None:
    async with AsyncSessionLocal() as session:
        count = await session.scalar(select(func.count()).select_from(Agent))
        if count and count > 0:
            return

        for i, spec in enumerate(_SEED_AGENTS):
            session.add(
                Agent(
                    name=spec["name"],
                    role=spec["role"],
                    room=spec["room"],
                    avatar_color=spec["avatar_color"],
                    state="idle",
                    position_x=100.0 + i * 60,
                    position_y=200.0,
                )
            )
        await session.commit()
