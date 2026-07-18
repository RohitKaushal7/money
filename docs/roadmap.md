# Roadmap

Phasing for the `money` app. The north-star KPI — **passive income ÷ monthly expenses, trending up** —
is the point of Phase 1; later phases are planning tools around it.

## Phase 0 — Bootstrap ✅ (2026-07-18)

Architecture, boundaries, and docs only (this session):

- Monorepo reconciled with the brief; ADRs `0001–0010`; `CLAUDE.md` hard rules.
- `@money/analytics` boundary skeleton (read-only vs `/ingest` read-write), `@money/shared` seeded with
  FY helpers, `scripts/ingest.ts` stub, `data/` layout, `money-analytics` skill skeleton.
- **No domain schema, no DuckDB runtime, no parser** — deferred by design.

## Phase 1 — Data layer + ingest + core dashboards

**1a. Feature brainstorming → domain/schema design** _(gate for everything below)_
- Brainstorm the features the owner actually wants, then agree a scalable schema.
- Design DuckDB business tables/views + persisted `networth_snapshots`; Drizzle `transaction_overrides`
  + `saved_configs`; domain types + category taxonomy in `@money/shared`.
- **Existing domain input:** `packages/info/` (gitignored, real data) already holds the owner's accounts,
  cards, portfolio, spending profile, subscriptions, and strategy notes — a strong starting point for the
  category taxonomy, reward mapping, holdings, and recurring-outgoings modelling.
- **Blocked on:** a real SBI statement export (exact columns/order) — `init.md` §6.

**1b. Wire the analytical layer**
- `bun add @duckdb/node-api` in `@money/analytics`; implement `openReadOnly()` / `openReadWrite()`.
- Author `sql/schema.sql` (+ any `sql/persist/*`) from the agreed schema.
- Generate + apply the Drizzle migration for the new SQLite tables.

**1c. Ingest + categorize**
- Build the SBI parser and the rules engine (description → category) in `scripts/ingest.ts`.
- Apply manual overrides via `ATTACH` (ADR-0004); make rebuilds idempotent (deterministic `txn_id`).

**1d. Core dashboards**
- Coverage ratio (headline) + trend; category summaries (old pivot); net worth over time + growth % +
  XIRR (old `logs`); "where is my money" (investments, passive-income sources, recurring outgoings,
  expense-vs-passive-income delta).
- Fill in the `money-analytics` skill's schema reference + canonical queries.

## Phase 2 — Tax (India)

- Old vs new regime comparison; deduction planning (80C / 80D / HRA / …); "how much more deduction to make
  old regime win."
- **Open:** tax-slab source — hardcoded tables vs a live source (`init.md` §6).

## Phase 3 — Calculators & rewards

- Monthly-vs-yearly payout, early insurance payout, FD calculators, withdrawal plans, loan-vs-investment.
- Credit-card reward mapping (best card per spend). Saved configs use `saved_configs`.

## Cross-cutting / open questions (`init.md` §6)

- External API consumers + endpoint shapes → OpenAPI surface & key scopes (also unblocks `api_keys`,
  ADR-0006/D4).
- Live-data sources: market NAV for stocks/MF (price API vs manual entry).
- Deploy specifics (homelab host, container, tailnet/domain); secrets inventory + location.
- PWA scope: which pages must work on mobile/offline.
- Auth: `api_keys` needs a Better-Auth version that ships the apiKey plugin, or a hand-rolled scheme.
