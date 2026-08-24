# PenguinHQ Architecture

This document describes the architecture implemented in the current source tree. PenguinHQ is a local-first AI workspace that represents autonomous agents as penguins in a shared office, exposes their activity through chat and animation, and persists their working state in PostgreSQL.

The system is a development-stage modular monolith split across a browser application, an HTTP/WebSocket API, and one autonomous-agent process.

## System context

```text
┌──────────────────────────────┐
│ Browser                      │
│ Next.js + React + Zustand    │
└──────────┬───────────┬───────┘
           │ REST      │ WebSocket
           ▼           ▼
┌──────────────────────────────┐
│ FastAPI API                  │
│ routes + persistence +       │
│ process-local event fan-out  │
└──────┬───────────┬───────────┘
       │           │
       ▼           ▼
┌─────────────┐  ┌─────────────┐
│ PostgreSQL  │  │ Redis       │
│ durable data│  │ health only │
└─────────────┘  └─────────────┘
       ▲
       │ HTTP
┌──────┴───────────────────────┐
│ Agent runner                 │
│ four asyncio agent loops     │
│ + in-process AgentBus        │
└──────┬───────────────┬───────┘
       │               │
       ▼               ▼
  Anthropic API    External MCP servers
                   ├── Apify / LinkedIn actor
                   └── Tavily search
```

There are five Docker Compose services:

| Service | Responsibility | Exposed port |
| --- | --- | ---: |
| `web` | Next.js UI, chat, practice desk, and office renderer | 3000 |
| `api` | REST API, WebSocket endpoint, database access, and event fan-out | 8000 |
| `agent-runner` | Runs all autonomous agents in one Python process | None |
| `postgres` | Durable application state | 5432 |
| `redis` | Connectivity/readiness check; reserved for future coordination | 6379 |

The API and agent runner share the same Python image and source tree but have separate process lifecycles. The agent runner communicates with the API over its public HTTP and WebSocket interfaces rather than importing API route logic directly.

## Backend structure

```text
apps/api/app/
├── main.py                     # app construction, middleware, startup
├── core/
│   ├── config.py               # API settings
│   ├── database.py             # async SQLAlchemy engine and sessions
│   └── redis.py                # Redis connection and readiness check
├── domain/
│   ├── models/                 # SQLAlchemy persistence models
│   └── schemas/                # Pydantic request, response, and event types
├── api/routes/                 # HTTP and WebSocket transport layer
├── autonomous/
│   ├── base.py                 # shared agent lifecycle and integrations
│   ├── bus.py                  # in-process task router
│   ├── runtime.py              # discovery, construction, supervision
│   └── agents/                 # four specialized agents
└── ws/connection_manager.py    # process-local WebSocket registry
```

FastAPI's lifespan initializes database tables and seeds the four agents if the `agents` table is empty. There is currently no migration framework; schema evolution depends on application initialization and manual database management.

## Autonomous-agent runtime

`python -m app.autonomous` starts `AgentRuntime`. The runtime:

1. Creates one shared `httpx.AsyncClient`, `AsyncAnthropic`, and `AgentBus`.
2. Fetches agent records from `GET /agents`.
3. Matches each persisted role against a lazy Python class registry.
4. Instantiates each matching `BaseAgent` subclass.
5. Starts every agent as an independent `asyncio.Task`.
6. Restarts an agent loop if its top-level task exits.

The registered agents are:

| Class | Role | Cycle | Primary behavior |
| --- | --- | ---: | --- |
| `JobHunterAgent` | `job_hunter` | 180 seconds | Collect and persist LinkedIn jobs, evaluate fit, dispatch leads. |
| `LeetcodeCoachAgent` | `leetcode_coach` | 86,400 seconds | Publish a daily practice problem and review user attempts. |
| `TechScoutAgent` | `tech_scout` | 86,400 seconds | Run budgeted Tavily searches and publish a daily brief. |
| `PortfolioPenguinAgent` | `portfolio` | 300 seconds | Process job leads and summarize the application pipeline. |

### Agent loop priority

Every agent registers an `asyncio.Queue` inbox with `AgentBus` and starts a WebSocket listener for human chat. Its main loop prioritizes work in this order:

```text
human chat
    ▼
inter-agent inbox task
    ▼
wait for cycle interval
    ▼
autonomous cycle
```

Queues are checked periodically during the interval so chat and tasks can interrupt the wait. A failure inside a cycle is logged, followed by a ten-second delay before retrying the loop.

### Shared agent services

`BaseAgent` provides:

- State changes through `POST /agents/{id}/state`.
- Chat broadcasts through `POST /chat/send`.
- Durable recent memory through `/agents/{id}/memory`.
- Per-agent structured facts through `/agents/{id}/facts`.
- Anthropic message creation and public error sanitization.
- WebSocket chat listening and channel filtering.
- Task dispatch through the API and `AgentBus`.
- Task completion through `PATCH /tasks/{id}`.

Agent state is persisted before the API broadcasts `agent.state_changed`. The UI therefore uses the database-backed agent representation as the source of truth for work state.

### Human chat routing

Browser messages arrive as `chat.message` WebSocket events. Every agent maintains its own WebSocket connection and ignores:

- Messages authored by itself.
- Messages authored by any registered agent.
- Messages outside its configured channel and `human`.
- Direct-channel messages explicitly addressed to a different role.

An untagged message in `human` is visible to all agents. A message such as `@tech_scout research inference runtimes` wakes only Tech Scout. The shared `jobs` channel is consumed by Job Hunter and Portfolio Penguin, with role-specific filtering to reduce duplicate responses.

The default conversational path loads recent memory and durable facts, calls Anthropic, broadcasts and persists the reply, then performs a second LLM call to extract only the fact keys declared by the agent's fixed schema.

## Agent integrations

### Job Hunter and Apify

Job Hunter connects to the configured Apify streamable HTTP MCP endpoint, discovers the LinkedIn actor tool, invokes it with search criteria, and normalizes actor output into `JobListing` records. It:

- Uses saved target role and location facts when available.
- Filters descriptions that clearly require more than the configured experience limit.
- Extracts a small fixed set of recognizable skills.
- Upserts listings by `(source, source_job_id)`.
- Tracks a daily listing quota in its fact store.
- Evaluates one autonomous result with Anthropic and sends sufficiently strong leads to Portfolio Penguin.

Direct messages to Job Hunter execute the real collection path rather than asking an LLM to claim that it searched. Requests to show today's saved listings read PostgreSQL without spending collection quota.

### Tech Scout and Tavily

Tech Scout connects to Tavily's MCP endpoint and selects a basic search tool. It deliberately avoids crawling and advanced research tools. Before executing searches, it reserves the day's requested credits in its fact store, then supplies returned research to Anthropic for synthesis.

The daily code-side quota limits operational usage but is not a provider billing limit.

### Leetcode practice

Leetcode Coach publishes daily challenges, answers questions, and reviews user code. The practice desk persists a mutable session draft separately from immutable submitted attempts. When a message contains a practice-attempt marker, the coach's resulting review is also stored as `AttemptFeedback`.

### Portfolio processing

Portfolio Penguin receives `job_lead` tasks. High-fit leads trigger a cover-letter outline; other leads are logged. Its autonomous cycle summarizes recent memory as the current application pipeline.

## Inter-agent tasks and pigeon events

The intended task flow is:

```text
source agent
  │
  ├── POST /tasks ──► PostgreSQL task row
  │                      │
  │                      └── pigeon.dispatched ──► browser
  │
  └── AgentBus queue ──► destination agent
                              │
                              └── PATCH /tasks/{id}
                                      │
                                      └── pigeon.delivered ──► browser
```

The API resolves `destination_role` to a persisted agent, creates a task with `pending` status, and broadcasts a pigeon payload. The receiving agent processes the matching `AgentMessage` from its in-process queue and attempts to mark the task `completed`.

This design separates the durable task ledger from low-latency delivery, but it currently has two important limitations:

1. `AgentBus` queues exist only in the agent-runner process. Pending database tasks are not reclaimed after a restart.
2. `BaseAgent.dispatch_task()` generates a short bus task ID independently of the UUID returned by `POST /tasks`. The receiver can therefore attempt to complete an ID that does not match the persisted row. Until those IDs are unified, persisted completion and `pigeon.delivered` are not reliable.

## API surface

| Area | Principal endpoints | Purpose |
| --- | --- | --- |
| Health | `GET /health`, `GET /health/ready` | Liveness and PostgreSQL/Redis readiness |
| Agents | `GET /agents`, `POST /agents/{id}/state` | Roster and live work state |
| Memory | `GET/POST /agents/{id}/memory` | Recent chronological conversation/activity context |
| Facts | `GET/POST /agents/{id}/facts` | Per-agent durable key/value profile |
| Chat | `POST /chat/send` | Server-originated chat broadcast |
| Jobs | `POST /jobs/ingest`, `GET /jobs` | Idempotent job ingestion and listing history |
| Tasks | `POST/GET /tasks`, `PATCH /tasks/{id}` | Inter-agent task ledger |
| Practice | `/practice/sessions`, drafts, attempts, feedback | Durable coding practice workflow |
| Hooks | `POST /hooks/event` | Map external coding-tool activity to agent state |
| WebSocket | `/ws/{client_id}` | Real-time chat and server event fan-out |

The current API has no authentication or authorization. CORS restricts supported browser origins but does not protect endpoints from direct clients. This stack must not be exposed directly to the public internet.

## Real-time event model

Every outbound WebSocket message uses an envelope:

```json
{
  "type": "agent.state_changed",
  "payload": {},
  "timestamp": "2026-08-24T00:00:00Z"
}
```

Supported event types are:

| Event | Producer | Frontend effect |
| --- | --- | --- |
| `connection.ack` | WebSocket route | Confirms the caller-supplied client ID |
| `chat.message` | Browser socket or `POST /chat/send` | Adds a message and may show agent speech |
| `agent.state_changed` | State and hook routes | Upserts the agent and updates office behavior |
| `pigeon.dispatched` | Task creation | Adds a pigeon flight |
| `pigeon.delivered` | Task completion | Removes the matching pigeon |
| `agent.moved` | Reserved in the schema | No primary producer in the current backend |

`ConnectionManager` stores active sockets in API-process memory. It removes dead sockets during broadcast. This works for a single API process; multiple API workers would each see only their own clients. Redis pub/sub is not currently used to bridge processes.

Chat broadcasts are ephemeral. Browser chat is fanned out but not stored as a chat transcript. Agent memory is persisted separately when an autonomous agent handles or emits a message.

## Persistence model

| Table | Purpose |
| --- | --- |
| `agents` | Agent identity, role, state, room, position, and avatar color |
| `agent_memory` | Append-only user/assistant context per agent |
| `agent_facts` | Upserted key/value facts keyed by agent and fact name |
| `job_listings` | Deduplicated external job records and first/last seen timestamps |
| `tasks` | Task source, destination, type, priority, status, payload, and result |
| `practice_sessions` | Local user's current practice problem and mutable code draft |
| `practice_attempts` | Immutable code snapshots submitted for review |
| `attempt_feedback` | Persisted coach feedback for an attempt |

Facts are deliberately agent-scoped. Job Hunter and Portfolio Penguin can declare the same candidate fields but do not automatically share their learned values.

There are few database-level foreign keys outside the practice tables. Agent memory, facts, and tasks rely mostly on application-level identity consistency.

## Frontend architecture

The frontend uses Next.js App Router and a DOM/CSS office renderer:

- React Query fetches server data such as the agent roster and practice session.
- `useWebSocket` is the single adapter from backend events into client state.
- `gameStore` holds agents, selected agent, pigeon flights, speech, and office preferences.
- `chatStore` holds channels and the current in-memory chat transcript.
- `GameCanvas` drives character position and animation with local refs and `requestAnimationFrame` to avoid React state updates on every frame.
- Agent state selects work animation, speech, and visual treatment; cosmetic routines keep idle agents moving around the office.
- Furniture layout and office display preferences use browser-local storage.

The frontend mirrors Python event types in TypeScript. `packages/shared-types` documents cross-language contracts, but the applications do not yet consume one generated schema, so contract changes require manual synchronization.

## External coding-session hooks

`hooks/agent-tracker.sh` can post coding-tool events to `/hooks/event`. The API maps tool names to visual states such as `coding`, `debugging`, or `researching`, assigns a session to an agent, persists the state, and broadcasts it.

Autonomous roles are excluded from the normal round-robin so hook-driven changes do not compete with their own agent-runner state updates. If no non-autonomous agents exist, the route falls back to the full roster, which can reintroduce that collision.

Session-to-agent assignments are stored in API-process memory and reset when the API restarts.

## Configuration and deployment assumptions

- Docker Compose is the supported development topology.
- The frontend calls browser-reachable `localhost` API and WebSocket URLs.
- The agent runner calls the API using Docker-network service names.
- API settings use `pydantic-settings`; autonomous integrations also read environment variables directly.
- Source directories are bind-mounted for local hot reload.
- PostgreSQL and Redis publish host ports and use development defaults unless `.env` overrides them.
- There is no production reverse proxy, TLS termination, user identity, service authentication, rate limiter, or secret manager in this repository.

## Reliability and scaling boundaries

The current architecture intentionally favors a simple single-host development experience. Before production use, the main boundaries to address are:

- Authenticate users, internal services, HTTP mutations, and WebSocket clients.
- Unify the API task UUID with the ID delivered through `AgentBus`.
- Replace or augment the in-memory bus with restart-safe task claiming.
- Use Redis pub/sub or another broker for multi-process WebSocket delivery.
- Move quotas into atomic counters rather than fact-store read/modify/write operations.
- Add database migrations and stronger relational constraints.
- Separate conversation memory from autonomous activity history.
- Add structured telemetry for cycles, external calls, task latency, tokens, and cost.
- Generate or validate shared frontend/backend contracts.
- Add automated unit, integration, and end-to-end tests.

These are explicit constraints of the current implementation, not capabilities supplied implicitly by PostgreSQL or Redis.
