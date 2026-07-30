"""
Tech Scout — monitors technology trends, evaluates tools and frameworks.

Autonomous cycle: pick a topic → research → summarize → idle.
Posts to #research channel. Can dispatch search_for_role tasks to Job Hunter
when it discovers a technology that's hiring heavily.
"""

import logging

from app.autonomous.base import BaseAgent
from app.autonomous.bus import AgentMessage

logger = logging.getLogger("penguinhq.agents.tech_scout")


class TechScoutAgent(BaseAgent):
    role = "tech_scout"
    cycle_seconds = 240
    chat_channel = "research"
    memory_limit = 16

    def system_prompt(self) -> str:
        return (
            "You are Tech Scout, an AI that monitors technology trends and researches "
            "new tools and frameworks. You generate concise tech briefs on emerging "
            "technologies, comparing them to existing solutions. "
            "Reply concisely, 2-4 sentences unless a comparison is needed."
        )

    async def run_cycle(self) -> None:
        """Pick a trending topic, research it, produce a brief."""
        # Step 1: Pick a topic
        await self.set_state("planning")
        topic = await self.ask_llm(
            "Pick one trending technology topic (framework, language, tool, or paradigm) "
            "that a software engineer should know about in 2025-2026. Just name the topic, "
            "nothing else. Vary the topic each time — don't repeat recent picks."
        )
        if topic:
            await self.announce(f"🔭 Researching: {topic}")

        # Step 2: Produce a tech brief
        await self.set_state("researching")
        brief = await self.ask_llm(
            f"Write a concise tech brief on '{topic}'. Include: "
            f"1) What it is (1 sentence), 2) Why it matters now (1-2 sentences), "
            f"3) Key trade-offs vs. alternatives (2-3 sentences), "
            f"4) Verdict: worth adopting? (1 sentence)"
        )
        if brief:
            await self.announce(f"📋 Tech brief: {topic}\n{brief}")

        # Step 3: If this is a major technology, nudge Job Hunter to check the job market
        if topic and any(
            kw in topic.lower()
            for kw in ["framework", "language", "platform", "runtime", "stack"]
        ):
            await self.dispatch_task(
                destination_role="job_hunter",
                task_type="search_for_role",
                payload={"criteria": f"roles requiring {topic}"},
                priority="low",
            )

        await self.set_state("idle")

    async def handle_task(self, task: AgentMessage) -> None:
        """Handle incoming tasks (e.g., research a specific topic)."""
        if task.task_type == "research_topic":
            await self.set_state("researching")
            topic = task.payload.get("topic", str(task.payload))
            result = await self.ask_llm(
                f"Research this topic thoroughly and produce a concise brief: {topic}. "
                f"Include what it is, why it matters, trade-offs, and a verdict."
            )
            if result:
                await self.announce(f"🔬 Research result: {topic}\n{result}")
            await self.complete_task(task.task_id, {"result": result})
            await self.set_state("idle")
        else:
            content = task.payload.get("content", str(task.payload))
            await self.respond_to_message(content)
