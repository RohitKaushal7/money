# 0009 — `@duckdb/node-api` is the client, isolated in one package

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

We need a DuckDB client for Node/Bun. The older `duckdb` / `duckdb-node` package is deprecated. The
current client, `@duckdb/node-api`, is a **native N-API module**. Bun currently works with it, but native
bindings are the most likely thing to break on a runtime upgrade.

## Decision

- Use **`@duckdb/node-api`** as the DuckDB client.
- **Isolate all DuckDB-touching code in a single package (`@money/analytics`).** No other package imports
  the DuckDB client directly.

## Rationale

- One quarantined dependency: if a Bun upgrade breaks the native binding, only `@money/analytics` is
  affected, and it can be run on Node (e.g. the ingest script) without touching the rest of the app.
- A single seam for the read-only/read-write split (ADR-0003) and for all SQL access.
- Keeps the native module out of the browser bundle and out of unrelated packages.

## Consequences

- `packages/api`, `apps/web`, and scripts depend on `@money/analytics`'s exported functions, never on
  `@duckdb/node-api`.
- If the binding breaks under Bun, ingest and read paths can fall back to a Node runner while the rest of
  the stack stays on Bun.
- **This session** `@duckdb/node-api` is **not installed** (D2): `@money/analytics` ships the boundary as
  stubs with the real connection pattern documented. Installing the native dep and wiring it is the first
  task of the data-layer phase.
