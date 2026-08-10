"""
Leetcode Coach — refactored from the original standalone agent.

Same behavior as the original apps/api/app/autonomous/leetcode_coach.py,
but now a BaseAgent subclass running inside the agent-runner container.

Autonomous cycle: publish one user-facing practice problem, then wait for the
user's attempt. The coach guides and reviews; it never posts a full solution
unless the user explicitly asks to reveal one.
Receives human chat messages and practice_problem tasks from other agents.
"""

import logging
import re

from app.autonomous.base import BaseAgent
from app.autonomous.bus import AgentMessage

logger = logging.getLogger("penguinhq.agents.leetcode_coach")


class LeetcodeCoachAgent(BaseAgent):
    role = "leetcode_coach"
    cycle_seconds = 86400
    chat_channel = "leetcode"
    memory_limit = 16
    fact_schema = ["preferred_language", "skill_level", "weak_topics"]

    def system_prompt(self) -> str:
        return (
            "You are Leetcode Coach, an AI pair-programming coach. The user—not you—"
            "solves the problem. Give a concise problem statement, clarifying questions, "
            "test cases, progressively stronger hints, and feedback on the user's code. "
            "Do not provide a complete solution, full implementation, or line-by-line "
            "algorithm unless the user explicitly asks to reveal the answer. Encourage "
            "the user to explain their approach first. Keep replies to 1-4 sentences "
            "unless reviewing a submitted attempt."
        )

    async def run_cycle(self) -> None:
        """Publish one daily challenge, then leave the solving to the user."""
        await self.set_state("planning")
        problem = await self.ask_llm(
            "Invent one original, short coding-interview practice problem — vary the topic "
            "and difficulty each time you're asked. Give just the problem statement in 2-4 "
            "sentences. No solution, no preamble, no markdown headers."
        )
        if problem:
            await self.announce(f"📝 New practice problem:\n{problem}")
        await self.set_state("idle")

    async def respond_to_message(self, message: str, reply_channel: str | None = None) -> str | None:
        """Persist the coach's review when it was requested from a saved attempt."""
        reply = await super().respond_to_message(message, reply_channel)
        match = re.search(r"\[practice_attempt:([0-9a-f-]{36})\]", message, flags=re.IGNORECASE)
        if match and reply:
            try:
                await self._http.post(
                    f"{self._api_base()}/practice/attempts/{match.group(1)}/feedback",
                    json={"content": reply, "author": self.role},
                )
            except Exception:
                logger.exception("failed to save coaching feedback for attempt %s", match.group(1))
        return reply

    async def handle_task(self, task: AgentMessage) -> None:
        """Handle incoming tasks (e.g., a practice problem request)."""
        if task.task_type == "practice_problem":
            await self.set_state("planning")
            topic = task.payload.get("topic", "any")
            problem = await self.ask_llm(
                f"Generate a coding-interview practice problem about {topic}. "
                f"Give just the problem statement in 2-4 sentences—no solution or hints."
            )
            if problem:
                await self.announce(f"📝 Requested practice problem:\n{problem}")
            await self.complete_task(task.task_id, {"problem": problem})
            await self.set_state("idle")
        else:
            # Default: treat as a chat message
            content = task.payload.get("content", str(task.payload))
            await self.respond_to_message(content)
