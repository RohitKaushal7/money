# @money/analytics

The **only** package that touches DuckDB (`@duckdb/node-api`) — ADR-0009. It isolates the analytical data
layer so a native-binding breakage is quarantined to one place, and it encodes the read-only/read-write
boundary (ADR-0003) as two separate entry points.

## Entry points

| Import | Exposes | Who imports it |
|--------|---------|----------------|
| `@money/analytics` | `openReadOnly()`, `AnalyticsReader`, path constants | `packages/api`, Claude CLI — **read-only** |
| `@money/analytics/ingest` | `openReadWrite()`, `AnalyticsWriter` | **only** `scripts/ingest.ts` — read-write |

> Importing `@money/analytics/ingest` outside `scripts/ingest.ts` is a bug. The API is read-only.

## Status: boundary skeleton

This session ships the boundary only. `@duckdb/node-api` is **not installed** (D2) and the `open*`
functions throw a "not wired yet" error. `sql/` is empty pending the schema-design session (D5).

Wiring it (data-layer phase, see `docs/roadmap.md`):

1. `bun add @duckdb/node-api` (in this package only).
2. Implement `openReadOnly()` / `openReadWrite()` with `DuckDBInstance.create(path, { access_mode })`.
3. Author `sql/schema.sql` (+ any `sql/persist/*`) from the agreed domain schema.
4. Build the rebuild transform used by `scripts/ingest.ts`.

## Read pattern

```ts
import { DuckDBInstance } from "@duckdb/node-api";
const instance = await DuckDBInstance.create(dbPath, { access_mode: "read_only" });
const connection = await instance.connect();
const reader = await connection.runAndReadAll("SELECT ...");
const rows = reader.getRowObjects();
```
