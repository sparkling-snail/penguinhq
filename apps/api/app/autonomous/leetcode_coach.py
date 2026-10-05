"""
A genuinely autonomous agent — no human in the loop per turn.

Unlike app/api/routes/hooks.py (which infers an agent's state from
*another* AI's tool calls — a Claude Code session someone is actively
driving), this process is the thing actually doing the reasoning: it
invents its own coding problem, solves it, critiques its own solution,
and repeats, forever, calling Claude itself via the Anthropic API.

Scoped deliberately to Leetcode Coach only. It's the one seeded role that
can be genuinely autonomous with nothing but an LLM call — no job board
scraping, no portfolio/trading side effects, nothing that touches the
real world if it goes wrong.

Runs as its own process/container (see the `leetcode-coach` service in
docker-compose.yml) rather than inside the API process, since "a separate
program that loops observe -> decide -> act" is the actual definition of
an autonomous agent being reached for here. It talks to the API over
plain HTTP (POST /agents/{id}/state, POST /chat/send) since the
WebSocket connections it needs to broadcast through live in the API
process's memory, not this one.

It's not purely one-way, though: `listen_for_messages` connects to the
same WebSocket the browser uses and watches for a human `chat.message` on
its channel (authorId != its own), same as a person typing in the #logs
channel in the chat sidebar. `main`'s loop waits on whichever comes first
— a queued human message, or the usual cycle timer — so you can interrupt
the autonomous rhythm and it'll actually reply, in character, before
going back to inventing its own problems.

Memory: every chat exchange (both sides) and every autonomous-cycle step
gets persisted via POST/GET /agents/{id}/memory (app/api/routes/memory.py,
backed by the agent_memory table) — durable across restarts, unlike the
chat.message broadcast itself. `respond_to_message` fetches the last
MEMORY_FETCH_LIMIT entries and feeds them back as real conversation
history on every call, which is the actual fix for "no memory between
messages": before this, each reply was a fresh, context-free call.
"""

import asyncio
import json
import logging
import os
from urllib.parse import quote

import httpx
import websockets
from anthropic import AsyncAnthropic

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("penguinhq.autonomous.leetcode_coach")

API_BASE = os.environ.get("PENGUINHQ_API_BASE", "http://api:8000")
WS_BASE = os.environ.get("PENGUINHQ_WS_BASE", "ws://api:8000/ws")
MODEL = os.environ.get("LEETCODE_COACH_MODEL", "claude-haiku-4-5-20251001")
CYCLE_SECONDS = int(os.environ.get("LEETCODE_COACH_INTERVAL_SECONDS", "120"))
CHAT_CHANNEL = "leetcode"
MEMORY_FETCH_LIMIT = int(os.environ.get("LEETCODE_COACH_MEMORY_LIMIT", "16"))
API_TOKEN = os.environ.get("PENGUINHQ_API_TOKEN", "")

client = AsyncAnthropic()  # reads ANTHROPIC_API_KEY from the environment


def _strip_code_fence(text: str) -> str:
    """The model often wraps code in ```python fences on its own even
    when asked not to; post_chat adds its own fence for display, so an
    unstripped response doubles up. Strips one layer if present."""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.split("\n", 1)[1] if "\n" in stripped else ""
        if stripped.endswith("```"):
            stripped = stripped[: -3]
    return stripped.strip()


async def find_agent(http: httpx.AsyncClient) -> dict:
    response = await http.get(f"{API_BASE}/agents")
    response.raise_for_status()
    for agent in response.json():
        if agent["role"] == "leetcode_coach":
            return agent
    raise RuntimeError("no leetcode_coach agent seeded — run the API at least once first")


async def set_state(http: httpx.AsyncClient, agent_id: str, state: str) -> None:
    await http.post(f"{API_BASE}/agents/{agent_id}/state", json={"state": state})


async def post_chat(http: httpx.AsyncClient, agent: dict, content: str) -> None:
    await http.post(
        f"{API_BASE}/chat/send",
        json={
            "channel": "logs",
            "author_id": agent["id"],
            "author_name": agent["name"],
            "author_color": agent["avatarColor"],
            "content": content,
        },
    )


async def fetch_memory(http: httpx.AsyncClient, agent_id: str) -> list[dict]:
    response = await http.get(f"{API_BASE}/agents/{agent_id}/memory", params={"limit": MEMORY_FETCH_LIMIT})
    response.raise_for_status()
    return response.json()


async def append_memory(http: httpx.AsyncClient, agent_id: str, role: str, content: str) -> None:
    await http.post(f"{API_BASE}/agents/{agent_id}/memory", json={"role": role, "content": content})


async def ask_claude(prompt: str) -> str:
    """Single-shot call with no history — used for the internal steps of
    an autonomous cycle (problem -> solution -> critique), which already
    chain through local variables within one function call and don't need
    the DB-backed memory round trip."""
    response = await client.messages.create(
        model=MODEL,
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(block.text for block in response.content if block.type == "text").strip()


async def ask_claude_with_history(history: list[dict], new_message: str) -> str:
    """Real multi-turn call: prior memory entries (already {role, content}
    dicts, oldest-first) plus the new incoming message, so the reply can
    actually reference what was said before."""
    messages = [{"role": entry["role"], "content": entry["content"]} for entry in history]
    messages.append({"role": "user", "content": new_message})
    response = await client.messages.create(
        model=MODEL,
        max_tokens=600,
        system=(
            "You are Leetcode Coach, an AI that helps with coding-interview practice. "
            "Reply directly and helpfully, in character. 1-4 sentences unless code is "
            "genuinely needed to answer."
        ),
        messages=messages,
    )
    return "".join(block.text for block in response.content if block.type == "text").strip()


async def announce(http: httpx.AsyncClient, agent: dict, content: str) -> None:
    """Posts to the visible chat feed AND persists to durable memory, in
    lockstep — so an autonomous cycle's output is available as
    conversation context the next time someone chats with the agent."""
    await post_chat(http, agent, content)
    await append_memory(http, agent["id"], "assistant", content)


async def run_cycle(http: httpx.AsyncClient, agent: dict) -> None:
    agent_id = agent["id"]

    await set_state(http, agent_id, "planning")
    problem = await ask_claude(
        "Invent one original, short coding-interview practice problem — vary the topic "
        "and difficulty each time you're asked. Give just the problem statement in 2-4 "
        "sentences. No solution, no preamble, no markdown headers."
    )
    await announce(http, agent, f"📝 New practice problem:\n{problem}")

    await set_state(http, agent_id, "coding")
    solution = _strip_code_fence(
        await ask_claude(
            f"Solve this coding problem in Python. Reply with only the code, no explanation "
            f"before or after:\n\n{problem}"
        )
    )
    await announce(http, agent, f"💻 My solution:\n```python\n{solution}\n```")

    await set_state(http, agent_id, "researching")
    critique = await ask_claude(
        f"Problem:\n{problem}\n\nMy solution:\n{solution}\n\n"
        "Critique this solution in 2-3 sentences: is it correct, what's the time "
        "complexity, and is there any edge case it misses? Be honest and specific — "
        "this is a self-review, not a pep talk."
    )
    await announce(http, agent, f"🔍 Self-review: {critique}")

    await set_state(http, agent_id, "idle")


async def respond_to_message(http: httpx.AsyncClient, agent: dict, message: str) -> None:
    agent_id = agent["id"]
    await set_state(http, agent_id, "meeting")  # closest existing state to "in conversation"

    history = await fetch_memory(http, agent_id)
    reply = await ask_claude_with_history(history, message)

    # Persist both sides — the incoming message wasn't written by
    # anything else (unlike chat.message, memory isn't a broadcast), and
    # order matters: the human's turn must land before the reply so the
    # next fetch_memory sees correct chronological order.
    await append_memory(http, agent_id, "user", message)
    await announce(http, agent, reply)

    await set_state(http, agent_id, "idle")


async def listen_for_messages(agent: dict, queue: "asyncio.Queue[str]") -> None:
    """Connects to the same WebSocket the browser's chat sidebar uses and
    forwards any human message in our channel into `queue`. Runs
    alongside the main loop, reconnecting on drop — this is what makes
    the agent interruptible instead of a pure one-way broadcast."""
    uri = f"{WS_BASE}/leetcode-coach-agent"
    if API_TOKEN:
        uri = f"{uri}?access_token={quote(API_TOKEN, safe='')}"
    while True:
        try:
            async with websockets.connect(uri) as ws:
                logger.info("listening for chat messages on %s", uri)
                async for raw in ws:
                    event = json.loads(raw)
                    if event.get("type") != "chat.message":
                        continue
                    payload = event["payload"]
                    if payload.get("channel") != CHAT_CHANNEL:
                        continue
                    if payload.get("authorId") == agent["id"]:
                        continue  # ignore our own broadcasts echoed back
                    await queue.put(payload["content"])
        except Exception:
            logger.exception("chat listener dropped, reconnecting in 5s")
            await asyncio.sleep(5)


async def main() -> None:
    headers = {"Authorization": f"Bearer {API_TOKEN}"} if API_TOKEN else {}
    async with httpx.AsyncClient(timeout=30.0, headers=headers) as http:
        agent = await find_agent(http)
        logger.info("autonomous loop starting for agent %s (%s)", agent["name"], agent["id"])

        queue: "asyncio.Queue[str]" = asyncio.Queue()
        asyncio.create_task(listen_for_messages(agent, queue))

        while True:
            try:
                message = await asyncio.wait_for(queue.get(), timeout=CYCLE_SECONDS)
            except asyncio.TimeoutError:
                message = None

            try:
                if message is not None:
                    await respond_to_message(http, agent, message)
                else:
                    await run_cycle(http, agent)
            except Exception:
                logger.exception("cycle failed, retrying after the usual interval")


if __name__ == "__main__":
    asyncio.run(main())
