# Deploying the public portfolio demo

The production Compose file intentionally publishes only the read-only Next.js demo. FastAPI, PostgreSQL, and Redis stay on an internal Docker network, and the frontend is built without backend calls. This is the recommended portfolio topology.

## 1. Prepare a host

Use a Linux host with Docker Engine, the Compose plugin, ports 80/443 open, and a domain pointed at the host. Clone the repository, then create the production environment file:

```bash
cp .env.production.example .env.production
openssl rand -hex 32
openssl rand -hex 32
```

Use the generated values for `POSTGRES_PASSWORD` and `PENGUINHQ_API_TOKEN`. Set `SITE_ADDRESS` to the hostname and `SITE_URL` to its full `https://` URL. Never commit `.env.production`.

## 2. Validate configuration

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production config
```

Review the rendered config before startup. In particular, confirm that only Caddy maps host ports. The API, database, and Redis services must not have `ports` entries.

## 3. Launch

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

Caddy obtains and renews TLS certificates when `SITE_ADDRESS` is a public hostname. The API container runs `alembic upgrade head` before starting FastAPI.

The initial migration assumes either a new database or one already managed by Alembic. If you are adopting migrations on a database created by an older PenguinHQ checkout, compare its schema to the initial revision and back it up before using `alembic stamp 20261005_0001`; stamping records history without changing tables and must not be used when the schemas differ.

Autonomous agents are disabled by default because the public demo does not need them. To run the private agent runtime as well, add `ANTHROPIC_API_KEY` and opt into its profile:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production --profile agents up -d --build
```

The agent runner reaches FastAPI on the private network and authenticates with `PENGUINHQ_API_TOKEN`.

## 4. Operate and update

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f --tail=200
git pull --ff-only origin main
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Back up the `postgres_data` volume before upgrades that change stored data. Test migrations against a restored copy before applying them to the primary deployment.

## Rollback

Keep the previous image tag or Git commit available. Application rollback and database rollback are separate decisions: prefer a forward-fix migration for production data, and only run `alembic downgrade` after verifying that the migration is lossless.

## Full interactive deployment

The included public topology is deliberately read-only. Exposing live chat to untrusted users needs end-user authentication, authorization, abuse controls, rate limits, and cost quotas in addition to the internal service token. Do not publish the private API until those controls exist.
