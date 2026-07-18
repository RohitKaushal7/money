# 0001 — Two data stores split by workload

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

The app has two very different data workloads:

1. **Analytical / read-heavy** — transactions, holdings, derived category summaries, net-worth-over-time,
   XIRR. These are large-ish, columnar-friendly, recomputed in bulk, and read constantly by dashboards
   and ad-hoc queries. They are rebuildable from source files.
2. **Transactional app state** — auth users/sessions, API keys, manual transaction overrides, saved
   calculator/dashboard configs. Small, frequently written from the UI, must be durable and mutable.

Serving both from one engine forces a compromise: DuckDB is columnar and single-writer; a general SQL
app-state store wants many small writes.

## Decision

Use **two stores split by workload**:

- **DuckDB** for the analytical/read-heavy data (transactions, holdings, derived views).
- **SQLite (via Drizzle)** for transactional app state (auth, keys, overrides, configs).

## Rationale

- DuckDB is columnar and optimised for analytical scans; it is a poor fit for many concurrent small
  writes, and its cross-process model is single-writer.
- SQLite handles the frequently-written app state cheaply, letting **DuckDB stay effectively read-only in
  the running app** (see ADR-0003).
- The two engines cooperate: DuckDB can `ATTACH` the SQLite file directly (see ADR-0004), so overrides
  edited live in SQLite feed the analytical rebuild without a sync job.

## Consequences

- Two connection styles in the codebase; contributors must know which store owns which data.
- A clean rule emerges: **derived/analytical → DuckDB; anything a user edits live → SQLite.**
- Cross-store joins happen at rebuild time via `ATTACH`, not at request time.
- Backups differ: SQLite is the durable app state to back up; DuckDB is rebuildable (ADR-0002).
