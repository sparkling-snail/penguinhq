# PenguinHQ — Architecture

## Services (docker-compose)

```
postgres ── redis
   │
   ├── api (FastAPI, port 8000)
   │     - REST: /agents, /agents/{id}/state, /agents/{id}/memory, /hooks/event, /chat/send
   │     - WebSocket: /ws/{client_id} — the one real-time fan-out point everything broadcasts through
   │     - in-memory ConnectionManager (ws connections) + pigeon_simulator (still fake/timer-based)
   │
   ├── leetcode-coach (Python, no exposed port)
   │     - the one genuinely autonomous agent — own process, own loop, calls Anthropic directly
   │     - talks to `api` only over HTTP/WS, same as any other client would
   │
   └── web (Next.js, port 3000)
         - DOM/CSS game renderer (Character.tsx, GameCanvas.tsx) — no canvas/PixiJS
         - useWebSocket.ts fans server events into gameStore/chatStore
```

## Data flow — three separate ways an agent's state/chat changes

```
1. A CLAUDE CODE SESSION (a human driving Claude Code in this repo)
   Claude Code tool call → hooks/agent-tracker.sh → POST /hooks/event
     → round-robins this session to one of the 4 seeded agents
     → updates Agent.state in Postgres → broadcast agent.state_changed
     → frontend ring color changes

2. THE AUTONOMOUS LOOP (leetcode-coach container)
   every 120s (or on human interrupt):
     invent problem → POST /agents/{id}/state ┐
     solve it        → POST /agents/{id}/state ├─ each also POST /agents/{id}/memory
     critique it      → POST /agents/{id}/state ┘   (durable, Postgres — survives restarts)
     each step also → POST /chat/send → broadcast chat.message
     Anthropic API called directly (api.anthropic.com), no human per-turn

3. A HUMAN CHATTING BACK (in the #logs channel)
   browser → chat.message (authorId: "human") → broadcast
     → leetcode-coach's own WS listener picks it up
     → GET /agents/{id}/memory (last 16 entries) → real multi-turn Claude call
     → reply → POST /chat/send + POST /memory
```

## Database

- **`agents`** — the 4 seeded rows (Job Hunter, Leetcode Coach, Tech Scout, Portfolio Penguin): id, name, role, state, room, position, avatar_color
- **`agent_memory`** — agent_id, role (user/assistant), content, created_at. Only Leetcode Coach writes to this today.

## Frontend

`GameCanvas.tsx` runs a `requestAnimationFrame` loop driving position/pose for the player + every agent in `gameStore.agents` (fetched via `useAgents`, kept live via `useWebSocket`). Ring color comes straight from `agent.state` — the same rendering path regardless of which of the three mechanisms above changed that state.

Sprites:
- Player: single static image (`penguin-blue.webp`), flipped horizontally to face left/right.
- The 4 named agents (Bluey/Kip/Luna/Ziggy): 4-directional image sets (`front-left`/`front-right`/`rear-left`/`rear-right`), swapped based on movement direction rather than flipped.
- Pigeons: Web Animations API for flight paths, not a per-frame game-loop update — a fixed path from spawn is a better fit for `element.animate()` than hand-rolled position updates.

## Known rough edge

**Mechanisms 1 and 2 can collide on the same agent.** Hook-based round-robin (mechanism 1) assigns Claude Code sessions to agents by rotation, with no awareness that Leetcode Coach already has its own autonomous loop running. If a new Claude Code session round-robins onto Leetcode Coach's row, tool-call-driven state changes and the autonomous cycle's own state changes both write to the same row — expect incoherent flicker between "debugging" (from Claude Code activity) and "coding" (from its own practice cycle). Not yet fixed: the straightforward fix is excluding Leetcode Coach from the hooks round-robin pool.

## What's genuinely autonomous vs. reactive

Only **Leetcode Coach** runs unprompted, on its own timer, making its own decisions about what to do next. The other three agents (Job Hunter, Tech Scout, Portfolio Penguin) are purely reactive — their state only changes when hook events from a human-driven Claude Code session happen to round-robin onto them. None of the 4 are "AI agents" that pursue their named role (Job Hunter doesn't hunt jobs); they're character labels a real process gets assigned to for visualization purposes.
