# CLAUDE.md — working agreement for the `money` app

Self-hosted personal money-management app (single user, INR, Indian FY Apr 1 – Mar 31). **North-star KPI:**
what fraction of monthly expenses is covered by passive income, and is that ratio trending up. Everything
is instrumentation for that one number.

Read `docs/decisions/` (ADRs) for the *why* behind the rules below, and `docs/roadmap.md` for phasing.

Per-feature plans and specs live under `docs/superpowers/` and `.claude/plans/` on disk but are
**gitignored** — they are process artefacts, and they quote real balances and statement narrations. Never
commit them, and never copy figures out of them into anything that is committed.

## Architecture at a glance

Two data stores, split by workload (ADR-0001):

- **DuckDB** (`data/analytics.duckdb`) — analytical, read-heavy, **rebuildable** derived state
  (transactions, holdings, derived views). Rebuilt from raw exports; never migrated in place.
- **SQLite** (`local.db`, via Drizzle) — durable app state (auth, keys, overrides, saved configs).
  Migrated with `drizzle-kit`.

Monorepo (Bun workspaces + Turborepo):

```
apps/server    Hono + oRPC (RPC /rpc, OpenAPI /api-reference, auth /api/auth/*)
apps/web       TanStack Router SPA + PWA
packages/api        @money/api        oRPC procedures / routers / context
packages/auth       @money/auth       Better-Auth (email+password; single owner)
packages/db         @money/db         Drizzle + libSQL (SQLite app state)
packages/analytics  @money/analytics  ALL DuckDB code (read-only + /ingest read-write)  ← see hard rules
packages/shared     @money/shared     domain helpers/types (framework-agnostic)
packages/env        @money/env        t3-env (/server, /web)
packages/ui         @money/ui         shadcn primitives
packages/config     @money/config     shared tsconfig base
scripts/ingest.ts   sole read-write DuckDB owner (run monthly / on demand)
data/raw/           immutable raw statement exports (gitignored)
```

## HARD RULES — do not violate

1. **The API opens DuckDB READ-ONLY. Never read-write.** (ADR-0003) DuckDB allows one read-write process
   OR many read-only. The API and the Claude CLI are read-only readers. If you are writing to DuckDB, you
   are in `scripts/ingest.ts` or you are doing it wrong.
2. **Only `@money/analytics` touches DuckDB / `@duckdb/node-api`.** (ADR-0009) No other package imports the
   DuckDB client directly. Import `@money/analytics` for reads.
3. **`@money/analytics/ingest` (the read-write factory) is imported ONLY by `scripts/ingest.ts`.**
   (ADR-0003) An import of `/ingest` anywhere else is a bug — flag it.
4. **Raw statement exports under `data/raw/` are immutable and NEVER committed.** (ADR-0002) They contain
   real financial data. The DuckDB file is rebuildable and also gitignored.
5. **DuckDB is rebuilt, not migrated.** (ADR-0002/0008) A schema or logic change = edit the transform +
   re-run ingest. In-place DuckDB migration is not a thing here. Numbered SQL under
   `@money/analytics/sql/persist/` exists ONLY for point-in-time facts that can't be re-derived.
6. **SQLite is the only migrated store.** (ADR-0008) App-state schema changes go through Drizzle
   migrations (`bun run db:generate` → `db:migrate`).
7. **Single user.** (ADR-0010) No `owner_id`/`household_id` columns; public signup disabled. Don't add a
   user dimension speculatively.
8. **The domain/business schema is intentionally NOT designed yet.** (ADR-0010 / D5) DuckDB business
   tables, Drizzle business tables, domain types, and the category taxonomy come from a dedicated
   feature-brainstorming → schema session. Do not invent them ad hoc.

## Conventions

- **Runtime & PM:** Bun. Package manager `bun@1.4.0`. Shared deps via the root `workspaces.catalog`
  (reference as `"catalog:"`), not per-package version pins.
- **Packages** are named `@money/*` and export via `src/` (see each `package.json` `exports`).
- **Lint/format:** Biome — **tabs**, **double quotes**. Run `bun run check` (`biome check --write .`).
- **Types:** strict; shared base in `@money/config/tsconfig.base.json`. Run `bun run check-types`.
- **Env:** validated with t3-env in `@money/env` (`/server`, `/web`). Add new vars there, not ad hoc
  `process.env`. Server env lives in `apps/server/.env` (gitignored).
- **DuckDB read pattern (documented; wired in the data-layer phase):**
  `DuckDBInstance.create(path, { access_mode: "read_only" })` → `.connect()` → `runAndReadAll(sql)`.

## Run / dev / test

```bash
bun install            # install + link workspaces
bun run dev            # all apps (turbo)
bun run dev:server     # API only (http://localhost:3000)
bun run dev:web        # web only (http://localhost:3001)
bun run check-types    # tsc across the monorepo
bun run check          # Biome format + lint (writes)
bun run db:generate    # generate Drizzle migration from schema
bun run db:migrate     # apply SQLite migrations
bun run db:studio      # Drizzle studio
bun run ingest         # run the DuckDB ingest script (stub until the data-layer phase)
bun run docker:up      # build + start the container stack
```

There is no test runner wired yet. When tests arrive, prefer Bun's test runner and colocate.

## Git

- Commit only when asked. `main` is the default branch — branch before committing work.
- Never commit `data/raw/*`, `*.duckdb`, or `.env`.
