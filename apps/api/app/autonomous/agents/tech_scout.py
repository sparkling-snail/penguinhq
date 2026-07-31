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
        # The model sometimes wraps its answer in **bold** despite "just name the
        # topic" — strip it here since this string gets wrapped in ** again below;
        # left alone, that produces broken nested asterisks like ****topic****.
        topic = topic.strip().strip("*").strip()
        if topic:
            await self.announce(f"🔭 Researching: **{topic}**")

        # Step 2: Produce a tech brief
        await self.set_state("researching")
        brief = await self.ask_llm(
            f"Write a concise tech brief on '{topic}'. Reply in EXACTLY this format, "
            f"one section per line, each starting with the bold label shown (double "
            f"asterisks) followed by your answer on the same line — no extra headers, "
            f"no preamble, no markdown besides the bold labels:\n\n"
            f"**What it is:** <1 sentence>\n"
            f"**Why it matters:** <1-2 sentences>\n"
            f"**Trade-offs:** <2-3 sentences comparing it to alternatives>\n"
            f"**Verdict:** <1 sentence — worth adopting?>"
        )
        if brief:
            await self.announce(f"📋 **Tech brief: {topic}**\n\n{brief}")

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
                f"Research this topic thoroughly. Reply in EXACTLY this format, one "
                f"section per line, each starting with the bold label shown:\n\n"
                f"**What it is:** <1 sentence>\n"
                f"**Why it matters:** <1-2 sentences>\n"
                f"**Trade-offs:** <2-3 sentences>\n"
                f"**Verdict:** <1 sentence>\n\n"
                f"Topic: {topic}"
            )
            if result:
                await self.announce(f"🔬 **Research: {topic}**\n\n{result}")
            await self.complete_task(task.task_id, {"result": result})
            await self.set_state("idle")
        else:
            content = task.payload.get("content", str(task.payload))
            await self.respond_to_message(content)
