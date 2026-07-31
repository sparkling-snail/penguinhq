"""
Job Hunter — searches real job listings via The Muse's public API and
dispatches leads to Portfolio Penguin.

Not LinkedIn/Glassdoor: both explicitly prohibit automated scraping in
their Terms of Service and actively detect/block it (LinkedIn has won
lawsuits against scrapers; neither offers a public API an individual can
sign up for). The Muse is a genuine public job-search API — no API key
required at all, real listings from real companies.

Autonomous cycle: fetch a real listing → evaluate fit → dispatch lead → idle.
Posts to #jobs channel. Dispatches job_lead tasks to Portfolio Penguin.
Receives search_for_role tasks from other agents (e.g. Tech Scout) or humans.
"""

import logging
import os
import random
import re

from app.autonomous.base import BaseAgent
from app.autonomous.bus import AgentMessage

logger = logging.getLogger("penguinhq.agents.job_hunter")

THE_MUSE_API = "https://www.themuse.com/api/public/jobs"
THE_MUSE_CATEGORY = os.environ.get("THE_MUSE_CATEGORY", "Software Engineering")
THE_MUSE_LOCATION = os.environ.get("THE_MUSE_LOCATION", "")  # optional, e.g. "New York, NY"

_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(html: str) -> str:
    text = _TAG_RE.sub(" ", html or "")
    return re.sub(r"\s+", " ", text).strip()


def _format_listing(job: dict) -> str:
    title = job.get("name", "Untitled role")
    company = (job.get("company") or {}).get("name", "Unknown company")
    locations = job.get("locations") or []
    location = ", ".join(loc.get("name", "") for loc in locations) or "Unspecified location"
    url = (job.get("refs") or {}).get("landing_page", "")
    description = _strip_html(job.get("contents", ""))
    if len(description) > 400:
        description = description[:400] + "..."

    lines = [f"**{title}** at {company}", f"📍 {location}"]
    if description:
        lines.append(f"\n{description}")
    if url:
        lines.append(f"\n🔗 {url}")
    return "\n".join(lines)


class JobHunterAgent(BaseAgent):
    role = "job_hunter"
    cycle_seconds = 180
    chat_channel = "jobs"
    memory_limit = 16

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        # In-memory only — resets on restart. Good enough to avoid
        # announcing the same listing twice in a row; not meant as a
        # permanent dedupe ledger.
        self._seen_job_ids: set[int] = set()

    def system_prompt(self) -> str:
        return (
            "You are Job Hunter, an AI agent that searches real job listings and "
            "evaluates them against a candidate's profile. You hand promising leads "
            "to Portfolio Penguin for tracking. Reply concisely, 2-4 sentences unless "
            "listing details are needed."
        )

    async def _fetch_real_listing(
        self, category: str | None = None, count: int = 1
    ) -> list[dict]:
        """Fetch real, not-yet-seen listings from The Muse's public API.
        Returns an empty list on failure — callers must handle that
        rather than falling back to inventing a listing."""
        params = {
            "category": category or THE_MUSE_CATEGORY,
            "page": random.randint(0, 4),  # rotate so cycles don't repeat page 0 forever
        }
        if THE_MUSE_LOCATION:
            params["location"] = THE_MUSE_LOCATION

        try:
            resp = await self._http.get(THE_MUSE_API, params=params, timeout=15.0)
            resp.raise_for_status()
            results = resp.json().get("results", [])
        except Exception:
            logger.exception("[job_hunter] The Muse API call failed")
            return []

        fresh = [r for r in results if r.get("id") not in self._seen_job_ids]
        pool = fresh or results
        random.shuffle(pool)
        picked = pool[:count]
        for job in picked:
            if job.get("id"):
                self._seen_job_ids.add(job["id"])
        if len(self._seen_job_ids) > 500:  # cap unbounded growth
            self._seen_job_ids = set(list(self._seen_job_ids)[-250:])
        return picked

    async def run_cycle(self) -> None:
        """Fetch a real job listing, evaluate it, dispatch leads."""
        await self.set_state("searching")
        jobs = await self._fetch_real_listing()
        if not jobs:
            await self.announce(
                "⚠️ Couldn't fetch real listings this cycle (The Muse API may be "
                "unreachable or rate-limited). Will retry next cycle."
            )
            await self.set_state("idle")
            return

        job = jobs[0]
        listing = _format_listing(job)
        await self.announce(f"🔍 Found a new listing:\n{listing}")

        await self.set_state("evaluating")
        evaluation = await self.ask_llm(
            f"Evaluate this real job listing for a mid-level software engineer "
            f"with Python, TypeScript, and cloud experience:\n\n{listing}\n\n"
            "Rate fit on a scale of 1-10 and explain why in 2-3 sentences. "
            "Start your response with the number, e.g. '7/10 - ...'"
        )
        if evaluation:
            await self.announce(f"📊 Fit evaluation: {evaluation}")

        fit_score = 5
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
                    "url": (job.get("refs") or {}).get("landing_page", ""),
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
            await self.set_state("searching")
            criteria = task.payload.get("criteria", str(task.payload))
            # The Muse's API filters by a fixed category taxonomy, not
            # free-text keywords, so an arbitrary "criteria" string (e.g.
            # from Tech Scout's "roles requiring Rust") can't be mapped
            # precisely — fetch from the configured default category and
            # say so, rather than silently pretending it was filtered.
            jobs = await self._fetch_real_listing(count=3)
            if jobs:
                formatted = "\n\n".join(_format_listing(j) for j in jobs)
                await self.announce(
                    f"🎯 Requested search for '{criteria}' — The Muse doesn't support "
                    f"free-text search, so here are current {THE_MUSE_CATEGORY} listings "
                    f"instead:\n{formatted}"
                )
                result = formatted
            else:
                await self.announce(f"⚠️ Couldn't fetch listings for '{criteria}' right now.")
                result = None
            await self.complete_task(task.task_id, {"result": result})
            await self.set_state("idle")
        else:
            content = task.payload.get("content", str(task.payload))
            await self.respond_to_message(content)
