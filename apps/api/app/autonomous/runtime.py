"""
Agent runtime — orchestrates all agents in a single process.

One container, one process, N concurrent agents. Each agent runs as an
independent asyncio.Task with its own loop, sharing a single HTTP client,
Anthropic client, and AgentBus.
"""

import asyncio
import logging
import os

import httpx
from anthropic import AsyncAnthropic

from app.autonomous.base import BaseAgent
from app.autonomous.bus import AgentBus

logger = logging.getLogger("penguinhq.agents.runtime")

API_BASE = os.environ.get("PENGUINHQ_API_BASE", "http://api:8000")
API_TOKEN = os.environ.get("PENGUINHQ_API_TOKEN", "")
API_RETRY_SECONDS = 5


# Lazy registry — imported here to avoid circular imports at module level.
# Maps agent role -> (module_path, class_name) so we can discover agents
# without importing them all upfront.
AGENT_REGISTRY: dict[str, tuple[str, str]] = {
    "job_hunter": ("app.autonomous.agents.job_hunter", "JobHunterAgent"),
    "leetcode_coach": ("app.autonomous.agents.leetcode_coach", "LeetcodeCoachAgent"),
    "tech_scout": ("app.autonomous.agents.tech_scout", "TechScoutAgent"),
    "portfolio": ("app.autonomous.agents.portfolio_penguin", "PortfolioPenguinAgent"),
}


def _load_agent_class(role: str) -> type[BaseAgent] | None:
    """Dynamically import and return the agent class for a given role."""
    entry = AGENT_REGISTRY.get(role)
    if entry is None:
        return None
    module_path, class_name = entry
    try:
        import importlib
        module = importlib.import_module(module_path)
        return getattr(module, class_name)
    except Exception:
        logger.exception("failed to load agent class for role %s", role)
        return None


class AgentRuntime:
    """
    Discovers, instantiates, and runs all agents.

    Lifecycle:
      1. Fetch all agent records from the API
      2. For each record, load the corresponding BaseAgent subclass
      3. Create shared infrastructure (httpx, AsyncAnthropic, AgentBus)
      4. Instantiate each agent and call agent.run() as an asyncio.Task
      5. await all tasks (runs forever)
    """

    def __init__(self) -> None:
        self._http: httpx.AsyncClient | None = None
        self._anthropic: AsyncAnthropic | None = None
        self._bus = AgentBus()
        self._agents: list[BaseAgent] = []
        self._tasks: list[asyncio.Task] = []

    async def _fetch_agent_records(self) -> list[dict]:
        """Wait for the API instead of permanently exiting during startup races."""
        assert self._http is not None
        while True:
            try:
                response = await self._http.get(f"{API_BASE}/agents")
                response.raise_for_status()
                return response.json()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning(
                    "API is not ready at %s; retrying in %ss",
                    API_BASE,
                    API_RETRY_SECONDS,
                )
                await asyncio.sleep(API_RETRY_SECONDS)

    async def start(self) -> None:
        """Initialize shared infrastructure and launch all agents."""
        logger.info("PenguinHQ Agent Runtime starting...")

        # Shared HTTP client for all agents
        headers = {"Authorization": f"Bearer {API_TOKEN}"} if API_TOKEN else {}
        self._http = httpx.AsyncClient(timeout=30.0, headers=headers)

        # Shared Anthropic client (reads ANTHROPIC_API_KEY from env)
        self._anthropic = AsyncAnthropic()

        # Fetch all agent records from the API. Compose can start this process
        # before FastAPI is listening, so treat initial connection failures as
        # expected readiness lag rather than a terminal agent-runtime failure.
        agent_records = await self._fetch_agent_records()

        logger.info("found %d agent records in DB", len(agent_records))

        # Instantiate each agent
        for record in agent_records:
            role = record.get("role", "")
            agent_cls = _load_agent_class(role)
            if agent_cls is None:
                logger.warning("no agent class registered for role '%s', skipping", role)
                continue

            agent = agent_cls(
                agent_record=record,
                http=self._http,
                anthropic=self._anthropic,
                bus=self._bus,
            )
            self._agents.append(agent)
            logger.info("instantiated agent: %s (role=%s, id=%s)", agent.name, role, agent.id)

        if not self._agents:
            logger.error("no agents could be instantiated — exiting")
            return

        # Launch each agent's run() as an independent asyncio.Task
        for agent in self._agents:
            task = asyncio.create_task(agent.run(), name=f"agent-{agent.role}")
            self._tasks.append(task)

        logger.info("launched %d agents, waiting...", len(self._agents))

        # Run forever — if any agent task dies, log and restart it
        while True:
            done, pending = await asyncio.wait(
                self._tasks, return_when=asyncio.FIRST_COMPLETED
            )
            for task in done:
                agent_role = task.get_name()
                if task.exception():
                    logger.exception(
                        "agent task %s crashed", agent_role,
                        exc_info=task.exception(),
                    )
                else:
                    logger.warning("agent task %s exited unexpectedly", agent_role)

                # Find the agent and restart it
                for agent in self._agents:
                    if f"agent-{agent.role}" == agent_role:
                        new_task = asyncio.create_task(agent.run(), name=f"agent-{agent.role}")
                        self._tasks.remove(task)
                        self._tasks.append(new_task)
                        logger.info("restarted agent: %s", agent.role)
                        break

    async def stop(self) -> None:
        """Gracefully shut down all agents."""
        logger.info("Agent Runtime shutting down...")
        for task in self._tasks:
            task.cancel()
        if self._http:
            await self._http.aclose()
