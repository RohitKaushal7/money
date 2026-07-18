# 0003 — Ingest script owns the sole read-write DuckDB connection; the API is read-only

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

DuckDB's cross-process concurrency model is **one read-write process OR many read-only processes**. In
this app, multiple readers want the analytical DB at once: the HTTP API, and the Claude Code CLI running
ad-hoc analytics (see the `money-analytics` skill). If the API held a read-write handle, those readers
would contend for a lock.

## Decision

- **Ingest is a separate script (`scripts/ingest.ts`) that holds the sole read-write DuckDB connection**,
  run monthly / on demand.
- **The API opens DuckDB read-only** (`access_mode: "read_only"`).
- The boundary is structural: `@money/analytics` (main entry) exposes only `openReadOnly()`; the
  read-write factory `openReadWrite()` lives behind a separate subpath `@money/analytics/ingest` that
  **only `scripts/ingest.ts` imports.**

> **HARD RULE for any agent or contributor:** never open the analytical DB read-write from the API
> process. If you need to write to DuckDB, you are in the ingest script or you are doing it wrong.

## Rationale

- Keeping the API read-only lets the API and the Claude Code CLI both read the DB concurrently without
  lock contention.
- A single writer (ingest) matches DuckDB's model and makes rebuilds atomic and predictable.
- Encoding the split as two package entry points (not just a comment) makes an accidental read-write open
  a visible, reviewable import of `/ingest`.

## Consequences

- Writes to analytical data happen only through a deliberate ingest run, never as a side effect of an API
  request.
- The API's DuckDB access is naturally cache-friendly and safe under concurrency.
- CI / review should flag any import of `@money/analytics/ingest` outside `scripts/`.
- This session ships both factories as stubs (no `@duckdb/node-api` yet); the boundary exists in code now
  and is wired in the data-layer phase.
