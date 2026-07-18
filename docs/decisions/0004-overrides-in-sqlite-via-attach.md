# 0004 — Manual overrides/tags live in SQLite, joined into the DuckDB rebuild via ATTACH

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

Automatic categorisation (rules over transaction descriptions) will sometimes be wrong or undecidable, so
the owner needs to override a transaction's category from the UI. Those edits are small, frequent, live
writes — the opposite of DuckDB's strengths (ADR-0001) — and they must survive a full analytical rebuild
(ADR-0002), which wipes and recreates DuckDB tables.

## Decision

**Manual overrides/tags live in SQLite**, written live by the UI. The ingest rebuild reads them by having
DuckDB **`ATTACH` the SQLite file directly** and joining the overrides onto the derived transactions.

## Rationale

- Overrides are user-edited state → they belong in the mutable app-state store, not in rebuildable
  derived state.
- Because DuckDB tables are recreated on every rebuild, storing overrides *in* DuckDB would lose them;
  storing them in SQLite makes them durable and re-applied each rebuild.
- DuckDB reads the SQLite file directly via `ATTACH`, so there is **no sync job** — the rebuild joins the
  latest overrides at build time.
- Enabled by the scaffold: `DATABASE_URL=file:../../local.db` is a **plain SQLite file**, which DuckDB's
  SQLite reader can attach.

## Consequences

- The override key must be stable across rebuilds — overrides reference a **deterministic transaction id**
  (a hash of the source row), not a surrogate that changes each rebuild.
- The ingest script needs read access to the SQLite file path in addition to the DuckDB path.
- Concurrency: the libSQL client writes a standard SQLite-format file; `ATTACH` for read works when no
  writer holds the lock. For a single-user, on-demand ingest this is a non-issue; revisit if ingest ever
  runs while the app is under heavy write load.
- The concrete `transaction_overrides` table is part of the domain schema and is designed in the
  feature/schema session (deferred), not here.
