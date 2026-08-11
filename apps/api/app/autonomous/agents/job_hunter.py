"""
Job Hunter — collects public LinkedIn job listings, persists them, and
dispatches promising leads to Portfolio Penguin.

Autonomous cycle: fetch a real listing → evaluate fit → dispatch lead → idle.
Posts to #jobs channel. Dispatches job_lead tasks to Portfolio Penguin.
Receives search_for_role tasks from other agents (e.g. Tech Scout) or humans.
"""

import json
import logging
import os
import re
from collections.abc import Iterable
from datetime import date
from typing import Any

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from app.autonomous.base import BaseAgent
from app.autonomous.bus import AgentMessage

logger = logging.getLogger("penguinhq.agents.job_hunter")

LINKEDIN_KEYWORDS = os.environ.get(
    "LINKEDIN_JOB_KEYWORDS",
    "Site Reliability Engineer, Production Engineer, MLOps, AI Engineer",
)
LINKEDIN_LOCATION = os.environ.get("LINKEDIN_JOB_LOCATION", "Singapore")
LINKEDIN_MAX_LISTINGS = max(1, min(int(os.environ.get("LINKEDIN_MAX_LISTINGS", "10")), 1_000))
JOB_HUNTER_DAILY_LIMIT = max(1, int(os.environ.get("JOB_HUNTER_DAILY_LIMIT", "10")))
MAX_EXPERIENCE_YEARS = max(0, int(os.environ.get("MAX_EXPERIENCE_YEARS", "7")))
APIFY_LINKEDIN_ACTOR = os.environ.get("APIFY_LINKEDIN_ACTOR", "valig/linkedin-jobs-scraper")
APIFY_MCP_URL = os.environ.get(
    "APIFY_MCP_URL",
    "https://mcp.apify.com/?tools=actors,docs,valig/linkedin-jobs-scraper",
)
APIFY_MCP_TOOL_NAME = os.environ.get("APIFY_MCP_TOOL_NAME", "")
APIFY_MCP_TIMEOUT_SECONDS = max(30, int(os.environ.get("APIFY_MCP_TIMEOUT_SECONDS", "120")))

_TAG_RE = re.compile(r"<[^>]+>")
_EXPERIENCE_YEARS_RE = re.compile(
    r"\b(?:at least\s+|minimum(?:\s+of)?\s+|over\s+|more than\s+)?"
    r"(\d{1,2})(?:\s*\+|\s+or more)?\s+(?:years?|yrs?)\b",
    re.IGNORECASE,
)


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


class ApifyMcpLinkedInJobCollector:
    """Call the configured LinkedIn Jobs actor through Apify's MCP server."""

    _skill_terms = (
        "python", "typescript", "javascript", "react", "node.js", "java", "golang",
        "rust", "aws", "azure", "gcp", "docker", "kubernetes", "sql", "postgresql",
        "terraform", "machine learning", "llm",
    )

    def __init__(self) -> None:
        # Kept deliberately short and secret-free: this text is safe to show
        # in chat when a real MCP call fails.
        self.last_error: str | None = None

    @staticmethod
    def _text(value: Any) -> str:
        """Normalize scalar and structured fields returned by Apify actors."""
        if value is None:
            return ""
        if isinstance(value, dict):
            for key in ("text", "name", "title", "label", "value"):
                if key in value:
                    return ApifyMcpLinkedInJobCollector._text(value[key])
            return " ".join(
                part
                for child in value.values()
                if (part := ApifyMcpLinkedInJobCollector._text(child))
            )
        if isinstance(value, (list, tuple, set)):
            return " ".join(
                part
                for child in value
                if (part := ApifyMcpLinkedInJobCollector._text(child))
            )
        return re.sub(r"\s+", " ", str(value)).strip()

    async def collect(
        self,
        keywords: str,
        location: str,
        limit: int,
        skip_job_ids: Iterable[str] = (),
    ) -> list[dict]:
        self.last_error = None
        token = os.environ.get("APIFY_API_TOKEN")
        if not token:
            self.last_error = "APIFY_API_TOKEN is not configured"
            logger.warning("[job_hunter] %s", self.last_error)
            return []

        payload: dict[str, object] = {
            "title": keywords,
            "location": location,
            "datePosted": "r604800",
            "experienceLevel": ["2", "3", "4"],
            "limit": limit,
        }
        seen_ids = list(skip_job_ids)
        if seen_ids:
            payload["skipJobId"] = seen_ids

        try:
            async with httpx.AsyncClient(
                headers={"Authorization": f"Bearer {token}"},
                timeout=APIFY_MCP_TIMEOUT_SECONDS,
            ) as http:
                async with streamable_http_client(APIFY_MCP_URL, http_client=http) as (
                    read_stream,
                    write_stream,
                ):
                    async with ClientSession(read_stream, write_stream) as session:
                        await session.initialize()
                        tools = (await session.list_tools()).tools
                        actor_tool = self._find_actor_tool(tools)
                        result = await session.call_tool(actor_tool, arguments=payload)
                        items = self._job_items(result)

                        # Actor calls can include an output-schema example whose values
                        # are all literally "string". Prefer the run dataset whenever
                        # the MCP response provides its ID.
                        dataset_id = self._find_dataset_id(result)
                        if not dataset_id:
                            actor_id = APIFY_LINKEDIN_ACTOR.replace("/", "~")
                            run_response = await http.get(
                                f"https://api.apify.com/v2/acts/{actor_id}/runs/last",
                                params={"status": "SUCCEEDED"},
                            )
                            run_response.raise_for_status()
                            run_data = run_response.json().get("data", {})
                            dataset_id = run_data.get("defaultDatasetId")
                        if dataset_id:
                            response = await http.get(
                                f"https://api.apify.com/v2/datasets/{dataset_id}/items",
                                params={"limit": limit, "clean": "true"},
                            )
                            response.raise_for_status()
                            dataset_items = response.json()
                            if isinstance(dataset_items, list):
                                items = [item for item in dataset_items if isinstance(item, dict)]

                        items = [item for item in items if not self._is_placeholder_item(item)]
        except Exception as exc:
            detail = re.sub(r"apify_api_[A-Za-z0-9]+", "[redacted]", str(exc)).strip()
            detail = detail.replace(token, "[redacted]")
            # MCP errors may include an actor/billing status useful to the
            # user. Keep it bounded and redact credentials before chat.
            suffix = f": {detail[:240]}" if detail else f" ({type(exc).__name__})"
            self.last_error = f"Apify MCP request failed{suffix}"
            logger.exception("[job_hunter] Apify MCP collection failed")
            return []

        return [listing for item in items if (listing := self._to_listing(item))]

    @staticmethod
    def _normalise_tool_name(value: str) -> str:
        return re.sub(r"[^a-z0-9]", "", value.lower())

    def _find_actor_tool(self, tools: Iterable[Any]) -> str:
        names = [tool.name for tool in tools]
        if APIFY_MCP_TOOL_NAME:
            if APIFY_MCP_TOOL_NAME in names:
                return APIFY_MCP_TOOL_NAME
            raise RuntimeError(f"configured Apify MCP tool is unavailable: {APIFY_MCP_TOOL_NAME}")

        actor_name = self._normalise_tool_name(APIFY_LINKEDIN_ACTOR)
        for name in names:
            if actor_name in self._normalise_tool_name(name):
                return name
        raise RuntimeError(
            "the configured Apify LinkedIn Jobs actor tool is unavailable; "
            "set APIFY_MCP_TOOL_NAME to the tool name returned by Apify"
        )

    @classmethod
    def _job_items(cls, result: Any) -> list[dict]:
        def walk(value: Any) -> list[dict]:
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)] or [
                    item for child in value for item in walk(child)
                ]
            if isinstance(value, dict):
                if "id" in value and "title" in value:
                    return [value]
                direct = value.get("items") or value.get("results") or value.get("data")
                if isinstance(direct, list):
                    return [item for item in direct if isinstance(item, dict)]
                return [item for child in value.values() for item in walk(child)]
            return []

        structured = getattr(result, "structured_content", None) or getattr(
            result, "structuredContent", None
        )
        items = walk(structured)
        if items:
            return items

        for block in getattr(result, "content", []):
            if getattr(block, "type", None) != "text":
                continue
            try:
                items = walk(json.loads(block.text))
            except (TypeError, ValueError):
                continue
            if items:
                return items
        return []

    @classmethod
    def _find_dataset_id(cls, result: Any) -> str | None:
        def find(value: Any) -> str | None:
            if isinstance(value, dict):
                dataset_id = value.get("datasetId") or value.get("defaultDatasetId")
                if isinstance(dataset_id, str):
                    return dataset_id
                for child in value.values():
                    if found := find(child):
                        return found
            elif isinstance(value, list):
                for child in value:
                    if found := find(child):
                        return found
            return None

        structured = getattr(result, "structured_content", None) or getattr(
            result, "structuredContent", None
        )
        if dataset_id := find(structured):
            return dataset_id

        for block in getattr(result, "content", []):
            if getattr(block, "type", None) != "text":
                continue
            text = getattr(block, "text", "")
            try:
                if dataset_id := find(json.loads(text)):
                    return dataset_id
            except (TypeError, ValueError):
                match = re.search(
                    r'["\'](?:defaultDatasetId|datasetId)["\']\s*:\s*["\']([^"\']+)',
                    text,
                )
                if match:
                    return match.group(1)
        return None

    @staticmethod
    def _is_placeholder_item(item: dict) -> bool:
        identifying = ("id", "url", "title", "companyName", "location")
        values = [str(item.get(key, "")).strip().lower() for key in identifying]
        populated = [value for value in values if value]
        return bool(populated) and all(value == "string" for value in populated)

    def _to_listing(self, item: dict) -> dict | None:
        source_job_id = str(item.get("id") or "").strip()
        title = self._text(item.get("title"))
        if not source_job_id or not title:
            return None

        description = self._text(item.get("description")) or _strip_html(
            self._text(item.get("descriptionHtml"))
        )
        required_years = [int(match) for match in _EXPERIENCE_YEARS_RE.findall(description)]
        if required_years and min(required_years) > MAX_EXPERIENCE_YEARS:
            return None

        lower_description = description.lower()
        skills = [term for term in self._skill_terms if term in lower_description]
        return {
            "source": "linkedin",
            "source_job_id": source_job_id,
            "url": self._text(item.get("url")),
            "title": title,
            "company": self._text(item.get("companyName")) or None,
            "location": self._text(item.get("location")) or None,
            "salary": self._text(item.get("salary")) or None,
            "description": description or None,
            "skills": skills,
            "posted_date": self._text(item.get("postedDate") or item.get("postedTimeAgo")) or None,
        }


class JobHunterAgent(BaseAgent):
    role = "job_hunter"
    cycle_seconds = 180
    chat_channel = "jobs"
    memory_limit = 16
    _daily_quota_fact = "_job_hunter_daily_quota"
    fact_schema = [
        "candidate_name",
        "target_role",
        "target_location",
        "experience_level",
        "key_skills",
        "salary_expectation",
        "job_preferences",
    ]

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        # In-memory only — resets on restart. Good enough to avoid
        # announcing the same listing twice in a row; not meant as a
        # permanent dedupe ledger.
        self._seen_job_ids: set[str] = set()
        self._collector = ApifyMcpLinkedInJobCollector()
        self._quota_exhausted_today = False
        self._quota_notice_day: str | None = None
        self._last_collection_error: str | None = None

    def system_prompt(self) -> str:
        return (
            "You are Job Hunter, an AI agent that searches real job listings and "
            "evaluates them against a candidate's profile and learns from their feedback. "
            "Persist clearly stated role, location, skill, and relevance preferences so "
            "future searches improve. You hand promising leads to Portfolio Penguin for "
            "tracking. Reply concisely, 2-4 sentences unless listing details are needed."
        )

    async def _fetch_listings(self, keywords: str | None = None, count: int = 1) -> list[dict]:
        """Collect, persist, and deduplicate listings from the configured Apify MCP actor."""
        self._last_collection_error = None
        facts = await self.fetch_facts()
        today = date.today().isoformat()
        quota = self._read_daily_quota(facts.get(self._daily_quota_fact), today)
        remaining = max(0, JOB_HUNTER_DAILY_LIMIT - quota["used"])
        if not remaining:
            self._quota_exhausted_today = True
            return []
        self._quota_exhausted_today = False

        search_terms = self._search_terms(keywords or facts.get("target_role") or LINKEDIN_KEYWORDS)
        results: list[dict] = []
        for index, search_term in enumerate(search_terms):
            capacity = remaining - len(results)
            if capacity <= 0:
                break
            searches_left = len(search_terms) - index
            per_search_limit = max(1, capacity // searches_left)
            skip_ids = self._seen_job_ids | {
                job["source_job_id"] for job in results
            }
            collected = await self._collector.collect(
                search_term,
                facts.get("target_location") or LINKEDIN_LOCATION,
                per_search_limit,
                skip_ids,
            )
            results.extend(collected)
            if self._collector.last_error:
                self._last_collection_error = self._collector.last_error
                break

        query_limit = min(max(count, LINKEDIN_MAX_LISTINGS), remaining)
        # Never accept more results than the daily allowance, even if an Actor
        # unexpectedly returns more than its requested limit.
        results = results[:query_limit]
        quota["used"] += len(results)
        await self.upsert_facts({self._daily_quota_fact: json.dumps(quota)})

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
        for job in results:
            self._seen_job_ids.add(job["source_job_id"])
        if len(self._seen_job_ids) > 500:  # cap unbounded growth
            self._seen_job_ids = set(list(self._seen_job_ids)[-250:])
        return picked

    async def _daily_quota_status(self) -> tuple[int, int]:
        facts = await self.fetch_facts()
        quota = self._read_daily_quota(facts.get(self._daily_quota_fact), date.today().isoformat())
        return int(quota["used"]), JOB_HUNTER_DAILY_LIMIT

    @staticmethod
    def _requested_count(message: str) -> int:
        match = re.search(r"\b(\d{1,2})\s+(?:new\s+)?jobs?\b", message, flags=re.IGNORECASE)
        return min(int(match.group(1)), LINKEDIN_MAX_LISTINGS) if match else LINKEDIN_MAX_LISTINGS

    @staticmethod
    def _search_request(message: str) -> str:
        # Messages sent via /ask are already stripped by BaseAgent's #human
        # listener; messages typed in #jobs retain their @mention.
        return re.sub(r"^@job_hunter\b\s*", "", message, flags=re.IGNORECASE).strip()

    async def respond_to_message(self, message: str, reply_channel: str | None = None) -> str | None:
        """Run a real Apify search for a direct Job Hunter request.

        This intentionally does not call the general chat LLM: a model must
        never claim that it searched LinkedIn or speculate about Apify billing.
        """
        criteria = self._search_request(message)
        if not criteria:
            criteria = LINKEDIN_KEYWORDS

        await self.set_state("searching")
        try:
            used_before, limit = await self._daily_quota_status()
            if used_before >= limit:
                self._quota_exhausted_today = True
                reply = f"⏸ Daily LinkedIn listing quota reached ({used_before}/{limit}). I’ll resume tomorrow."
                await self.append_memory("user", message)
                await self.announce(reply, channel=reply_channel)
                return reply

            requested_count = self._requested_count(criteria)
            await self.announce(
                f"🔎 Searching LinkedIn through Apify now for “{criteria}” "
                f"(up to {requested_count} listings; daily quota: {used_before}/{limit}).",
                channel=reply_channel,
            )
            jobs = await self._fetch_listings(criteria, count=requested_count)
            used, limit = await self._daily_quota_status()
            if jobs:
                formatted = "\n\n".join(_format_listing(job) for job in jobs)
                reply = (
                    f"🔍 LinkedIn search completed through Apify — {len(jobs)} verified listing"
                    f"{'s' if len(jobs) != 1 else ''} (daily quota: {used}/{limit}).\n\n{formatted}"
                )
            elif self._quota_exhausted_today:
                reply = f"⏸ Daily LinkedIn listing quota reached ({used}/{limit}). I’ll resume tomorrow."
            elif self._last_collection_error:
                reply = (
                    f"⚠️ LinkedIn search could not complete: {self._last_collection_error}. "
                    f"No listings were returned or charged to today’s listing quota ({used}/{limit})."
                )
            else:
                reply = (
                    f"🔎 LinkedIn search completed through Apify, but returned no matching listings "
                    f"for “{criteria}” (daily quota: {used}/{limit})."
                )
            await self.append_memory("user", message)
            await self.announce(reply, channel=reply_channel)
            return reply
        finally:
            await self.set_state("idle")

    @staticmethod
    def _search_terms(value: str) -> list[str]:
        terms = [term.strip() for term in value.split(",") if term.strip()]
        return terms or [LINKEDIN_KEYWORDS]

    @staticmethod
    def _read_daily_quota(value: str | None, today: str) -> dict[str, int | str]:
        try:
            quota = json.loads(value or "{}")
            if quota.get("date") == today and isinstance(quota.get("used"), int):
                return {"date": today, "used": max(0, quota["used"])}
        except (TypeError, ValueError):
            pass
        return {"date": today, "used": 0}

    async def run_cycle(self) -> None:
        """Fetch a real job listing, evaluate it, dispatch leads."""
        await self.set_state("searching")
        jobs = await self._fetch_listings()
        if not jobs:
            today = date.today().isoformat()
            if self._quota_exhausted_today:
                if self._quota_notice_day != today:
                    await self.announce(
                        f"⏸ Daily job-search limit reached ({JOB_HUNTER_DAILY_LIMIT} listings). "
                        "I’ll resume scouting tomorrow."
                    )
                    self._quota_notice_day = today
                await self.set_state("idle")
                return
            await self.announce(
                "⚠️ Couldn't collect LinkedIn listings this cycle. Will retry next cycle."
            )
            await self.set_state("idle")
            return

        job = jobs[0]
        listing = _format_listing(job)
        await self.announce(f"🔍 Found a new listing:\n{listing}")

        await self.set_state("evaluating")
        facts = await self.fetch_facts()
        preferences = "\n".join(
            f"- {key}: {value}" for key, value in facts.items() if not key.startswith("_")
        )
        evaluation = await self.ask_llm(
            f"Evaluate this real job listing against the candidate preferences below:\n"
            f"{preferences or '- No preferences saved yet.'}\n\n{listing}\n\n"
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
                error = self._last_collection_error or "Apify returned no matching listings"
                await self.announce(f"⚠️ LinkedIn search for '{criteria}' did not return listings: {error}.")
                result = None
            await self.complete_task(task.task_id, {"result": result})
            await self.set_state("idle")
        else:
            content = task.payload.get("content", str(task.payload))
            await self.respond_to_message(content)
