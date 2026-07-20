# PenguinHQ — Milestone 1: Project Foundation

An interactive AI operating system where AI agents live in a virtual office. This milestone
stands up the monorepo skeleton, the real-time plumbing, and one controllable penguin — no
agent intelligence yet, just a solid foundation everything else builds on.

## What's in this milestone

- Monorepo: `apps/web` (Next.js), `apps/api` (FastAPI), `packages/shared-types` (TS contract docs)
- PixiJS scene with one controllable penguin (WASD/arrows), one wandering NPC penguin, procedurally
  drawn (no art assets required yet)
- A WebSocket connection between frontend and backend, with a background task that fabricates
  `pigeon.dispatched` events so the Kafka-pigeon flight animation has real traffic to render
- A Slack-style chat sidebar (8 channels from the spec) seeded with example messages, wired to send
  real `chat.message` events over the WebSocket
- Postgres (via SQLAlchemy async + asyncpg) with one `agents` table, seeded with the six named agents
- Redis connection (used for Celery + pub/sub broadcast in later milestones — just proven reachable here)
- Docker Compose stack with hot reload on both services

## Architecture

```
penguinhq/
├── docker-compose.yml          # the whole local stack in one file
├── apps/
│   ├── web/                    # Next.js + TypeScript + Tailwind + PixiJS
│   │   └── src/
│   │       ├── app/            # Next.js App Router (page.tsx is the shell)
│   │       ├── components/
│   │       │   ├── game/       # PixiJS layer — framework-agnostic, React-adapted at the edges
│   │       │   │   ├── entities/   # Penguin, PlayerController, NPCPenguin, Pigeon
│   │       │   │   └── world/      # room/floor rendering
│   │       │   └── chat/       # Slack-style sidebar (ChannelList, MessageList, Composer)
│   │       ├── stores/         # Zustand: gameStore (world state), chatStore (channels/messages)
│   │       ├── lib/            # websocket.ts (reconnecting client), api.ts (REST client)
│   │       ├── hooks/          # useWebSocket, useAgents (React Query)
│   │       └── types/          # hand-mirrored copy of the shared wire contract
│   └── api/                    # FastAPI + SQLAlchemy (async) + Redis
│       └── app/
│           ├── core/           # config, database, redis — infra, no business logic
│           ├── domain/         # ORM models + Pydantic schemas (kept separate on purpose)
│           ├── api/routes/     # health, agents, websocket
│           └── ws/             # connection manager + the pigeon event simulator
└── packages/shared-types/      # canonical TS contract (Agent, WSEvent, PigeonPayload, ...)
```

### Key decisions

**Why PixiJS entities know nothing about React.** `PixiApp`, `Penguin`, `PlayerController`,
`NPCPenguin`, and `Pigeon` are plain TypeScript classes with an `update(delta)` method called by
Pixi's own ticker. `GameCanvas.tsx` is the only file that bridges React and Pixi — it creates one
`PixiApp` on mount, destroys it on unmount, and pushes Zustand store changes into Pixi imperatively
(`pixiApp.spawnPigeon(...)`) rather than letting React re-render the scene graph. Mixing React's
declarative re-renders with a 60fps imperative renderer is a classic source of bugs; containing the
seam to one component avoids that everywhere else.

**Why agents are drawn with `PIXI.Graphics` instead of sprite sheets.** There's no art pipeline yet.
Procedural pixel-art keeps the whole app runnable with zero external assets today. When real
spritesheets arrive, only `Penguin.redraw()` changes — every subclass and every consumer of
`Penguin` is unaffected because they only depend on its public API (`setState`, `update`).

**Why the WebSocket contract is hand-mirrored between Python and TypeScript
(`app/domain/schemas/events.py` ↔ `apps/web/src/types/events.ts`) instead of a real shared package.**
Each Docker build context is scoped to its own app folder so containers build fast and independently.
`packages/shared-types` documents the canonical contract; the frontend keeps a hand-kept mirror. Once
we move to a Turborepo-driven build (repo-root build context), this becomes a real workspace import
and the duplication goes away.

**Why `AgentOut` serializes as camelCase.** FastAPI/Pydantic naturally speaks snake_case; TypeScript
naturally speaks camelCase. Rather than translating in a frontend adapter layer, `AgentOut` uses
Pydantic's `alias_generator=to_camel` so the JSON on the wire already matches the frontend's `Agent`
type field-for-field.

**Why pigeon events are simulated (`app/ws/pigeon_simulator.py`).** There's no real task queue yet.
The simulator fabricates a plausible `pigeon.dispatched` event every few seconds so the flight
animation has real WebSocket traffic to render against, not a hardcoded frontend mock. When the real
event-driven task pipeline ships, this file is deleted and `connection_manager.broadcast(...)` is
called from the actual dispatch code path — the `WSEvent` contract doesn't change.

## Running it

**Docker (recommended — matches how it'll run in every environment):**

```bash
cd penguinhq
cp .env.example .env
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend: http://localhost:8000 (docs at http://localhost:8000/docs)
- Postgres: localhost:5432, Redis: localhost:6379

Both `api` and `web` bind-mount their source directories, so edits on your machine hot-reload inside
the containers (uvicorn `--reload`, Next.js dev server).

**Without Docker (running services natively):**

```bash
# Terminal 1 — Postgres + Redis only, still via Docker
docker compose up postgres redis

# Terminal 2 — backend
cd apps/api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../../.env.example ../../.env   # or export DATABASE_URL / REDIS_URL directly
uvicorn app.main:app --reload --port 8000

# Terminal 3 — frontend
cd apps/web
npm install
npm run dev
```

## Testing it

1. Open http://localhost:3000 — you should see a dark, glassmorphism-paneled office scene on the
   left and the chat sidebar on the right.
2. Move the blue penguin ("You") with WASD or arrow keys; the orange "Job Hunter" NPC wanders on its
   own.
3. Every ~6 seconds a pigeon flies across the scene carrying a colored envelope — hover it to see the
   task ID, source/destination agent, priority, latency, retries, queue, and payload size.
4. In the chat sidebar, switch to `#jobs` to see the seeded conversation between Job Hunter,
   Portfolio Penguin, and Leetcode Coach. Type a message and hit Enter/Send — it round-trips through
   the backend's WebSocket endpoint and reappears (open two browser tabs to see it broadcast).
5. `curl http://localhost:8000/agents` returns the six seeded agents as JSON.
6. `curl http://localhost:8000/health/ready` confirms Postgres and Redis are both reachable.

**Static checks** (already run during development, safe to re-run):

```bash
cd apps/api && python -m py_compile $(find app -name "*.py")   # backend syntax
cd apps/web && npx tsc --noEmit                                  # frontend types
cd apps/web && npx next lint                                     # frontend lint
```

## What's deliberately NOT in this milestone

- No agent intelligence, LLM calls, or real task execution
- No multi-room navigation (everything renders in one "Mission Control" room for now)
- No auth (Clerk), no Celery workers, no Kubernetes/AWS deployment config
- No message/agent persistence beyond the seeded rows — chat history and pigeon flights are
  in-memory and reset on refresh/restart

These are exactly the seams this milestone was built to make easy to fill in next — say the word
for Milestone 2.
