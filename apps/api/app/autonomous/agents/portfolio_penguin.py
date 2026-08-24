"""
Portfolio Penguin — tracks job applications and coordinates with Job Hunter.

Mostly reactive: receives job_lead tasks from Job Hunter, evaluates them,
drafts cover letter outlines, and maintains the application pipeline.

Autonomous cycle: review pipeline status → summarize → idle.
Posts to #jobs channel.
"""

import logging
import re

from app.autonomous.base import BaseAgent
from app.autonomous.bus import AgentMessage

logger = logging.getLogger("penguinhq.agents.portfolio_penguin")


class PortfolioPenguinAgent(BaseAgent):
    role = "portfolio"
    cycle_seconds = 300  # Less frequent — mostly reactive
    chat_channel = "jobs"
    memory_limit = 16
    # Same schema as Job Hunter (both track the same candidate's job
    # search) — but note: facts are stored per-agent-id, not shared, so
    # Job Hunter learning "target_location" doesn't automatically inform
    # Portfolio Penguin yet. Each has to be told independently until
    # facts are keyed by candidate rather than by agent.
    fact_schema = [
        "candidate_name",
        "target_role",
        "target_location",
        "experience_level",
        "key_skills",
        "salary_expectation",
    ]

    def system_prompt(self) -> str:
        return (
            "You are Portfolio Penguin, an AI that tracks job applications and "
            "maintains resume and cover letter drafts. You coordinate with Job Hunter "
            "to keep the application pipeline organized. "
            "Reply concisely, 2-4 sentences."
        )

    @staticmethod
    def _is_job_hunter_request(message: str) -> bool:
        """Keep search and scraped-listing requests with Job Hunter."""
        normalized = re.sub(r"[^a-z0-9]+", " ", message.lower()).strip()
        mentions_jobs = bool(re.search(r"\b(?:jobs?|listings?)\b", normalized))
        search_action = bool(
            re.search(r"\b(?:search|find|found|scrape|scraped|collected)\b", normalized)
        )
        history_request = bool(
            re.search(r"\b(?:show|list|display|see|what|which)\b", normalized)
            and re.search(r"\b(?:today|all|found|collected|scraped)\b", normalized)
        )
        return mentions_jobs and (search_action or history_request)

    async def respond_to_message(
        self, message: str, reply_channel: str | None = None
    ) -> str | None:
        if self._is_job_hunter_request(message):
            logger.debug("[portfolio] ignoring Job Hunter request on shared #jobs channel")
            return None
        return await super().respond_to_message(message, reply_channel=reply_channel)

    async def run_cycle(self) -> None:
        """Periodic maintenance: summarize the current pipeline status."""
        await self.set_state("thinking")
        history = await self.fetch_memory(limit=10)
        summary = await self.ask_llm(
            "Based on the recent activity history, summarize the current job "
            "application pipeline status in 2-3 sentences. What needs attention?",
            history=history,
        )
        if summary:
            await self.announce(f"📊 Pipeline status: {summary}")
        await self.set_state("idle")

    async def handle_task(self, task: AgentMessage) -> None:
        """Handle inbound tasks — primarily job_lead from Job Hunter."""
        if task.task_type == "job_lead":
            await self.set_state("thinking")
            listing = task.payload.get("listing", "")
            fit_score = task.payload.get("fit_score", 0)

            if fit_score >= 7 and listing:
                # Draft a cover letter outline for high-fit jobs
                outline = await self.ask_llm(
                    f"Create a brief cover letter outline for this job:\n{listing}\n"
                    f"Include: opening hook, 2-3 relevant experience bullets, closing. "
                    f"Keep it concise — this is an outline, not a full letter."
                )
                if outline:
                    await self.announce(
                        f"📝 Tracking new application (fit: {fit_score}/10):\n"
                        f"{listing[:150]}...\n\n"
                        f"Cover letter outline:\n{outline}",
                    )
                    await self.append_memory(
                        "assistant",
                        f"TRACKING APPLICATION: {listing[:200]}",
                    )
            else:
                await self.announce(
                    f"📋 Logged listing (fit: {fit_score}/10): {listing[:100]}...",
                )

            await self.complete_task(task.task_id, {"tracked": True, "fit_score": fit_score})
            await self.set_state("idle")
        else:
            content = task.payload.get("content", str(task.payload))
            await self.respond_to_message(content)
