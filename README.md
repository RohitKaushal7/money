# money

A **self-hosted personal money-management app** — track your ledger, investments, net worth, spending,
India income tax, and credit-card rewards in one place. INR; Indian financial year (1 Apr – 31 Mar).

**North-star KPI:** what fraction of your monthly expenses is covered by **passive income**, and is that
ratio **trending up**. Everything else is instrumentation for that one number.

It started as a single-user replacement for a per-financial-year Excel workbook and grew into an
**invite-only, multi-user** app you can host for yourself and a few friends — each user's data is fully
isolated in its own set of database files.

## Features

- **Coverage / Plan** — the passive-income-vs-expenses KPI, from a curated plan of investments and
  recurring expenses (with a switchable after-tax view).
- **Wealth** — holdings, a three-tier return ladder, and a net-worth-over-time log with growth % / CAGR.
- **Spending** — monthly category trends, a stacked-bar history, and plan-budget overlays.
- **Transactions & Import** — a generic field-mapping CSV importer (onboard any bank's statement), inline
  categorisation with editable rules, and split editing.
- **Tax (India)** — old-vs-new regime comparison, deduction planning, and capital-gains buckets.
- **Cards** — a credit-card reward-rate knowledge base and a "best card for this spend" picker.
- **Multi-currency**, plus a **superadmin dashboard** for inviting and managing users.

## Self-hosting

The app ships as a single public Docker image — **`rohitkaushal7/money`** (amd64 / x86-64). One container
serves both the API and the web UI on one origin, applies database migrations on startup, and keeps all
state in a bind-mounted `data/` directory.

### 1. Create a project directory

```bash
mkdir -p ~/apps/money && cd ~/apps/money
```

### 2. `docker-compose.yml`

```yaml
name: money
services:
  money:
    image: rohitkaushal7/money:latest   # amd64 / x86-64
    container_name: money
    init: true
    ports:
      - "3000:3000"          # put a reverse proxy in front for HTTPS — see the note below
    environment:
      NODE_ENV: production
      DATA_DIR: /app/data
    env_file:
      - path: ./.env
        required: true
    volumes:
      - ./data:/app/data     # ALL durable state (databases + raw imports) — back this up
    healthcheck:
      test:
        [
          "CMD",
          "bun",
          "-e",
          "fetch('http://localhost:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))",
        ]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 20s
    restart: unless-stopped
```

### 3. `.env`

Two variables, in the same directory as the compose file:

```dotenv
# A 32+ character random secret for Better-Auth. Generate once with `openssl rand -base64 32` and keep it
# stable — changing it later logs everyone out (passwords are unaffected).
BETTER_AUTH_SECRET=replace-me

# The public HTTPS origin your reverse proxy serves, with NO trailing slash.
BETTER_AUTH_URL=https://money.example.com
```

`NODE_ENV` and `DATA_DIR` are baked into the compose file; these two are the only values you set.

> **HTTPS is required.** Session cookies are issued with `Secure` + `SameSite=None`, so login works only
> over HTTPS (or `http://localhost` for local testing). Front the container with a reverse proxy that
> terminates TLS — Caddy, Nginx Proxy Manager, nginx, Traefik — forwarding **all** traffic to the
> container's port `3000`, and set `BETTER_AUTH_URL` to that public HTTPS URL. Plain `http://<lan-ip>:3000`
> loads the page but silently fails login.

### 4. Start it

```bash
docker compose up -d
docker compose logs -f     # watch it migrate, then serve
```

### 5. Create your first admin

Public signup is disabled (the app is invite-only), so seed the first **admin** from inside the running
container:

```bash
docker compose exec money bun scripts/create-user.ts \
  --email you@example.com --name "Your Name" --admin --password 'choose-a-strong-password'
```

The password must be at least 8 characters. Now open your `BETTER_AUTH_URL` and log in. From the in-app
**Admin** dashboard you can invite and manage everyone else — you won't need this command again.

### Updating & backups

```bash
docker compose pull && docker compose up -d   # upgrade to the latest image
```

Every release is also published under its commit SHA, so you can pin to a known-good
build instead of tracking `latest` — set `image: rohitkaushal7/money:a1b2c3d` in your
compose file. Migrations run automatically on start, so upgrading is just a pull.

Everything durable lives in `./data`: a shared `control.db` (auth + reference data) and one folder per user
(`users/<id>/` with their SQLite + DuckDB files and raw imports). Back up that directory — ideally stop the
container first (`docker compose down`) for a consistent snapshot.

## Architecture

Two data stores, split by workload (ADR-0001):

- **DuckDB** — analytical, read-heavy, **rebuildable** derived state (transactions, holdings, derived
  views). Rebuilt from immutable raw exports; never migrated in place. The API opens it **read-only**; a
  separate ingest script owns the sole read-write connection (ADR-0003). All DuckDB code is isolated in
  `@money/analytics` (ADR-0009).
- **SQLite** (Drizzle) — durable app state (auth, categorisation rules, overrides, saved configs). The only
  migrated store.

Data is **isolated per user by file, not by a tenant column** (ADR-0010): a shared `control.db` holds auth
and curated reference data, and each user gets `data/users/<id>/{app.db, analytics.duckdb, raw/}`. See
`CLAUDE.md` for the full rule set and `docs/decisions/` for the *why*.

## Project structure

```
apps/
  web/                React + TanStack Router SPA + PWA
  server/             Hono + oRPC (RPC /rpc, OpenAPI /api-reference, auth /api/auth/*); serves the built web in prod
packages/
  api/       @money/api        oRPC procedures / routers / context
  auth/      @money/auth       Better-Auth (email+password; invite-only, admin roles)
  db/        @money/db         Drizzle + libSQL (SQLite app state)
  analytics/ @money/analytics  ALL DuckDB code — read-only reads + the sole /ingest read-write path
  shared/    @money/shared     framework-agnostic domain compute + taxonomy/types
  env/       @money/env        t3-env (/server, /web)
  ui/        @money/ui         shadcn primitives
  config/    @money/config     shared tsconfig base
scripts/
  ingest.ts        sole read-write DuckDB owner (run per user, on demand)
  migrate-db.ts    apply SQLite migrations (control.db + every users/<id>/app.db)
  create-user.ts   seed / invite an account and provision its storage
data/                per-user databases + immutable raw imports (gitignored)
docs/                decisions/ (ADRs), roadmap.md, superpowers/specs/
```

## Development

```bash
bun install
bun run dev            # web on :3001, server on :3000
bun run db:migrate     # apply SQLite migrations (control.db + every users/<id>/app.db)
```

Common scripts: `bun run check-types`, `bun run check` (Biome), `bun run db:studio`, `bun run ingest`.
Build and ship the container with `bun run docker:build` and `bun run deploy` (see `deploy.sh`). Full list
in the root `package.json` and `CLAUDE.md`.

## Documentation

- **`CLAUDE.md`** — working agreement + the hard rules (read this before touching data).
- **`docs/decisions/`** — architecture decision records (ADRs).
- **`docs/roadmap.md`** — phasing.

---

Scaffolded with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack)
(TanStack Router · Hono · oRPC · Drizzle · Better-Auth · Bun · Turborepo · Biome · PWA).
