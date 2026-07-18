# money

A **self-hosted personal money-management app** (single user; INR; Indian financial year, 1 Apr – 31 Mar).
It replaces a per-financial-year Excel workbook whose Power Query categorisation broke on Linux, and it
removes the one-workbook-per-year friction by spanning all years in one data model.

**North-star KPI:** what fraction of monthly expenses is covered by **passive income**, and is that ratio
**trending up**. Everything else is instrumentation for that one number.

> **Status: bootstrapped (Phase 0).** Architecture, boundaries, and docs are in place. The **domain/business
> schema is intentionally not designed yet** — it gets a dedicated feature-brainstorming → schema session
> first (see `docs/roadmap.md`). There is no ingest parser or feature UI yet.

## Architecture

Two data stores, split by workload (ADR-0001):

- **DuckDB** (`data/analytics.duckdb`) — analytical, read-heavy, **rebuildable** derived state. Rebuilt
  from immutable raw exports; never migrated in place.
- **SQLite** (`local.db`, Drizzle) — durable app state (auth, keys, overrides, saved configs). Migrated
  with `drizzle-kit`.

Hard boundary (ADR-0003): the **API opens DuckDB read-only**; a **separate ingest script owns the sole
read-write connection**. All DuckDB code is isolated in `@money/analytics` (ADR-0009). See `CLAUDE.md` for
the full rule set and `docs/decisions/` for the *why*.

## Project structure

```
apps/
  web/                React + TanStack Router SPA + PWA
  server/             Hono + oRPC (RPC /rpc, OpenAPI /api-reference, auth /api/auth/*)
packages/
  api/       @money/api        oRPC procedures / routers / context
  auth/      @money/auth       Better-Auth (email+password; single owner)
  db/        @money/db         Drizzle + libSQL (SQLite app state)
  analytics/ @money/analytics  ALL DuckDB code — read-only + /ingest read-write (boundary skeleton)
  shared/    @money/shared     framework-agnostic domain helpers/types (FY helpers so far)
  env/       @money/env        t3-env (/server, /web)
  ui/        @money/ui         shadcn primitives
  config/    @money/config     shared tsconfig base
scripts/ingest.ts    sole read-write DuckDB owner (stub)
data/raw/            immutable raw statement exports (gitignored)
docs/                decisions/ (ADRs), roadmap.md, superpowers/specs/
```

## Getting started

```bash
bun install
bun run dev            # web on :3001, server on :3000
```

App-state DB (SQLite):

```bash
bun run db:local       # optional local libSQL server
bun run db:push        # apply schema
```

Common scripts: `bun run check-types`, `bun run check` (Biome), `bun run ingest` (stub until the
data-layer phase), `bun run docker:up`. Full list in the root `package.json` and `CLAUDE.md`.

## Documentation

- **`CLAUDE.md`** — working agreement + the hard rules (read this before touching data).
- **`docs/decisions/`** — architecture decision records (ADR-0001 … 0010).
- **`docs/roadmap.md`** — phasing (data layer + ingest + dashboards → tax → calculators).
- **`docs/superpowers/specs/2026-07-18-money-bootstrap-design.md`** — this session's design spec.
- **`.claude/skills/money-analytics/SKILL.md`** — how to answer analytics questions from DuckDB.

## Open questions (need input before the relevant phase)

Real SBI export format · external API consumers/shapes · live-data sources (market NAV, tax slabs) ·
deploy specifics (homelab, tailnet) · secrets inventory · PWA offline scope. See `docs/roadmap.md`.

---

Scaffolded with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack)
(TanStack Router · Hono · oRPC · Drizzle · Better-Auth · Bun · Turborepo · Biome · PWA).
