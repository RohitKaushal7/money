# 0008 — Migrations: Drizzle for SQLite; rebuildable transforms for DuckDB; no ORM over DuckDB

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

The two stores (ADR-0001) have opposite change models. SQLite holds durable app state that must evolve
in place without data loss. DuckDB holds rebuildable derived state (ADR-0002) that is cheaper to
regenerate than to migrate.

## Decision

- **SQLite:** schema changes go through **Drizzle migrations** (generated + applied via `drizzle-kit`).
- **DuckDB:** no ORM and no in-place migrations. Schema/logic changes are made by **editing the transform
  and re-running ingest** — the DuckDB file is dropped and rebuilt from the raw exports.
- **Plain numbered SQL** is used **only** for the rare DuckDB table that genuinely must persist across
  rebuilds (a point-in-time fact that cannot be re-derived from current data — e.g. as-of net-worth
  snapshots). Everything else is rebuilt.

## Rationale

- Migrating durable app state in place is the correct, well-supported path (Drizzle).
- Migrating rebuildable derived state is wasted effort and a source of half-migrated bugs — regenerating
  is simpler and always correct.
- Raw SQL over DuckDB keeps us on the columnar engine's real capabilities and avoids an ORM abstraction
  that would fight DuckDB's analytical model.

## Consequences

- Two mental models: "migrate" (SQLite) vs "rebuild" (DuckDB). CLAUDE.md states this as a hard rule.
- DuckDB DDL lives as SQL files in `@money/analytics` (rebuildable `schema.sql`; numbered `sql/persist/*`
  for the persisted exceptions) — authored in the schema session (deferred this session).
- A change to categorisation logic is a code change + a rebuild, never a data migration.
- The persisted-table escape hatch must be used sparingly and documented, so "rebuildable" stays the norm.
