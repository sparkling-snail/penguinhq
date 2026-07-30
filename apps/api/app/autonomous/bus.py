"""
In-process inter-agent message router.

Each agent gets an inbox (asyncio.Queue). When agent A dispatches a task
to agent B, the bus:
  1. Puts an AgentMessage in B's inbox queue (instant, zero-latency delivery)
  2. The dispatch_task helper on BaseAgent calls the API to create a task
     record AND broadcast pigeon.dispatched over WebSocket (visual)

This replaces pigeon_simulator.py — pigeons become real.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("penguinhq.agents.bus")


@dataclass
class AgentMessage:
    """A message delivered to an agent's inbox."""

    source_agent_id: str
    source_role: str
    task_type: str  # e.g. "job_lead", "practice_problem", "research_request"
    payload: dict[str, Any]
    task_id: str = ""
    priority: str = "normal"  # "low", "normal", "high"


class AgentBus:
    """
    In-process message router for inter-agent communication.

    Each agent registers an inbox on startup. dispatch() delivers a message
    to the target agent's queue instantly (no network hop). The caller is
    responsible for also persisting the task via the API and broadcasting
    the pigeon.dispatched event for the visual layer.
    """

    def __init__(self) -> None:
        self._queues: dict[str, asyncio.Queue[AgentMessage]] = {}
        self._role_to_id: dict[str, str] = {}  # role -> agent_id

    def register(self, agent_id: str, role: str) -> asyncio.Queue[AgentMessage]:
        """Register an agent's inbox. Returns the queue to await on."""
        q: asyncio.Queue[AgentMessage] = asyncio.Queue()
        self._queues[agent_id] = q
        self._role_to_id[role] = agent_id
        logger.info("bus: registered inbox for %s (role=%s)", agent_id, role)
        return q

    def send(self, target_id: str, message: AgentMessage) -> None:
        """Send a message to a specific agent by ID."""
        q = self._queues.get(target_id)
        if q is None:
            logger.warning("bus: no inbox for agent %s, dropping message", target_id)
            return
        q.put_nowait(message)

    def send_by_role(self, target_role: str, message: AgentMessage) -> None:
        """Send a message to an agent by role name."""
        target_id = self._role_to_id.get(target_role)
        if target_id is None:
            logger.warning("bus: no agent with role %s, dropping message", target_role)
            return
        self.send(target_id, message)

    def broadcast(self, message: AgentMessage) -> None:
        """Send a message to ALL registered agents."""
        for agent_id, q in self._queues.items():
            if agent_id != message.source_agent_id:  # don't echo to sender
                q.put_nowait(message)

    @property
    def registered_agents(self) -> list[str]:
        return list(self._queues.keys())
