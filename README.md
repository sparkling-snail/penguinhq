# PenguinHQ

[![CI](https://github.com/sparkling-snail/penguinhq/actions/workflows/ci.yml/badge.svg)](https://github.com/sparkling-snail/penguinhq/actions/workflows/ci.yml)

**A multi-agent AI system you can watch.** Four autonomous Claude-powered agents run around the clock — hunting for jobs, scouting new tech, coaching interview practice, and tracking applications — and each one is a penguin in a live virtual office. When agents hand work to each other, a messenger pigeon flies across the room.

![PenguinHQ virtual office showing autonomous AI agents at their workstations](docs/images/penguinhq-office.jpg)

*The live office turns agent state, collaboration, and background work into an interactive visual workspace.*

Under the hood it is a real distributed-ish system: a FastAPI backend, a separate agent-runner process with four concurrent `asyncio` agents, PostgreSQL as the task ledger, MCP tool integrations for live data, and a WebSocket event stream that drives a Next.js front end.

**Portfolio walkthrough:** [live demo](https://penguinhq.vercel.app/) · [case study](docs/CASE_STUDY.md) · [architecture](ARCHITECTURE.md) · [safe deployment](docs/DEPLOYMENT.md) · [60-second demo script](docs/DEMO_SCRIPT.md) · [security model](SECURITY.md)

> The public build is a deterministic, read-only showcase. The live agent backend remains private and is protected with service authentication; see [Current limitations](#current-limitations) for the boundary between service auth and full user auth.

## Demo

**[Open PenguinHQ →](https://penguinhq.vercel.app/)**

> **Live runtime demonstrations:** These screenshots show the full private runtime, running locally or on the authenticated AWS deployment. The public Vercel demo remains a deterministic, read-only portfolio showcase.

![PenguinHQ live office with autonomous agents and Leetcode Coach conversation](docs/images/live-agent-office.jpg)

*The private runtime projects real agent state into the office: Job Hunter searches and evaluates listings while Leetcode Coach handles a live practice conversation.*

![PenguinHQ autonomous agents following role-specific office routines](docs/images/autonomous-agent-routines.jpg)

*Live state also drives spatial routines: Tech Scout works at the planning area, Portfolio Penguin recharges in the nap pod, and Job Hunter diagnoses the build server while the shared job conversation continues.*

![PenguinHQ Job Hunter displaying LinkedIn search results from Apify alongside the live office](docs/images/job-hunter-visualisation.png)

*Job Hunter runs a live LinkedIn search through Apify, returns a verified listing card, and enforces a durable daily quota. Portfolio Penguin clarifies the application intent in the same shared channel.*

![PenguinHQ Watty profile form with AI Engineer selected as the target role](docs/images/watty-profile-demonstration.png)

*Watty’s profile gives the flock shared context: name, target roles, preferred location, experience, skills, and goals. The private runtime saves these fields in PostgreSQL and uses them in agent conversations and Job Hunter’s default searches. This demonstration shows the profile form alongside the live office and proximity greetings.*

![PenguinHQ Tech Scout producing a structured AI research briefing](docs/images/tech-scout-research-briefing.jpg)

*Tech Scout turns a request in `#research` into a structured technology briefing, highlighting the key themes and why they matter while the office continues visualizing every agent's current routine.*

![PenguinHQ agents gathered around the interactive collaboration table](docs/images/collaboration-table-meeting.jpg)

*Interactive furniture can gather the flock for a team meeting. Depth-aware layering places rear attendees behind the tabletop while the three front penguins occupy the visible stools.*

![PenguinHQ Leetcode practice desk showing a persisted attempt and a targeted coaching hint](docs/images/leetcode-coach-hint.jpg)

*The practice desk saves an immutable review attempt, sends it to Leetcode Coach, and returns a focused hint without revealing the full solution. The public Vercel demo remains read-only so visitors cannot mutate private data or incur API costs.*

## Engineering highlights

- **Concurrent autonomous agents.** Each agent is its own `asyncio.Task` with a priority loop — human chat beats inter-agent tasks, which beat the autonomous cycle — so the office stays responsive while agents work in the background.
- **Two-path task dispatch.** An inter-agent task is delivered instantly through an in-process `AgentBus` *and* persisted through the API, which broadcasts `pigeon.dispatched` / `pigeon.delivered` events. The database is the source of truth; the visual is a projection of it.
- **Real tools over MCP.** Job Hunter calls an Apify LinkedIn actor and Tech Scout calls Tavily search through MCP clients, with tolerant parsing of tool output and per-day budgets stored as agent facts so a restart can't overspend.
- **Typed real-time contract.** Every live update is a typed WebSocket envelope mirrored between Pydantic and TypeScript. The browser client reconnects with capped exponential backoff after a backend restart.
- **Cross-replica events.** API replicas publish WebSocket events through Redis pub/sub and fan them out to their own connected clients, with a process-local fallback for development.
- **Safe portfolio mode.** A build-time demo flag supplies sanitized state and disables network mutations, while the recommended reverse proxy exposes only Next.js—not the private API or data stores.
- **Production schema workflow.** Alembic owns database migrations; production containers migrate before startup and never rely on runtime `create_all`.
- **Smooth animation without React churn.** Agent movement lives in refs and is written straight to the DOM; the Zustand store only holds what React needs to re-render (roster, pigeons, speech bubbles).
- **Claude Code integration.** A hook script turns your own Claude Code session into a penguin: editing makes it code, `Bash` makes it debug, web search makes it research (see [Watch your Claude Code session](#watch-your-claude-code-session)).
- **Safe failure modes.** LLM errors are mapped to short, actionable messages without echoing raw provider error text, and each missing integration disables only the capability that depends on it.

## Tech stack

Next.js 14 · React 18 · TypeScript · Zustand · Tailwind CSS · FastAPI · SQLAlchemy 2 (async) · PostgreSQL · Redis · Anthropic API · Model Context Protocol (Apify, Tavily) · Docker Compose · Vitest · pytest · GitHub Actions

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
                     ├── Redis pub/sub
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
├── docker-compose.prod.yml          # read-only public demo topology
├── deploy/Caddyfile                 # TLS, reverse proxy, security headers
├── docs/                            # case study, deployment, demo, art notes
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

## Public portfolio deployment

The production topology builds the frontend with `NEXT_PUBLIC_DEMO_MODE=true`, keeps API/data services on an internal network, runs schema migrations, and serves the site through Caddy with automatic HTTPS:

```bash
cp .env.production.example .env.production
docker compose -f docker-compose.prod.yml --env-file .env.production config
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Replace every placeholder secret and hostname first. The full checklist, update flow, rollback notes, and boundary for a live interactive deployment are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Health checks

```bash
curl http://localhost:8000/health
curl http://localhost:8000/health/ready
curl http://localhost:8000/agents
curl http://localhost:8000/jobs
```

`/health` is the liveness endpoint. `/health/ready` verifies PostgreSQL and reports Redis connectivity.

## Tests and checks

Every push and pull request runs the same checks in [GitHub Actions](.github/workflows/ci.yml).

Backend (lint + unit tests; no database or API keys needed):

```bash
cd apps/api
pip install -r requirements-dev.txt
ruff check .
pytest
alembic heads
```

Frontend (lint, type check, unit tests, production build):

```bash
cd apps/web
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The unit tests cover the agent bus, WebSocket fan-out, the Claude Code hook mapping, job-listing parsing and filtering, daily quota handling, LLM error sanitization, the browser WebSocket client's reconnect behavior, and the game store.

## Watch your Claude Code session

`hooks/agent-tracker.sh` forwards Claude Code hook events to `POST /hooks/event`. The API assigns each session to a non-autonomous penguin and animates it based on the tool being used. To enable it, add this to your project's `.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/hooks/agent-tracker.sh" }] }],
    "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/hooks/agent-tracker.sh" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/hooks/agent-tracker.sh" }] }]
  }
}
```

The script posts in the background with a 2-second timeout, so an unreachable API never slows down your session.

## Current limitations

- The bearer token authenticates trusted services, not individual users. A public interactive backend still needs OIDC/session auth, per-user authorization, rate limiting, and abuse/cost controls.
- Agent task delivery uses an in-memory queue even though task records are persisted.
- Agent facts are scoped per agent rather than shared as a single user or candidate profile.
- Backend and frontend event contracts still require some manual synchronization.
- Search quality and availability depend on external MCP providers and their actor/tool schemas.
- Chat fan-out is ephemeral; agent memory is durable, but it is not a complete chat transcript.

## Further documentation

- [`docs/CASE_STUDY.md`](docs/CASE_STUDY.md) frames the engineering problem, decisions, trade-offs, and next steps.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) contains the deeper implementation reference.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) documents the safe public topology and operational workflow.
- [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) is a publish-ready shot list and privacy checklist for the demo video/GIF.
- [`SECURITY.md`](SECURITY.md) describes service authentication, secret handling, and vulnerability reporting.
- [`docs/ART_ASSETS.md`](docs/ART_ASSETS.md) records the visual-identity risk and original-art migration plan.

For current behavior, the source code, `.env.example`, and this README are authoritative.

## Art and trademarks

PenguinHQ is an independent, non-commercial portfolio project. It is **not affiliated with, endorsed by, or sponsored by Disney or Club Penguin**. "Club Penguin" is a trademark of Disney.

The penguin character sprites are AI-generated fan art inspired by the style of Club Penguin. They are included for demonstration only and are **not** covered by this repository's license. The office furniture, background, and social preview are original AI-generated artwork. See [`docs/ART_ASSETS.md`](docs/ART_ASSETS.md) for provenance guidance and the original-character replacement plan. If you are a rights holder and would like something changed or removed, please open an issue.

## Acknowledgements

The office renderer and Claude Code hook bridge are adapted from [Claude-Office](https://github.com/W17ant/Claude-Office) by W17ANT (MIT). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

The source code is released under the [MIT License](LICENSE). Image assets under `apps/web/public/` are excluded — see [Art and trademarks](#art-and-trademarks).
