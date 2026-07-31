"""
Tech Scout — monitors technology trends, evaluates tools and frameworks.

Autonomous cycle: pick a topic → research → summarize → idle. Uses Anthropic's
hosted web_search tool (server-side, no separate API key) so topics and briefs
are grounded in real current search results, not just training-data guesses.
Posts to #research channel. Can dispatch search_for_role tasks to Job Hunter
when it discovers a technology that's hiring heavily.
"""

import logging

from app.autonomous.base import BaseAgent
from app.autonomous.bus import AgentMessage

logger = logging.getLogger("penguinhq.agents.tech_scout")


class TechScoutAgent(BaseAgent):
    role = "tech_scout"
    # 1200s (20 min) = 72 cycles/day. Each cycle makes 2 web-search-enabled
    # LLM calls at max_uses=1 (~$0.01/search) plus small Haiku token cost —
    # worst case ~$0.026/cycle * 72 = ~$1.90/day, comfortably under a $3/day
    # target. Don't shrink this without recomputing the math above.
    cycle_seconds = 1200
    chat_channel = "research"
    memory_limit = 16
    fact_schema = ["interests"]

    def system_prompt(self) -> str:
        return (
            "You are Tech Scout, an AI that monitors technology trends and researches "
            "new tools and frameworks. You generate concise tech briefs on emerging "
            "technologies, comparing them to existing solutions. "
            "Reply concisely, 2-4 sentences unless a comparison is needed."
        )

    async def run_cycle(self) -> None:
        """Pick a trending topic, research it, produce a brief."""
        # Step 1: Pick a topic — search the web rather than guessing from
        # training data, so picks reflect what's actually being discussed now.
        await self.set_state("planning")
        topic = await self.ask_llm(
            "Search the web for what's trending in software engineering discussions "
            "right now — a framework, language, tool, or paradigm that's actually "
            "getting real attention (recent release, HN/Reddit buzz, notable adoption). "
            "Pick one specific real topic from what you find. Reply with just the topic "
            "name, nothing else. Vary the topic each time — don't repeat recent picks.",
            web_search=True,
        )
        # The model sometimes wraps its answer in **bold** despite "just name the
        # topic" — strip it here since this string gets wrapped in ** again below;
        # left alone, that produces broken nested asterisks like ****topic****.
        topic = topic.strip().strip("*").strip()
        if topic:
            await self.announce(f"🔭 Researching: **{topic}**")

        # Step 2: Produce a tech brief grounded in current search results,
        # not just what the model already knew from training.
        await self.set_state("researching")
        brief = await self.ask_llm(
            f"Search the web for current, real information on '{topic}' — recent "
            f"releases, adoption trends, how people are actually using it, and how it "
            f"compares to alternatives. Then write a concise tech brief based on what "
            f"you find. Reply in EXACTLY this format, one section per line, each "
            f"starting with the bold label shown (double asterisks) followed by your "
            f"answer on the same line — no extra headers, no preamble, no markdown "
            f"besides the bold labels:\n\n"
            f"**What it is:** <1 sentence>\n"
            f"**Why it matters:** <1-2 sentences>\n"
            f"**Trade-offs:** <2-3 sentences comparing it to alternatives>\n"
            f"**Verdict:** <1 sentence — worth adopting?>",
            web_search=True,
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
                f"Search the web and research this topic thoroughly using what you "
                f"find. Reply in EXACTLY this format, one section per line, each "
                f"starting with the bold label shown:\n\n"
                f"**What it is:** <1 sentence>\n"
                f"**Why it matters:** <1-2 sentences>\n"
                f"**Trade-offs:** <2-3 sentences>\n"
                f"**Verdict:** <1 sentence>\n\n"
                f"Topic: {topic}",
                web_search=True,
            )
            if result:
                await self.announce(f"🔬 **Research: {topic}**\n\n{result}")
            await self.complete_task(task.task_id, {"result": result})
            await self.set_state("idle")
        else:
            content = task.payload.get("content", str(task.payload))
            await self.respond_to_message(content)
