<p align="center">
  <img src="assets/logo.svg" alt="X WAHA Bridge logo" width="760">
</p>

<p align="center">
  <a href="https://nodejs.org"><img alt="Node.js" src="https://img.shields.io/badge/Node.js-22-2f7d32?style=flat-square"></a>
  <a href="https://www.typescriptlang.org"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square"></a>
  <a href="https://railway.com"><img alt="Railway ready" src="https://img.shields.io/badge/Railway-ready-0b0d0e?style=flat-square"></a>
  <a href="https://docs.docker.com/compose/"><img alt="Docker Compose" src="https://img.shields.io/badge/Docker-Compose-2496ed?style=flat-square"></a>
  <img alt="License" src="https://img.shields.io/badge/license-MIT-111827?style=flat-square">
</p>

<p align="center">
  A production-minded bridge for mirroring public X posts into WhatsApp targets via WAHA and optional Telegram channels via Telegram Bot API.
</p>

## Overview

X WAHA Bridge watches one or more public X accounts, stores new posts in PostgreSQL, deduplicates them, then publishes each post through a Redis-backed worker. It is built for long-running deployment on Railway, Docker, or any Node.js host with PostgreSQL and Redis.

```mermaid
flowchart LR
  X["Public X accounts"] --> Scheduler["bridge-scheduler"]
  Scheduler --> DB[("PostgreSQL")]
  Scheduler --> Queue[("Redis / BullMQ")]
  Queue --> Worker["bridge-worker"]
  Worker --> WAHA["WAHA / WhatsApp"]
  Worker --> Telegram["Telegram Bot API"]
  API["bridge-api dashboard"] --> DB
  API --> Queue
```

## Features

- Poll one or many public X accounts.
- Publish to WhatsApp groups, channels, or direct chats through WAHA.
- Publish to Telegram chats or channels through a Telegram bot.
- Store source, post, delivery, retry, and failure state in PostgreSQL.
- Use Redis + BullMQ for reliable publish jobs.
- Avoid duplicate sends with delivery-level idempotency.
- Manage sources and retries from a simple admin dashboard.
- Deploy as separate API, scheduler, and worker services on Railway.

## Services

| Service | Role | Public domain |
| --- | --- | --- |
| `bridge-api` | Dashboard, admin API, healthcheck | Yes |
| `bridge-scheduler` | Polls X and enqueues new posts | No |
| `bridge-worker` | Sends queued posts to WAHA and Telegram | No |
| `postgres` | Persistent state | No |
| `redis` | Queue and scheduler lock | No |

## Quick Start Local

Use this path to test the app locally before deploying.

### 1. Create `.env`

```powershell
Copy-Item .env.example .env
```

On macOS/Linux:

```bash
cp .env.example .env
```

### 2. Fill the required values

Open `.env` and set these values:

```env
DATABASE_URL=postgres://bridge:bridge@postgres:5432/x_waha_bridge
REDIS_URL=redis://redis:6379

APP_LOGIN_ENABLED=true
APP_ADMIN_USERNAME=admin
APP_ADMIN_PASSWORD=change_this_password
APP_ADMIN_TOKEN=change_this_long_random_token

X_PROVIDER=nitter
X_NITTER_BASE_URL=https://nitter.net
X_SOURCE_USERNAMES=xdevelopers
X_BOOTSTRAP_MODE=latest

WAHA_BASE_URL=https://your-waha-host.example.com
WAHA_API_KEY=your_waha_api_key
WAHA_SESSION_NAME=default
WAHA_TARGETS=120363xxxxxxxxxx@g.us
WAHA_FORWARD_TARGETS=
```

Optional Telegram publishing:

```env
TELEGRAM_BOT_TOKEN=123456:telegram_bot_token
TELEGRAM_CHAT_IDS=@your_channel
TELEGRAM_SEND_MEDIA=true
```

### 3. Start the stack

```bash
docker compose up -d --build
```

### 4. Check health

```bash
curl http://localhost:8080/healthz
```

Expected shape:

```json
{
  "ok": true,
  "role": "api"
}
```

### 5. Open the dashboard

```text
http://localhost:8080
```

Login with `APP_ADMIN_USERNAME` and `APP_ADMIN_PASSWORD`, then click `Sync Now` to trigger a manual poll.

## Deploy To Railway

Railway should run this project as three app services from the same repository: one API, one scheduler, and one worker.

### 1. Create the Railway project

1. Create a new Railway project.
2. Connect this GitHub repository.
3. Add a PostgreSQL service.
4. Add a Redis service.

### 2. Create the app services

Create these three services from the same repo:

| Railway service | Required variable |
| --- | --- |
| `bridge-api` | `APP_ROLE=api` |
| `bridge-scheduler` | `APP_ROLE=scheduler` |
| `bridge-worker` | `APP_ROLE=worker` |

Only `bridge-api` needs a public domain.

### 3. Set variables for `bridge-api`

Use Railway variables, not `.env`, for production secrets.

```env
APP_ROLE=api
APP_LOGIN_ENABLED=true
APP_ADMIN_USERNAME=admin
APP_ADMIN_PASSWORD=replace_with_a_strong_password
APP_ADMIN_TOKEN=replace_with_a_long_random_token

DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}

X_PROVIDER=nitter
X_NITTER_BASE_URL=https://nitter.net
X_SOURCE_USERNAMES=xdevelopers
X_FETCH_INTERVAL_MS=90000
X_BOOTSTRAP_MODE=latest
X_SCHEDULER_LOCK_MS=300000

WAHA_BASE_URL=https://your-waha-host.example.com
WAHA_API_KEY=your_waha_api_key
WAHA_SESSION_NAME=default
WAHA_TARGETS=120363xxxxxxxxxx@g.us
WAHA_FORWARD_TARGETS=

PUBLISH_INLINE=false
PUBLISH_CONCURRENCY=1
PUBLISH_ATTEMPTS=3
PUBLISH_BACKOFF_MS=5000
```

Add Telegram only when needed:

```env
TELEGRAM_BOT_TOKEN=123456:telegram_bot_token
TELEGRAM_CHAT_IDS=@your_channel
TELEGRAM_SEND_MEDIA=true
```

Railway injects `PORT` automatically. You do not need to set `APP_PORT` for `bridge-api`.

### 4. Set variables for scheduler and worker

Copy the same variables to `bridge-scheduler` and `bridge-worker`, then change only `APP_ROLE`.

```env
APP_ROLE=scheduler
```

```env
APP_ROLE=worker
```

Do not expose public domains for these two services.

### 5. Set healthcheck

For `bridge-api`, set the Railway healthcheck path:

```text
/healthz
```

### 6. Deploy order

1. Deploy PostgreSQL and Redis.
2. Deploy `bridge-api`.
3. Deploy `bridge-scheduler`.
4. Deploy `bridge-worker`.
5. Open the `bridge-api` public domain.
6. Check `/healthz`.
7. Login to the dashboard.
8. Add or confirm X sources.
9. Click `Sync Now`.

## Telegram Setup

1. Open Telegram and chat with `@BotFather`.
2. Run `/newbot`.
3. Put the generated token in `TELEGRAM_BOT_TOKEN`.
4. Add the bot to your group or channel.
5. If publishing to a channel, make the bot an admin.
6. Put the target in `TELEGRAM_CHAT_IDS`.

Examples:

```env
TELEGRAM_CHAT_IDS=@public_channel
```

```env
TELEGRAM_CHAT_IDS=-1001234567890
```

Multiple targets:

```env
TELEGRAM_CHAT_IDS=@public_channel,-1001234567890
```

## WAHA Setup

Use a remote WAHA instance for production.

```env
WAHA_BASE_URL=https://your-waha-host.example.com
WAHA_API_KEY=your_waha_api_key
WAHA_SESSION_NAME=default
WAHA_TARGETS=120363xxxxxxxxxx@g.us
WAHA_FORWARD_TARGETS=120363xxxxxxxxxx@newsletter
```

Supported target formats:

| Target type | Example |
| --- | --- |
| WhatsApp group | `120363xxxxxxxxxx@g.us` |
| WhatsApp channel | `120363xxxxxxxxxx@newsletter` |
| Direct chat | `628xxxxxxxxxx@c.us` |
| Plain phone number | `628xxxxxxxxxx` |

For WhatsApp Channels, the connected WhatsApp account must be an admin or owner of the channel.

## Managing X Sources

From the dashboard:

1. Open `/`.
2. Add username without `@`.
3. Choose whether reposts, quotes, or replies should be included.
4. Click `Sync Now`.

From the API:

```bash
curl -X POST https://your-railway-domain.up.railway.app/sources \
  -H "Authorization: Bearer $APP_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"xdevelopers","includeReposts":false,"includeQuotes":true}'
```

Bulk add:

```bash
curl -X POST https://your-railway-domain.up.railway.app/sources/bulk \
  -H "Authorization: Bearer $APP_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"usernames":["xdevelopers","vercel","github"]}'
```

## API Reference

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Admin dashboard |
| `GET` | `/healthz` | Public healthcheck |
| `GET` | `/runtime` | Runtime config summary |
| `GET` | `/sources` | List sources |
| `POST` | `/sources` | Add one source |
| `POST` | `/sources/bulk` | Add multiple sources |
| `PATCH` | `/sources/:id` | Update source flags |
| `DELETE` | `/sources/:id` | Disable source |
| `GET` | `/posts?limit=20&page=1` | List stored posts |
| `GET` | `/deliveries?limit=50&page=1` | List deliveries |
| `POST` | `/sync-now` | Trigger poll now |
| `POST` | `/deliveries/retry` | Retry pending or failed deliveries |
| `GET` | `/waha/status` | Check WAHA session |

Admin endpoints require either browser login or:

```http
Authorization: Bearer <APP_ADMIN_TOKEN>
```

## Development

Run only database services in Docker, then run the app on your host:

```bash
npm run dev:infra
npm run dev
```

For this mode, use local database URLs:

```env
DATABASE_URL=postgres://bridge:bridge@localhost:5432/x_waha_bridge
REDIS_URL=redis://localhost:6379
```

Stop local infra:

```bash
npm run dev:infra:stop
```

## Optional Local WAHA

WAHA does not start by default. Start it only when you want a local WAHA session:

```bash
docker compose --profile local-waha up -d --build
```

Then set:

```env
WAHA_BASE_URL=http://waha:3000
```

## Testing

```bash
npm run typecheck
npm test
```

## Production Notes

- Do not commit `.env`.
- Rotate keys that were pasted into chats, logs, or screenshots.
- Use long random values for `APP_ADMIN_TOKEN` and `APP_ADMIN_PASSWORD`.
- Keep `APP_LOGIN_ENABLED=true` when exposing the dashboard.
- `X_PROVIDER=nitter` is useful for MVPs but depends on public Nitter availability.
- Prefer `X_PROVIDER=official` with an official X token for a more durable production setup.
- Keep `X_BOOTSTRAP_MODE=latest` to avoid publishing old history on first sync.
- Keep `PUBLISH_INLINE=false` on Railway because the worker service is persistent.
