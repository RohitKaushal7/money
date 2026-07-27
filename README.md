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

The app ships as a single public Docker image — **`rohitkaushal7/money`**, multi-arch for **amd64** and
**arm64**, so the same tag runs on an x86 server, an Apple Silicon Mac, or a Raspberry Pi. One container
serves both the API and the web UI on one origin, applies database migrations on startup, and keeps all
state in a bind-mounted `data/` directory.

> **Raspberry Pi: 64-bit OS required.** DuckDB publishes no 32-bit ARM build, so 32-bit Raspberry Pi OS
> cannot run this image — use the 64-bit edition (`uname -m` should say `aarch64`). Give it 1GB+ of RAM;
> rebuilding the analytics database is the memory peak.

### 1. Create a project directory

```bash
mkdir -p ~/apps/money && cd ~/apps/money
```

### 2. `docker-compose.yml`

```yaml
name: money
services:
  money:
    image: rohitkaushal7/money:latest   # multi-arch: amd64 + arm64
    container_name: money
    init: true
    ports:
      - "3000:3000"          # put a reverse proxy in front for HTTPS — see the note below
    environment:
      NODE_ENV: production
      DATA_DIR: /app/data
    env_file:
      - path: ./.env
        required: false        # .env is optional — see step 3
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

### 3. `.env` (optional)

Both variables below are **optional**. With none set, a fresh install generates its own auth secret and
assumes `http://localhost:3000` — so you can skip this step entirely for a local install. Create a `.env`
next to the compose file only to override them:

```dotenv
# OPTIONAL. A 32+ character secret for Better-Auth sessions. If unset, one is generated on first boot and
# persisted at data/auth-secret (inside your ./data volume), so sessions survive restarts. Set it only to
# pin the value; changing it later logs everyone out (passwords are unaffected).
BETTER_AUTH_SECRET=

# OPTIONAL. The origin the browser uses to reach the app, no trailing slash. Defaults to
# http://localhost:3000. Set this whenever you reach the app from any OTHER origin — a different published
# port, a LAN IP, or a domain behind a reverse proxy.
BETTER_AUTH_URL=https://money.example.com
```

`NODE_ENV` and `DATA_DIR` are baked into the compose file.

> **Same machine works out of the box; anything else needs HTTPS.** Session cookies are issued with
> `Secure` + `SameSite=None`. Opening `http://localhost:3000` on the machine that runs the container works
> as-is (localhost is a secure context) — provided you publish it on port `3000`, matching the default
> `BETTER_AUTH_URL`. To reach it from another machine — a LAN IP or a domain — front the container with a
> reverse proxy that terminates TLS (Caddy, Nginx Proxy Manager, nginx, Traefik), forward **all** traffic
> to port `3000`, and set `BETTER_AUTH_URL` to that HTTPS origin. TLS is yours to run.

### 4. Start it

```bash
docker compose up -d
docker compose logs -f     # watch it migrate, then serve
```

### 5. Create your owner account

Open `http://localhost:3000` (or your `BETTER_AUTH_URL`). On a fresh install the first screen is a one-time
setup page: fill in your name, email, and a password (8+ characters) to create the **owner** account. It
appears only while no account exists and closes for good once yours is made — public signup stays disabled.
From the in-app **Admin** dashboard you can then invite and manage everyone else.

Prefer the command line? Seed the first admin from inside the container instead:

```bash
docker compose exec money bun scripts/create-user.ts \
  --email you@example.com --name "Your Name" --admin --password 'choose-a-strong-password'
```

### Updating & backups

```bash
docker compose pull && docker compose up -d   # upgrade to the latest image
```

Every release is also published under its commit SHA, so you can pin to a known-good
build instead of tracking `latest` — set `image: rohitkaushal7/money:a1b2c3d` in your
compose file. Migrations run automatically on start, so upgrading is just a pull.

Everything durable lives in `./data`: the auto-generated `auth-secret`, a shared `control.db` (auth +
reference data), and one folder per user (`users/<id>/` with their SQLite + DuckDB files and raw imports).
Back up that directory — ideally stop the container first (`docker compose down`) for a consistent snapshot.
There is no automatic off-site backup, so a dead disk means lost data; back up `./data` on your own schedule,
and use **Settings → Data** to export your ledger, plan, and spending as CSV for a portable copy.

### What leaves your machine

Self-hosted, your financial data stays in `./data` and never leaves the box. The app makes exactly **one**
kind of outbound request: fetching foreign-exchange rates from `api.frankfurter.dev`, and only when you
refresh currency rates (Settings → Currencies). Nothing else is sent anywhere — and if you never touch
multi-currency, the app makes no outbound calls at all.

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
Build and ship the container with `bun run docker:build` and `bun run deploy` (see `deploy.sh`) — both are
host-arch only, which is all a deploy to your own x86 server needs. `bun run docker:publish` is the
multi-arch one: it cross-builds amd64 + arm64 and pushes a single manifest list (see `publish.sh`). Full
list of scripts in the root `package.json` and `CLAUDE.md`.

## Documentation

- **`CLAUDE.md`** — working agreement + the hard rules (read this before touching data).
- **`docs/decisions/`** — architecture decision records (ADRs).
- **`docs/roadmap.md`** — phasing.

---

Scaffolded with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack)
(TanStack Router · Hono · oRPC · Drizzle · Better-Auth · Bun · Turborepo · Biome · PWA).
