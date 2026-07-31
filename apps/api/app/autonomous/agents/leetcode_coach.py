"""
Leetcode Coach — refactored from the original standalone agent.

Same behavior as the original apps/api/app/autonomous/leetcode_coach.py,
but now a BaseAgent subclass running inside the agent-runner container.

Autonomous cycle: invent problem → solve → critique → idle.
Receives human chat messages and practice_problem tasks from other agents.
"""

import logging

from app.autonomous.base import BaseAgent, _strip_code_fence
from app.autonomous.bus import AgentMessage

logger = logging.getLogger("penguinhq.agents.leetcode_coach")


class LeetcodeCoachAgent(BaseAgent):
    role = "leetcode_coach"
    cycle_seconds = 120
    chat_channel = "logs"
    memory_limit = 16
    fact_schema = ["preferred_language", "skill_level", "weak_topics"]

    def system_prompt(self) -> str:
        return (
            "You are Leetcode Coach, an AI that helps with coding-interview practice. "
            "Reply directly and helpfully, in character. 1-4 sentences unless code is "
            "genuinely needed to answer."
        )

    async def run_cycle(self) -> None:
        """Invent a problem, solve it, critique the solution."""
        await self.set_state("planning")
        problem = await self.ask_llm(
            "Invent one original, short coding-interview practice problem — vary the topic "
            "and difficulty each time you're asked. Give just the problem statement in 2-4 "
            "sentences. No solution, no preamble, no markdown headers."
        )
        if problem:
            await self.announce(f"📝 New practice problem:\n{problem}")

        await self.set_state("coding")
        solution = _strip_code_fence(
            await self.ask_llm(
                f"Solve this coding problem in Python. Reply with only the code, no explanation "
                f"before or after:\n\n{problem}"
            )
        )
        if solution:
            await self.announce(f"💻 My solution:\n```python\n{solution}\n```")

        await self.set_state("researching")
        critique = await self.ask_llm(
            f"Problem:\n{problem}\n\nMy solution:\n{solution}\n\n"
            "Critique this solution in 2-3 sentences: is it correct, what's the time "
            "complexity, and is there any edge case it misses? Be honest and specific — "
            "this is a self-review, not a pep talk."
        )
        if critique:
            await self.announce(f"🔍 Self-review: {critique}")

        await self.set_state("idle")

    async def handle_task(self, task: AgentMessage) -> None:
        """Handle incoming tasks (e.g., a practice problem request)."""
        if task.task_type == "practice_problem":
            await self.set_state("planning")
            topic = task.payload.get("topic", "any")
            problem = await self.ask_llm(
                f"Generate a coding-interview practice problem about {topic}. "
                f"Give just the problem statement in 2-4 sentences."
            )
            if problem:
                await self.announce(f"📝 Requested practice problem:\n{problem}")
            await self.complete_task(task.task_id, {"problem": problem})
            await self.set_state("idle")
        else:
            # Default: treat as a chat message
            content = task.payload.get("content", str(task.payload))
            await self.respond_to_message(content)
