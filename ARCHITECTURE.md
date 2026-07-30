# PenguinHQ — Architecture

## Services (docker-compose)

```
postgres ── redis
   │
   ├── api (FastAPI, port 8000)
   │     - REST: /agents, /agents/{id}/state, /agents/{id}/memory, /hooks/event, /chat/send, /tasks
   │     - WebSocket: /ws/{client_id} — the one real-time fan-out point everything broadcasts through
   │     - in-memory ConnectionManager (ws connections)
   │     - Pigeon simulator REMOVED — pigeons are now real inter-agent task dispatch events
   │
   ├── agent-runner (Python, no exposed port)
   │     - ALL 4 autonomous agents in one process, each as an asyncio.Task
   │     - BaseAgent subclasses: JobHunterAgent, LeetcodeCoachAgent, TechScoutAgent, PortfolioPenguinAgent
   │     - AgentBus: in-process asyncio.Queue router for zero-latency inter-agent messaging
   │     - Shared httpx.AsyncClient + AsyncAnthropic + WebSocket listeners
   │     - Talks to `api` over HTTP/WS, same as any other client would
   │
   └── web (Next.js, port 3000)
         - DOM/CSS game renderer (Character.tsx, GameCanvas.tsx) — no canvas/PixiJS
         - useWebSocket.ts fans server events into gameStore/chatStore
         - Handles both pigeon.dispatched and pigeon.delivered events
```

## Data flow — how agents change state and communicate

```
1. A CLAUDE CODE SESSION (a human driving Claude Code in this repo)
   Claude Code tool call → hooks/agent-tracker.sh → POST /hooks/event
     → round-robins session to a NON-autonomous agent (hook round-robin excludes autonomous agents)
     → updates Agent.state in Postgres → broadcast agent.state_changed
     → frontend ring color changes

2. AUTONOMOUS AGENT LOOPS (agent-runner container)
   Each agent runs its own asyncio loop with configurable cycle interval:
     Job Hunter (180s): generate listing → evaluate fit → dispatch job_lead to Portfolio
     Leetcode Coach (120s): invent problem → solve → critique
     Tech Scout (240s): pick tech topic → research → summarize
     Portfolio Penguin (300s): review pipeline → summarize
   Each step: POST /agents/{id}/state + POST /agents/{id}/memory + POST /chat/send

3. INTER-AGENT TASK DISPATCH (real pigeons!)
   Job Hunter finds a lead → dispatch_task("portfolio", "job_lead", {...])
     → POST /tasks (creates DB row, broadcasts pigeon.dispatched over WS → pigeon flies!)
     → AgentBus delivers to Portfolio Penguin's inbox (instant, zero-latency)
     → Portfolio processes the lead → PATCH /tasks/{id} (broadcasts pigeon.delivered → pigeon arrives!)

4. HUMAN CHATTING (in any agent's channel)
   browser → chat.message (authorId: "human") → broadcast
     → agent's WS listener picks it up → multi-turn Claude call with memory context
     → reply → POST /chat/send + POST /memory
```

## Agent framework

```
app/autonomous/
├── __init__.py          # Package exports: BaseAgent, AgentBus, AgentMessage
├── __main__.py          # Entrypoint: python -m app.autonomous
├── base.py              # BaseAgent abstract class — lifecycle, LLM, memory, dispatch
├── bus.py               # AgentBus — in-process asyncio.Queue message router
├── runtime.py           # AgentRuntime — discovers, instantiates, runs all agents
├── agents/
│   ├── __init__.py
│   ├── job_hunter.py    # JobHunterAgent — searches jobs, dispatches leads
│   ├── leetcode_coach.py # LeetcodeCoachAgent — practice problems
│   ├── tech_scout.py    # TechScoutAgent — tech trend research
│   └── portfolio_penguin.py # PortfolioPenguinAgent — tracks applications
└── leetcode_coach.py    # DEPRECATED — original standalone agent, kept for reference
```

## Database

- **`agents`** — the 4 seeded rows (Job Hunter, Leetcode Coach, Tech Scout, Portfolio Penguin): id, name, role, state, room, position, avatar_color
- **`agent_memory`** — agent_id, role (user/assistant), content, created_at. All agents write to this.
- **`tasks`** — id, source_agent_id, destination_agent_id, destination_role, task_type, priority, status, payload (JSONB), result (JSONB), created_at, completed_at. This is the DB-backed pigeon ledger.

## Frontend

`GameCanvas.tsx` runs a `requestAnimationFrame` loop driving position/pose for the player + every agent in `gameStore.agents` (fetched via `useAgents`, kept live via `useWebSocket`). Ring color comes straight from `agent.state` — the same rendering path regardless of which mechanism changed that state.

New agent states and ring colors:
- `searching` — blue (#3b82f6) — Job Hunter looking for listings
- `evaluating` — amber (#f59e0b) — Job Hunter assessing fit
- `coordinating` — pink (#ec4899) — Portfolio Penguin processing a lead

Pigeon events:
- `pigeon.dispatched` — triggered by POST /tasks (a task is created, pigeon flies across screen)
- `pigeon.delivered` — triggered by PATCH /tasks/{id} with status=completed (pigeon arrives, removed from screen)

Sprites:
- Player: single static image (`penguin-blue.webp`), flipped horizontally to face left/right.
- The 4 named agents (Bluey/Kip/Luna/Ziggy): 4-directional image sets, swapped based on movement direction.
- Pigeons: Web Animations API for flight paths.

## Hooks collision fix

Hook-based round-robin (mechanism 1) now **excludes** agents whose role is in `AUTONOMOUS_ROLES` (job_hunter, leetcode_coach, tech_scout, portfolio). This prevents the state collision documented in the original ARCHITECTURE.md where hook-driven and autonomous state changes would flicker on the same agent row.
