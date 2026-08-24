# PenguinHQ

PenguinHQ is an interactive AI workspace where autonomous agents appear as penguins in a virtual office. The agents run continuously, talk with the user, retain memory and structured facts, collaborate through tasks, and expose their activity to the frontend in real time.

The project is under active development. It is designed for local use and does not yet include authentication or production deployment hardening.

## What it does

- Displays autonomous agents in a Club Penguin-inspired office UI.
- Streams agent state, chat, and task events to the browser over WebSockets.
- Runs four specialized agents concurrently in a separate Python process.
- Stores agents, memories, facts, job listings, practice sessions, and inter-agent tasks in PostgreSQL.
- Collects LinkedIn listings through an Apify MCP server.
- Performs budgeted technology searches through a Tavily MCP server.
- Visualizes inter-agent task dispatch and completion as messenger-pigeon flights.

## Agents

| Agent | Role | Autonomous cycle | Responsibility |
| --- | --- | ---: | --- |
| Job Hunter | `job_hunter` | 3 minutes | Searches LinkedIn through Apify, persists listings, evaluates fit, and sends promising leads to Portfolio Penguin. |
| Leetcode Coach | `leetcode_coach` | Daily | Publishes coding practice problems and coaches the user without revealing full solutions unless asked. |
| Tech Scout | `tech_scout` | Daily | Uses budgeted Tavily searches to produce a technology briefing grounded in current sources. |
| Portfolio Penguin | `portfolio` | 5 minutes | Tracks job leads, drafts cover-letter outlines, and summarizes the application pipeline. |

Each agent subclasses `BaseAgent` and runs as its own `asyncio.Task` inside the `agent-runner` service. Agents retain recent conversation memory as well as a closed schema of durable facts relevant to their role.

## Architecture

```text
Browser
  ├── REST ────────────────┐
  └── WebSocket ───────────┤
                           ▼
                    FastAPI service
                     ├── PostgreSQL
                     ├── Redis health check
                     └── WebSocket fan-out
                           ▲
                           │ HTTP + WebSocket
                    Agent runner
                     ├── Job Hunter ── Apify MCP
                     ├── Tech Scout ── Tavily MCP
                     ├── Leetcode Coach
                     └── Portfolio Penguin
                           │
                           └── in-process AgentBus
```

An inter-agent dispatch follows two paths:

1. The API persists a task and broadcasts `pigeon.dispatched` to connected browsers.
2. The in-process `AgentBus` delivers the task to the destination agent immediately.
3. The destination processes the task, updates the persisted record, and causes a `pigeon.delivered` event.

The database is the task ledger; the current `AgentBus` queue itself is in memory and is not restart-durable.

## Repository layout

```text
penguinhq/
├── apps/
│   ├── api/
│   │   └── app/
│   │       ├── api/routes/          # FastAPI REST and WebSocket routes
│   │       ├── autonomous/          # agent base class, runtime, bus, and agents
│   │       ├── core/                # database, Redis, and application settings
│   │       ├── domain/              # SQLAlchemy models and Pydantic schemas
│   │       └── ws/                  # WebSocket connection management
│   └── web/
│       └── src/
│           ├── app/                 # Next.js App Router
│           ├── components/          # office, chat, and practice UI
│           ├── hooks/               # API and WebSocket integration
│           ├── stores/              # Zustand state
│           └── types/               # frontend wire types
├── packages/shared-types/           # shared contract documentation/types
├── docker-compose.yml
└── .env.example
```

The office is rendered with React and DOM/CSS animation rather than PixiJS or canvas.

## Prerequisites

- Docker with Docker Compose, recommended for the full stack.
- An Anthropic API key for LLM-backed agent behavior.
- An Apify API token for Job Hunter's LinkedIn searches.
- A Tavily API key for Tech Scout's live research.

Node.js 20+ and Python 3 are also needed if you run services directly on the host.

## Quick start

```bash
cp .env.example .env
```

Add the integrations you want to use to `.env`:

```dotenv
ANTHROPIC_API_KEY=your_key
APIFY_API_TOKEN=your_token
TAVILY_API_KEY=your_key
```

Then start the stack:

```bash
docker compose up --build
```

| Service | Address |
| --- | --- |
| Web application | http://localhost:3000 |
| API | http://localhost:8000 |
| Interactive API docs | http://localhost:8000/docs |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

The API and web source directories are mounted into their development containers. Python agent files are watched by `watchfiles`, so changes restart the agent process automatically.

### Optional integrations

The API and frontend can run without external agent credentials, but the affected autonomous capabilities will be unavailable:

- Without `ANTHROPIC_API_KEY`, LLM calls fail and the agents cannot generate useful responses.
- Without `APIFY_API_TOKEN`, Job Hunter cannot collect LinkedIn listings.
- Without `TAVILY_API_KEY`, Tech Scout cannot perform live research.

See `.env.example` for search terms, locations, daily limits, MCP endpoints, timeouts, and other supported settings. Configure provider-side spending limits as the final cost backstop; the code's daily quotas are operational guardrails, not billing controls.

## Running services directly

Start the infrastructure first:

```bash
docker compose up postgres redis
```

Run the API:

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Run the autonomous agents in another terminal with the same Python environment and required environment variables:

```bash
cd apps/api
python -m app.autonomous
```

Run the frontend:

```bash
cd apps/web
npm install
npm run dev
```

When running outside Docker, ensure `DATABASE_URL`, `REDIS_URL`, `PENGUINHQ_API_BASE`, and `PENGUINHQ_WS_BASE` point to locally reachable services.

## Health checks

```bash
curl http://localhost:8000/health
curl http://localhost:8000/health/ready
curl http://localhost:8000/agents
curl http://localhost:8000/jobs
```

`/health` is the liveness endpoint. `/health/ready` verifies PostgreSQL and reports Redis connectivity.

## Development checks

Backend syntax check:

```bash
python3 -m compileall -q apps/api/app
```

Frontend type check and production build:

```bash
pnpm --filter @penguinhq/web typecheck
pnpm --filter @penguinhq/web build
```

The repository does not currently have a comprehensive automated test suite.

## Current limitations

- API routes and WebSocket connections are not authenticated; do not expose the development stack directly to the internet.
- Agent task delivery uses an in-memory queue even though task records are persisted.
- Agent facts are scoped per agent rather than shared as a single user or candidate profile.
- WebSocket fan-out is process-local and does not yet use Redis pub/sub.
- Database tables are initialized by the application; there is no migration workflow yet.
- Backend and frontend event contracts still require some manual synchronization.
- Search quality and availability depend on external MCP providers and their actor/tool schemas.

## Further documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) contains deeper implementation notes, though some sections may lag behind the source during active development.
- [`HANDOVER.md`](HANDOVER.md) is a dated development snapshot and should not be treated as the canonical setup guide.

For current behavior, the source code, `.env.example`, and this README are authoritative.
