"""
Job Hunter — searches for job opportunities and dispatches leads to Portfolio Penguin.

Autonomous cycle: generate listing → evaluate fit → dispatch lead → idle.
Posts to #jobs channel. Dispatches job_lead tasks to Portfolio Penguin.
Receives search_request tasks from humans or other agents.
"""

import json
import logging

from app.autonomous.base import BaseAgent
from app.autonomous.bus import AgentMessage

logger = logging.getLogger("penguinhq.agents.job_hunter")


class JobHunterAgent(BaseAgent):
    role = "job_hunter"
    cycle_seconds = 180
    chat_channel = "jobs"
    memory_limit = 16

    def system_prompt(self) -> str:
        return (
            "You are Job Hunter, an AI agent that searches for and evaluates job listings. "
            "You invent realistic job listings that match a software engineer's profile, "
            "evaluate fit, and hand promising leads to Portfolio Penguin for tracking. "
            "Reply concisely, 2-4 sentences unless listing details are needed."
        )

    async def run_cycle(self) -> None:
        """Generate a job listing, evaluate it, dispatch leads."""
        # Step 1: Generate a job listing
        await self.set_state("planning")
        listing = await self.ask_llm(
            "Generate one realistic software engineering job listing. Include: "
            "company name, role title, required skills (3-5), salary range, and "
            "a 2-sentence description. Vary the company size, industry, and tech stack each time. "
            "Format as a brief, readable listing."
        )
        if listing:
            await self.announce(f"🔍 Found a new listing:\n{listing}")

        # Step 2: Evaluate fit
        await self.set_state("researching")
        evaluation = await self.ask_llm(
            f"Evaluate this job listing for a mid-level software engineer "
            f"with Python, TypeScript, and cloud experience:\n\n{listing}\n\n"
            "Rate fit on a scale of 1-10 and explain why in 2-3 sentences. "
            "Start your response with the number, e.g. '7/10 - ...'"
        )
        if evaluation:
            await self.announce(f"📊 Fit evaluation: {evaluation}")

        # Step 3: Dispatch promising leads to Portfolio Penguin
        # Extract a rough fit score from the evaluation text
        fit_score = 5  # default
        try:
            digits = [c for c in evaluation if c.isdigit()]
            if digits:
                fit_score = int(digits[0])
        except Exception:
            pass

        if fit_score >= 6:
            await self.dispatch_task(
                destination_role="portfolio",
                task_type="job_lead",
                payload={
                    "listing": listing,
                    "fit_score": fit_score,
                    "evaluation": evaluation,
                },
                priority="high" if fit_score >= 8 else "normal",
            )
            await self.announce(f"📤 Dispatched to Portfolio Penguin (fit: {fit_score}/10)")
        else:
            await self.announce(f"📋 Listing logged (fit: {fit_score}/10 — below threshold)")

        await self.set_state("idle")

    async def handle_task(self, task: AgentMessage) -> None:
        """Handle incoming tasks."""
        if task.task_type == "search_for_role":
            await self.set_state("planning")
            criteria = task.payload.get("criteria", str(task.payload))
            result = await self.ask_llm(
                f"Someone requested a job search with these criteria: {criteria}. "
                f"Generate 2-3 relevant job listings matching their request. "
                f"Format each as a brief, readable listing."
            )
            if result:
                await self.announce(f"🎯 Targeted search results:\n{result}")
            await self.complete_task(task.task_id, {"result": result})
            await self.set_state("idle")
        else:
            content = task.payload.get("content", str(task.payload))
            await self.respond_to_message(content)
