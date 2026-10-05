# PenguinHQ case study

## The problem

Most agent demos hide the interesting part behind a chat box. PenguinHQ asks a different question: can a person understand what several autonomous agents are doing, which agent owns a task, and when work changes hands—without reading logs?

The result is a local-first AI workspace where four specialists are represented inside a shared office. The office is not a decorative animation layered over a chatbot. It is a projection of persisted agent state and typed events from the backend.

![PenguinHQ office](images/penguinhq-office.jpg)

## Product constraints

- Keep autonomous work responsive to human interruption.
- Persist important state across process restarts.
- Make agent hand-offs visible and inspectable.
- Treat paid external tools as optional capabilities with explicit budgets.
- Provide a public portfolio demo without exposing user data, write endpoints, or API keys.

## System design

```text
Public visitor ──► read-only Next.js demo (deterministic sample state)

Private runtime
Browser ── REST / WebSocket ──► FastAPI ──► PostgreSQL
                                  │  ▲
                                  ▼  │
                              Redis pub/sub
                                  ▲
                                  │ service-token HTTP / WebSocket
                           asyncio agent runner
                             ├── Anthropic
                             └── MCP tools
```

The agent runner hosts four independent `asyncio` loops. A human message has higher priority than an inter-agent task, and an inter-agent task has higher priority than the next autonomous cycle. FastAPI owns transport and persistence; PostgreSQL is the durable ledger; Redis carries events between API replicas; the browser consumes a typed WebSocket envelope.

## Decisions that mattered

### Persist first, animate second

An agent dispatch first creates a real task row and receives its database UUID. The same ID then enters the in-process bus and the visual pigeon event. This avoids a subtle class of demos where the animation succeeds even though the underlying operation was never recorded.

### Two delivery paths, two different jobs

PostgreSQL provides auditability and recovery context. The in-process `AgentBus` provides low-latency delivery to a running destination agent. They are intentionally separate, but share one task identity. A future worker can reclaim pending database rows without changing the UI contract.

### One event adapter in the browser

Only `useWebSocket` translates backend events into Zustand state. Components render state; they do not parse wire messages or own socket lifecycles. That boundary keeps reconnection and protocol behavior testable.

### Safe degradation for external tools

Apify, Tavily, and Anthropic are optional at runtime. Missing credentials disable the affected capability rather than the whole office. Provider errors are reduced to short public messages so raw response text and credentials are not echoed into chat.

### A separate public-demo mode

The portfolio deployment is compiled with `NEXT_PUBLIC_DEMO_MODE=true`. It uses a deterministic, sanitized roster, disables outbound WebSockets and mutation controls, and does not route the private API through Caddy. This is safer than trying to make production data “mostly read-only” at the endpoint layer.

## Production-readiness work

- Alembic owns schema history; automatic `create_all` is a development-only convenience.
- A constant-time bearer-token check protects private HTTP routes and inbound WebSocket chat.
- Redis pub/sub synchronizes WebSocket broadcasts across API replicas, with local fallback in development.
- Production containers run as non-root users, and the default Compose topology keeps PostgreSQL, Redis, and FastAPI on an internal network.
- Caddy provides TLS termination and baseline security headers.
- Open Graph, Twitter card, canonical, robots, and SoftwareApplication metadata make shared links presentable.
- CI runs Python lint/tests and frontend lint/typecheck/tests/build.

## Verification

The repository contains focused tests for the in-process bus, WebSocket fan-out, event shapes, hook mapping, quota and job filtering, browser reconnection, and client state. The handoff checklist is intentionally reproducible:

```bash
cd apps/api && ruff check . && pytest -q && alembic heads
cd apps/web && npm run lint && npm run typecheck && npm test && npm run build
docker compose -f docker-compose.prod.yml --env-file .env.production config
```

## Honest trade-offs

- The service token authenticates trusted processes; it is not a multi-user login or authorization model.
- The agent bus is still in memory. Persisted pending tasks are visible after restart, but no worker leases and reclaims them yet.
- Chat fan-out is ephemeral. Agent memory is durable, but it is not a complete collaborative chat transcript.
- External search quality depends on provider schemas and availability.
- Character art is being migrated toward a wholly original visual identity; provenance and replacement guidance live in [ART_ASSETS.md](ART_ASSETS.md).

## What I would build next

1. Per-user OIDC sessions and row-level authorization.
2. A durable task worker with leases, retries, idempotency keys, and dead-letter handling.
3. OpenTelemetry traces joining a user request, agent decision, MCP call, database task, and UI event.
4. Contract generation from one event schema instead of mirrored Pydantic and TypeScript definitions.
5. Fully original character sheets and accessibility-driven interaction testing.
