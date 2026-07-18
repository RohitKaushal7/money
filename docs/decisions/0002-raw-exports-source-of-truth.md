# 0002 — Raw statement exports are the immutable source of truth

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

The old system was one Excel workbook per financial year, with transformation logic (Power Query) welded
to the data. When the toolchain broke, the data and the logic broke together. We want the durable truth
to be the bank's own export, independent of any code we write.

## Decision

**Raw statement exports (CSV/Parquet) stored as files under `data/` are the immutable source of truth.**
DuckDB tables are **rebuildable derived state** — never migrated in place. A schema or logic change means
**re-running the transform**, not an in-place migration of the analytical DB.

## Rationale

- Durability: the raw bank export is a stable, external format we don't control and won't corrupt.
- Always regenerable: any bug in categorisation or derivation is fixed by editing the transform and
  rebuilding — no risk of a half-migrated analytical DB.
- Auditability: we can always diff derived output against the untouched source.

## Consequences

- `data/raw/` holds the exports and is treated as append-only and immutable; the files are **gitignored**
  (they contain real financial data — never commit them).
- The DuckDB file (`data/analytics.duckdb`) is disposable/rebuildable and gitignored.
- Migrations apply to SQLite only (ADR-0008); DuckDB has no in-place migration story by design.
- A persisted exception exists for point-in-time facts that cannot be re-derived from current data
  (e.g. as-of net-worth snapshots) — handled with numbered SQL, see ADR-0008.
