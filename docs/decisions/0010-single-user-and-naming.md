# 0010 — Single-user for now; scaffold naming reconciliation; deferrals

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

`init.md` describes a single-user app ("possibly family later"). The repo was scaffolded from
`better-t-stack`, whose package layout differs from the conceptual names in the brief. This ADR records
the decisions taken in the 2026-07-18 bootstrapping session that aren't captured by ADRs 0001–0009.
See `docs/superpowers/specs/2026-07-18-money-bootstrap-design.md` for the full session spec.

## Decision

**D1 — Single-user, rebuild-later.** No `owner_id`/`household_id` column in any DuckDB or app-state table.
Public signup is disabled; one owner account. If family is added later: DuckDB tables are rebuildable
derived state (ADR-0002), so they re-derive with the new dimension for free; app-state takes a standard
additive Drizzle migration (ADR-0008). We do **not** pre-thread a user dimension now (YAGNI).

**Naming reconciliation.** Keep the scaffold's names; map the brief's concepts onto them (no renames):
`init.md` `api` → `apps/server`; `web` → `apps/web`; oRPC layer → `packages/api` (`@money/api`);
SQLite+Drizzle → `packages/db` (`@money/db`); shared-types → new `packages/shared` (`@money/shared`,
ADR-0007); analytics/data-layer → new `packages/analytics` (`@money/analytics`, ADR-0009).

**D4 — `api_keys` deferred.** `better-auth@1.6.23` (pinned) ships no apiKey plugin, so it cannot be
enabled. Documented as future work (ADR-0006); not created this session.

**D5 — Business/domain schema deferred.** The domain model (DuckDB business tables/views, Drizzle
business tables, domain types, category taxonomy) is **not designed this session**. It gets its own
feature-brainstorming session first, then a scalable schema is agreed. This session ships architecture,
boundaries, and docs only.

## Rationale

- The rebuildable-transform architecture makes "family later" cheap, so adding a user dimension now would
  be speculative complexity threaded through every query.
- Renaming a working `better-t-stack` scaffold would churn many files for no benefit; a mapping table is
  enough.
- Designing the schema before the feature set is known risks an unscalable model; deferring keeps the
  first schema honest.

## Consequences

- Auth allows exactly one owner; no registration flow.
- Every query and SKILL example stays single-user-simple.
- The feature/schema session is the gate for all domain tables, types, and the category taxonomy; until
  then, `@money/shared` carries only calendar helpers (`fy.ts`) and `@money/analytics` carries only the
  read-only/read-write boundary stubs.
