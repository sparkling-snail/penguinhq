"""
Base class for every autonomous agent in PenguinHQ.

Each agent runs as an independent asyncio.Task inside the agent-runner
container. The runner provides shared infrastructure (HTTP client,
Anthropic client, AgentBus) and each agent implements its own
run_cycle() for autonomous behavior and handle_task() for inter-agent
task dispatch.

The lifecycle is:
  1. AgentRuntime fetches the agent's DB record
  2. Instantiates the right BaseAgent subclass
  3. Calls agent.run() which starts the main loop
  4. The main loop prioritizes: human chat > inter-agent task > autonomous cycle
"""

import asyncio
import json
import logging
import os
import uuid
from abc import ABC, abstractmethod
from typing import Any

import httpx
import websockets
from anthropic import AsyncAnthropic

from app.autonomous.bus import AgentBus, AgentMessage

logger = logging.getLogger("penguinhq.agents")


def _strip_code_fence(text: str) -> str:
    """Strip one layer of ```python fences if the model added them."""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.split("\n", 1)[1] if "\n" in stripped else ""
        if stripped.endswith("```"):
            stripped = stripped[:-3]
    return stripped.strip()


class BaseAgent(ABC):
    """
    Lifecycle for an autonomous agent.

    Subclasses must implement:
      - run_cycle(): the agent's autonomous behavior
      - system_prompt(): the LLM system prompt
      - handle_task(): how to process inter-agent task dispatch

    Inherited infrastructure (shared across all agents):
      - set_state(): update agent state in DB + broadcast over WS
      - announce(): post to chat AND persist to memory
      - ask_llm(): single-shot or multi-turn LLM call
      - dispatch_task(): send a task to another agent (creates a pigeon!)
      - fetch_memory() / append_memory(): durable conversation history
    """

    # --- Subclass overrides ---
    role: str = ""
    cycle_seconds: int = 120
    chat_channel: str = "logs"
    interaction_state: str = "meeting"
    memory_limit: int = 16
    model: str = "claude-haiku-4-5-20251001"

    # Fixed set of durable-fact keys this agent cares about (e.g.
    # "target_role", "target_location" for Job Hunter). Empty means this
    # agent doesn't do fact extraction at all. Deliberately a closed,
    # per-agent schema rather than freeform key extraction — freeform
    # extraction can name the same fact "job_search_focus" one time and
    # "current_goal" the next, which makes facts impossible to reliably
    # overwrite later. A fixed schema is also the only version of this
    # that's actually testable against real conversations before trusting it.
    fact_schema: list[str] = []

    @abstractmethod
    async def run_cycle(self) -> None:
        """One autonomous tick — the agent's core behavior."""

    @abstractmethod
    async def handle_task(self, task: AgentMessage) -> None:
        """Handle an inter-agent task dispatched to this agent."""

    @abstractmethod
    def system_prompt(self) -> str:
        """System prompt for this agent's LLM calls."""

    # --- Constructor ---

    def __init__(
        self,
        agent_record: dict,
        http: httpx.AsyncClient,
        anthropic: AsyncAnthropic,
        bus: AgentBus,
    ):
        self.id = agent_record["id"]
        self.name = agent_record["name"]
        self.avatar_color = agent_record["avatarColor"]
        self.agent_record = agent_record

        self._http = http
        self._anthropic = anthropic
        self._bus = bus
        self._inbox: asyncio.Queue[AgentMessage] | None = None
        # Preserve the originating channel so direct messages receive their
        # answer (or a useful failure status) where the human asked them.
        self._message_queue: asyncio.Queue[tuple[str, str]] = asyncio.Queue()
        self._last_llm_error: str | None = None

    # --- Shared infrastructure (inherited by all agents) ---

    @staticmethod
    def _api_base() -> str:
        return os.environ.get("PENGUINHQ_API_BASE", "http://api:8000")

    @staticmethod
    def _ws_base() -> str:
        return os.environ.get("PENGUINHQ_WS_BASE", "ws://api:8000/ws")

    async def set_state(self, state: str) -> None:
        """Update agent state in DB and broadcast over WebSocket."""
        try:
            await self._http.post(
                f"{self._api_base()}/agents/{self.id}/state",
                json={"state": state},
            )
        except Exception:
            logger.exception("[%s] failed to set state to %s", self.role, state)

    async def post_chat(self, content: str, channel: str | None = None) -> None:
        """Post a message to a chat channel (broadcast to all WS clients)."""
        ch = channel or self.chat_channel
        try:
            await self._http.post(
                f"{self._api_base()}/chat/send",
                json={
                    "channel": ch,
                    "author_id": self.id,
                    "author_name": self.name,
                    "author_color": self.avatar_color,
                    "content": content,
                },
            )
        except Exception:
            logger.exception("[%s] failed to post chat", self.role)

    async def fetch_memory(self, limit: int | None = None) -> list[dict]:
        """Fetch the last N memory entries (oldest-first) for context."""
        try:
            resp = await self._http.get(
                f"{self._api_base()}/agents/{self.id}/memory",
                params={"limit": limit or self.memory_limit},
            )
            resp.raise_for_status()
            return resp.json()
        except Exception:
            logger.exception("[%s] failed to fetch memory", self.role)
            return []

    async def append_memory(self, role: str, content: str) -> None:
        """Persist a memory entry (durable across restarts)."""
        try:
            await self._http.post(
                f"{self._api_base()}/agents/{self.id}/memory",
                json={"role": role, "content": content},
            )
        except Exception:
            logger.exception("[%s] failed to append memory", self.role)

    async def announce(self, content: str, channel: str | None = None) -> None:
        """Post to chat AND persist to memory — the core 'agent says something' operation."""
        await self.post_chat(content, channel)
        await self.append_memory("assistant", content)

    async def fetch_facts(self) -> dict[str, str]:
        """Fetch this agent's durable fact profile (empty if none set)."""
        try:
            resp = await self._http.get(f"{self._api_base()}/agents/{self.id}/facts")
            resp.raise_for_status()
            return resp.json()
        except Exception:
            logger.exception("[%s] failed to fetch facts", self.role)
            return {}

    async def upsert_facts(self, facts: dict[str, str]) -> None:
        """Persist facts (upsert by key) — durable, unaffected by memory's fetch window."""
        try:
            await self._http.post(
                f"{self._api_base()}/agents/{self.id}/facts", json={"facts": facts}
            )
        except Exception:
            logger.exception("[%s] failed to upsert facts", self.role)

    async def _extract_facts(self, user_message: str, reply: str) -> None:
        """After a chat exchange, pull out any of this agent's known
        fact_schema keys the user stated or clearly implied, and persist
        them. No-ops for agents with an empty fact_schema. Deliberately
        instructed to omit (not guess) unmentioned fields — a fact store
        that hallucinates is worse than no fact store."""
        if not self.fact_schema:
            return

        schema_list = ", ".join(self.fact_schema)
        extraction = await self.ask_llm(
            f"User said: {user_message}\nAssistant replied: {reply}",
            system=(
                f"Extract ONLY these fields if the user clearly stated or strongly "
                f"implied them: {schema_list}. Output one line per field found, "
                f'formatted exactly as "key: value". Omit any field not mentioned '
                f"entirely — do not write it as NONE, do not guess. If nothing "
                f"qualifies, output nothing at all."
            ),
            max_tokens=200,
        )

        facts: dict[str, str] = {}
        for line in extraction.splitlines():
            if ":" not in line:
                continue
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip()
            if key in self.fact_schema and value and value.upper() != "NONE":
                facts[key] = value

        if facts:
            logger.info("[%s] extracted facts: %s", self.role, facts)
            await self.upsert_facts(facts)

    async def ask_llm(
        self,
        prompt: str,
        *,
        history: list[dict] | None = None,
        max_tokens: int = 600,
        facts: dict[str, str] | None = None,
        system: str | None = None,
        web_search: bool = False,
    ) -> str:
        """Single-shot or multi-turn LLM call. Uses this agent's own
        system_prompt() unless `system` overrides it (used by fact
        extraction, which needs a completely different instruction).
        `facts` — if given — is appended to the system prompt so known
        durable facts inform every reply, not just ones still inside the
        memory window.

        `web_search` — if True, grants Claude Anthropic's hosted web_search
        tool for this call. It's a server-side tool: Anthropic runs the
        search and folds results back into the same response, so no
        client-side tool loop is needed here — the final text block already
        reflects what it found."""
        self._last_llm_error = None
        sys_prompt = system if system is not None else self.system_prompt()
        if facts:
            facts_block = "\n".join(f"- {k}: {v}" for k, v in facts.items())
            sys_prompt = f"{sys_prompt}\n\nKnown facts about this user (use naturally, don't just recite them back):\n{facts_block}"

        messages: list[dict] = []
        if history:
            messages.extend(
                {"role": entry["role"], "content": entry["content"]}
                for entry in history
            )
        messages.append({"role": "user", "content": prompt})

        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "system": sys_prompt,
            "messages": messages,
        }
        if web_search:
            kwargs["tools"] = [
                {"type": "web_search_20250305", "name": "web_search", "max_uses": 1}
            ]

        try:
            response = await self._anthropic.messages.create(**kwargs)
            return "".join(
                block.text for block in response.content if block.type == "text"
            ).strip()
        except Exception as error:
            logger.exception("[%s] LLM call failed", self.role)
            self._last_llm_error = self._public_llm_error(error)
            return ""

    @staticmethod
    def _public_llm_error(error: Exception) -> str:
        """Return a safe, actionable error for chat without leaking secrets."""
        status = getattr(error, "status_code", None)
        code = f"ANTHROPIC_{status}" if isinstance(status, int) else "ANTHROPIC_UNAVAILABLE"
        message = str(error).lower()

        if status == 400 and "credit balance" in message:
            detail = "Anthropic API credit balance is too low. Add API credits, then try again."
        elif status in (401, 403):
            detail = "Anthropic API authentication was rejected. Check the configured API key."
        elif status == 429:
            detail = "Anthropic rate limit reached. Please try again shortly."
        else:
            detail = "The language model request failed. Please try again shortly."
        return f"⚠️ **{code}** — {detail}"

    async def dispatch_task(
        self,
        destination_role: str,
        task_type: str,
        payload: dict[str, Any],
        priority: str = "normal",
    ) -> str:
        """
        Send a task to another agent. This is how pigeons become real!

        1. Creates a task record via the API (persists to DB)
        2. The API broadcasts pigeon.dispatched over WebSocket (pigeon flies!)
        3. Puts the message in the target agent's bus inbox (instant delivery)
        """
        task_id = uuid.uuid4().hex[:8]

        # Create the task via the API (triggers pigeon.dispatched broadcast)
        try:
            await self._http.post(
                f"{self._api_base()}/tasks",
                json={
                    "source_agent_id": self.id,
                    "destination_role": destination_role,
                    "task_type": task_type,
                    "priority": priority,
                    "payload": payload,
                },
            )
        except Exception:
            logger.exception("[%s] failed to create task via API", self.role)

        # Also deliver directly via the bus (zero-latency)
        msg = AgentMessage(
            source_agent_id=self.id,
            source_role=self.role,
            task_type=task_type,
            payload=payload,
            task_id=task_id,
            priority=priority,
        )
        self._bus.send_by_role(destination_role, msg)

        logger.info(
            "[%s] dispatched task %s to %s (type=%s)",
            self.role, task_id, destination_role, task_type,
        )
        return task_id

    async def complete_task(self, task_id: str, result: dict[str, Any] | None = None) -> None:
        """Mark a task as completed (triggers pigeon.delivered broadcast)."""
        try:
            await self._http.patch(
                f"{self._api_base()}/tasks/{task_id}",
                json={"status": "completed", "result": result},
            )
        except Exception:
            logger.exception("[%s] failed to complete task %s", self.role, task_id)

    # --- Default human message handler ---

    async def respond_to_message(self, message: str, reply_channel: str | None = None) -> str | None:
        """Handle a human chat message (interrupt). Default: multi-turn with
        memory + durable facts. Fact extraction runs *after* the reply is
        sent, not before — it's a second LLM call, and the human shouldn't
        wait longer for a reply just so facts can be updated in the
        background."""
        await self.set_state(self.interaction_state)
        history = await self.fetch_memory()
        facts = await self.fetch_facts() if self.fact_schema else {}
        reply = await self.ask_llm(message, history=history, facts=facts)
        if reply:
            await self.append_memory("user", message)
            await self.announce(reply, channel=reply_channel)
        elif self._last_llm_error:
            await self.announce(self._last_llm_error, channel=reply_channel)
        await self.set_state("idle")

        if reply:
            await self._extract_facts(message, reply)
        return reply

    # --- Background listeners ---

    async def _listen_for_chat(self) -> None:
        """WebSocket listener for human chat messages targeting this agent.

        IMPORTANT: Only responds to messages from humans (not from other agents).
        Without this filter, agents would respond to each other's chat broadcasts
        in an infinite loop, never reaching their autonomous cycles.
        """
        uri = f"{self._ws_base()}/{self.role}-agent"
        while True:
            try:
                async with websockets.connect(uri) as ws:
                    logger.info("[%s] chat listener connected to %s", self.role, uri)
                    async for raw in ws:
                        event = json.loads(raw)
                        if event.get("type") != "chat.message":
                            continue
                        payload = event["payload"]
                        # Skip own messages (echoed back by the broadcast)
                        if payload.get("authorId") == self.id:
                            continue
                        # Skip messages from other agents — only respond to humans.
                        # Agent messages have an authorColor (set by POST /chat/send),
                        # and humans typing in the chat sidebar don't have an authorId
                        # matching any known agent. The simplest check: if the authorId
                        # matches ANY agent in the bus registry, skip it.
                        if payload.get("authorId") in self._bus.registered_agents:
                            continue
                        # Only respond to messages on this agent's own channel
                        # or the "human" direct channel. Ignore other channels.
                        msg_channel = payload.get("channel")
                        if msg_channel not in (self.chat_channel, "human"):
                            continue
                        content = payload.get("content", "")

                        # A message in #human can explicitly address one
                        # agent, e.g. "@tech_scout Find recent AI releases".
                        # Untagged messages preserve the existing broadcast
                        # behavior, while tagged messages wake only the named
                        # agent instead of making the whole office reply.
                        if msg_channel == "human" and content.startswith("@"):
                            target, separator, content = content.partition(" ")
                            if not separator or target[1:].lower() != self.role.lower():
                                continue
                            content = content.strip()
                            if not content:
                                continue

                        await self._message_queue.put((content, msg_channel))
            except Exception:
                logger.exception("[%s] chat listener dropped, reconnecting in 5s", self.role)
                await asyncio.sleep(5)

    # --- Main loop ---

    async def run(self) -> None:
        """
        Main loop — the agent's autonomous heartbeat.

        Priority: human chat > inter-agent task > autonomous cycle.
        Waits up to cycle_seconds for a human message or task;
        if nothing arrives, runs an autonomous cycle.
        """
        logger.info("[%s] agent loop starting (id=%s, cycle=%ds)", self.role, self.id, self.cycle_seconds)

        # Register inbox on the bus
        self._inbox = self._bus.register(self.id, self.role)

        # Start background chat listener
        asyncio.create_task(self._listen_for_chat())

        while True:
            try:
                # Wait for either a human message or a bus message, with timeout
                # If nothing arrives, run an autonomous cycle
                message: tuple[str, str] | None = None
                task = None

                try:
                    message = await asyncio.wait_for(
                        self._message_queue.get(), timeout=2.0
                    )
                except asyncio.TimeoutError:
                    pass

                if message is not None:
                    content, reply_channel = message
                    await self.respond_to_message(content, reply_channel=reply_channel)
                    continue

                # Check bus inbox
                if self._inbox and not self._inbox.empty():
                    task = self._inbox.get_nowait()

                if task is not None:
                    await self.handle_task(task)
                    continue

                # No message or task — wait for the cycle interval
                # Check queues periodically so we don't block too long
                waited = 0.0
                while waited < self.cycle_seconds:
                    await asyncio.sleep(5.0)
                    waited += 5.0
                    # Re-check queues
                    if not self._message_queue.empty():
                        break
                    if self._inbox and not self._inbox.empty():
                        break

                # If still no message/task arrived, run autonomous cycle
                if self._message_queue.empty() and (not self._inbox or self._inbox.empty()):
                    await self.run_cycle()

            except Exception:
                logger.exception("[%s] cycle failed, will retry", self.role)
                await asyncio.sleep(10)
