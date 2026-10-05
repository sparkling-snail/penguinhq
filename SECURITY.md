# Security policy

## Reporting a vulnerability

Please do not post secrets or exploitable details in a public issue. Use GitHub’s private vulnerability reporting for this repository. Include the affected commit, reproduction steps, impact, and any suggested mitigation. You should receive an acknowledgement within seven days.

## Security model

- Local development permits unauthenticated API access when `API_ACCESS_TOKEN` is empty.
- Production refuses to start without `API_ACCESS_TOKEN`.
- All non-health HTTP routes require `Authorization: Bearer <token>` in production.
- WebSocket clients may observe broadcasts, but inbound chat mutation requires the token as `access_token`.
- The recommended public deployment compiles a deterministic read-only frontend and does not expose FastAPI, PostgreSQL, or Redis.
- Autonomous agents receive the service token only through environment configuration.

The service token is process authentication, not end-user authentication. Do not expose the interactive backend to untrusted users without adding sessions, authorization, rate limiting, abuse prevention, and provider cost controls.

## Secret handling

Never commit `.env`, `.env.production`, API keys, exported data, or recordings containing personal information. Rotate a token immediately if it appears in logs, screenshots, Git history, or an issue. Configure spending limits with every external provider; application quotas are not billing guarantees.

## Supported versions

This portfolio project currently supports the latest commit on `main`. Security fixes are not backported to older commits.
