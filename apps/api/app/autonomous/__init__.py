"""
PenguinHQ Multi-Agent Framework.

Every autonomous agent is a BaseAgent subclass running as an independent
asyncio.Task inside the agent-runner container. They communicate via the
AgentBus (in-process asyncio.Queue) and share a single HTTP client,
Anthropic client, and WebSocket listener.
"""

from app.autonomous.base import BaseAgent
from app.autonomous.bus import AgentBus, AgentMessage

__all__ = ["BaseAgent", "AgentBus", "AgentMessage"]
