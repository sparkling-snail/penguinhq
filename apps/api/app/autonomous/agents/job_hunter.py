"""
Job Hunter — collects public LinkedIn job listings, persists them, and
dispatches promising leads to Portfolio Penguin.

Autonomous cycle: fetch a real listing → evaluate fit → dispatch lead → idle.
Posts to #jobs channel. Dispatches job_lead tasks to Portfolio Penguin.
Receives search_for_role tasks from other agents (e.g. Tech Scout) or humans.
"""

import logging
import os
import re
from urllib.parse import quote_plus

from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright

from app.autonomous.base import BaseAgent
from app.autonomous.bus import AgentMessage

logger = logging.getLogger("penguinhq.agents.job_hunter")

LINKEDIN_KEYWORDS = os.environ.get("LINKEDIN_JOB_KEYWORDS", "Software Engineer")
LINKEDIN_LOCATION = os.environ.get("LINKEDIN_JOB_LOCATION", "")
LINKEDIN_MAX_LISTINGS = max(1, min(int(os.environ.get("LINKEDIN_MAX_LISTINGS", "10")), 25))

_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(html: str) -> str:
    text = _TAG_RE.sub(" ", html or "")
    return re.sub(r"\s+", " ", text).strip()


def _format_listing(job: dict) -> str:
    title = job.get("title", "Untitled role")
    company = job.get("company") or "Unknown company"
    location = job.get("location") or "Unspecified location"
    url = job.get("url", "")
    description = _strip_html(job.get("description", ""))
    if len(description) > 400:
        description = description[:400] + "..."

    lines = [f"**{title}** at {company}", f"📍 {location}"]
    if description:
        lines.append(f"\n{description}")
    if url:
        lines.append(f"\n🔗 {url}")
    return "\n".join(lines)


class LinkedInJobCollector:
    """Collect public listing pages without authentication or access-control bypasses."""

    _skill_terms = (
        "python", "typescript", "javascript", "react", "node.js", "java", "golang",
        "rust", "aws", "azure", "gcp", "docker", "kubernetes", "sql", "postgresql",
        "terraform", "machine learning", "llm",
    )

    @staticmethod
    def _text(value: str | None) -> str:
        return re.sub(r"\s+", " ", value or "").strip()

    @staticmethod
    def _source_id(url: str) -> str:
        match = re.search(r"(?:currentJobId|jobId|view)/(\d+)", url)
        return match.group(1) if match else url.rstrip("/").rsplit("/", 1)[-1]

    async def _optional_text(self, page, selector: str) -> str:
        try:
            return self._text(await page.locator(selector).first.text_content(timeout=3_000))
        except PlaywrightTimeoutError:
            return ""

    async def collect(self, keywords: str, location: str, limit: int) -> list[dict]:
        search_url = (
            "https://www.linkedin.com/jobs/search/?f_TPR=r604800"
            f"&keywords={quote_plus(keywords)}&location={quote_plus(location)}"
        )
        try:
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(headless=True)
                context = await browser.new_context(
                    user_agent=(
                        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                        "Chrome/122.0 Safari/537.36"
                    )
                )
                page = await context.new_page()
                await page.goto(search_url, wait_until="domcontentloaded", timeout=30_000)
                await page.wait_for_timeout(750)
                urls = await page.locator(
                    "a.base-card__full-link, a[href*='/jobs/view/']"
                ).evaluate_all("links => [...new Set(links.map(link => link.href))]")
                listings: list[dict] = []
                for url in urls[:limit]:
                    listing = await self._extract(page, url)
                    if listing:
                        listings.append(listing)
                await context.close()
                await browser.close()
                return listings
        except PlaywrightTimeoutError:
            logger.warning("[job_hunter] LinkedIn page timed out")
        except Exception:
            logger.exception("[job_hunter] LinkedIn collection failed")
        return []

    async def _extract(self, page, url: str) -> dict | None:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(300)
            title = self._text(await page.locator("h1").first.text_content(timeout=5_000))
            if not title:
                return None
            company = await self._optional_text(page, ".topcard__org-name-link, .topcard__flavor--black-link")
            location = await self._optional_text(page, ".topcard__flavor--bullet, .topcard__flavor--metadata")
            description = await self._optional_text(page, ".show-more-less-html__markup, .description__text")
            posted_date = await self._optional_text(page, ".posted-time-ago__text, time")
            salary = await self._optional_text(page, ".compensation__salary, [class*='salary']")
        except PlaywrightTimeoutError:
            return None

        lower_description = description.lower()
        skills = [term for term in self._skill_terms if term in lower_description]
        return {
            "source": "linkedin",
            "source_job_id": self._source_id(url),
            "url": url,
            "title": title,
            "company": company or None,
            "location": location or None,
            "salary": salary or None,
            "description": description or None,
            "skills": skills,
            "posted_date": posted_date or None,
        }


class JobHunterAgent(BaseAgent):
    role = "job_hunter"
    cycle_seconds = 180
    chat_channel = "jobs"
    memory_limit = 16
    fact_schema = [
        "candidate_name",
        "target_role",
        "target_location",
        "experience_level",
        "key_skills",
        "salary_expectation",
    ]

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        # In-memory only — resets on restart. Good enough to avoid
        # announcing the same listing twice in a row; not meant as a
        # permanent dedupe ledger.
        self._seen_job_ids: set[str] = set()
        self._collector = LinkedInJobCollector()

    def system_prompt(self) -> str:
        return (
            "You are Job Hunter, an AI agent that searches real job listings and "
            "evaluates them against a candidate's profile. You hand promising leads "
            "to Portfolio Penguin for tracking. Reply concisely, 2-4 sentences unless "
            "listing details are needed."
        )

    async def _fetch_listings(self, keywords: str | None = None, count: int = 1) -> list[dict]:
        """Collect, persist, and deduplicate current public LinkedIn listings."""
        results = await self._collector.collect(
            keywords or LINKEDIN_KEYWORDS, LINKEDIN_LOCATION, max(count, LINKEDIN_MAX_LISTINGS)
        )
        for job in results:
            try:
                response = await self._http.post(
                    f"{self._api_base()}/jobs/ingest", json=job, timeout=15.0
                )
                response.raise_for_status()
            except Exception:
                logger.exception("[job_hunter] failed to persist LinkedIn listing")
        fresh = [job for job in results if job["source_job_id"] not in self._seen_job_ids]
        picked = (fresh or results)[:count]
        for job in picked:
            self._seen_job_ids.add(job["source_job_id"])
        if len(self._seen_job_ids) > 500:  # cap unbounded growth
            self._seen_job_ids = set(list(self._seen_job_ids)[-250:])
        return picked

    async def run_cycle(self) -> None:
        """Fetch a real job listing, evaluate it, dispatch leads."""
        await self.set_state("searching")
        jobs = await self._fetch_listings()
        if not jobs:
            await self.announce(
                "⚠️ Couldn't collect LinkedIn listings this cycle. Will retry next cycle."
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
                    "url": job.get("url", ""),
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
            jobs = await self._fetch_listings(criteria, count=3)
            if jobs:
                formatted = "\n\n".join(_format_listing(j) for j in jobs)
                await self.announce(
                    f"🎯 Requested LinkedIn search for '{criteria}':\n{formatted}"
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
