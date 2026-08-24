"""Tech Scout — a budgeted MCP-powered daily technology research agent."""

import json
import logging
import os
from datetime import date
from typing import Any

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from app.autonomous.base import BaseAgent
from app.autonomous.bus import AgentMessage

logger = logging.getLogger("penguinhq.agents.tech_scout")

TAVILY_MCP_URL = os.environ.get("TAVILY_MCP_URL", "https://mcp.tavily.com/mcp/")
TAVILY_DAILY_CREDIT_LIMIT = max(
    1, int(os.environ.get("TECH_SCOUT_DAILY_TAVILY_CREDIT_LIMIT", "3"))
)


class TavilyMcpResearch:
    """Use only Tavily's basic search tool; never crawl, map, or research."""

    async def search_many(self, queries: list[str]) -> list[str]:
        token = os.environ.get("TAVILY_API_KEY")
        if not token:
            logger.warning("[tech_scout] TAVILY_API_KEY is not configured")
            return []

        try:
            async with httpx.AsyncClient(
                headers={"Authorization": f"Bearer {token}"}, timeout=60.0
            ) as http:
                async with streamable_http_client(TAVILY_MCP_URL, http_client=http) as (
                    read_stream,
                    write_stream,
                ):
                    async with ClientSession(read_stream, write_stream) as session:
                        await session.initialize()
                        tools = (await session.list_tools()).tools
                        tool = next(
                            (
                                candidate
                                for candidate in tools
                                if "tavily" in candidate.name.lower()
                                and "search" in candidate.name.lower()
                            ),
                            None,
                        )
                        if tool is None:
                            raise RuntimeError("Tavily MCP did not expose a search tool")

                        properties = getattr(tool, "inputSchema", {}).get("properties", {})
                        arguments: dict[str, Any] = {}
                        if "search_depth" in properties:
                            arguments["search_depth"] = "basic"
                        if "max_results" in properties:
                            arguments["max_results"] = 5
                        if "include_raw_content" in properties:
                            arguments["include_raw_content"] = False

                        results: list[str] = []
                        for query in queries:
                            result = await session.call_tool(
                                tool.name, arguments={**arguments, "query": query}
                            )
                            structured = getattr(result, "structuredContent", None)
                            if structured:
                                results.append(json.dumps(structured))
                            results.extend(
                                block.text
                                for block in getattr(result, "content", [])
                                if getattr(block, "type", None) == "text"
                                and getattr(block, "text", "")
                            )
                        return results
        except Exception:
            logger.exception("[tech_scout] Tavily MCP search failed")
            return []


class TechScoutAgent(BaseAgent):
    role = "tech_scout"
    cycle_seconds = 86_400
    chat_channel = "research"
    interaction_state = "researching"
    memory_limit = 16
    fact_schema = ["interests", "research_preferences"]
    _quota_fact = "_tech_scout_tavily_quota"

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._tavily = TavilyMcpResearch()

    def system_prompt(self) -> str:
        return (
            "You are Tech Scout, an AI that produces one daily technology briefing. "
            "Prioritize MLOps, AI infrastructure, SRE, and the user's saved research "
            "preferences. Learn from relevance feedback and make concise recommendations."
        )

    async def run_cycle(self) -> None:
        await self.set_state("researching")
        research = await self._research(
            [
                "latest vLLM SGLang TensorRT-LLM Triton inference releases benchmarks",
                "latest model context protocol agent infrastructure Kubernetes observability platform engineering",
                "recent AI infrastructure papers production MLOps Singapore",
            ]
        )
        if not research:
            await self.announce("⏸ Daily Tavily research budget is exhausted or unavailable.")
            await self.set_state("idle")
            return

        facts = await self.fetch_facts()
        preferences = "\n".join(
            f"- {key}: {value}" for key, value in facts.items() if not key.startswith("_")
        )
        brief = await self.ask_llm(
            "Write a concise daily technology briefing using only the supplied live "
            "research. Cover AI inference, agent/MCP infrastructure, Kubernetes/platform "
            "engineering, production-relevant papers, and one technology worth testing. "
            "Include source URLs when present.\n\n"
            f"User preferences:\n{preferences or '- MLOps, AI infrastructure, and SRE.'}\n\n"
            f"Research:\n{research}"
        )
        if brief:
            await self.announce(f"📋 **Daily tech brief**\n\n{brief}")
        await self.set_state("idle")

    async def _research(self, queries: list[str]) -> str:
        facts = await self.fetch_facts()
        today = date.today().isoformat()
        used = self._quota_used(facts.get(self._quota_fact), today)
        allowed = queries[: max(0, TAVILY_DAILY_CREDIT_LIMIT - used)]
        if not allowed:
            return ""

        # Reserve before making requests: restarts cannot exceed the daily cap.
        await self.upsert_facts(
            {self._quota_fact: json.dumps({"date": today, "used": used + len(allowed)})}
        )
        return "\n\n".join(await self._tavily.search_many(allowed))

    @staticmethod
    def _quota_used(value: str | None, today: str) -> int:
        try:
            quota = json.loads(value or "{}")
            if quota.get("date") == today and isinstance(quota.get("used"), int):
                return max(0, quota["used"])
        except (TypeError, ValueError):
            pass
        return 0

    async def handle_task(self, task: AgentMessage) -> None:
        if task.task_type == "research_topic":
            await self.set_state("researching")
            topic = task.payload.get("topic", str(task.payload))
            research = await self._research([topic])
            result = await self.ask_llm(
                f"Summarize this live research about {topic}. Include what it is, why it "
                f"matters, trade-offs, and a verdict.\n\n{research}"
            ) if research else ""
            if result:
                await self.announce(f"🔬 **Research: {topic}**\n\n{result}")
            await self.complete_task(task.task_id, {"result": result or None})
            await self.set_state("idle")
        else:
            await self.respond_to_message(task.payload.get("content", str(task.payload)))
