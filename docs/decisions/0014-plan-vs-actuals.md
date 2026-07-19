# 0014 — Plan vs Actuals: the two-scene architecture

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

The app has two fundamentally different data sources with different trust, cadence, and purpose:

- The **bank statement** (SBI → DuckDB, ADR-0001/0013) — the authoritative record of what actually happened
  to cash. Noisy, lumpy, hard to attribute: amortising P2P payouts, salary rerouted from another account,
  self-transfers, sweep-FD shuffles.
- The owner's **knowledge of their own finances** — which investments they hold (terms, rates, maturities,
  payout cadences) and which expenses recur (rent, subscriptions). This is **not derivable** from the
  statement.

Deriving everything — including the freedom KPI — from the statement proved brittle on the first real
statement (see the ADR-0011 revision). The owner articulated the real model: keep the two apart.

## Decision

Model the domain as **two explicit scenes that stay separate**:

1. **Plan (expected)** — manually curated in **SQLite**: `investments` + `recurring_expenses`. Drives the
   coverage KPI (ADR-0011) and every "expected in / expected out" figure. Smooth, forward-looking, durable.
2. **Actuals (realised)** — the ingested statement in **DuckDB**. Drives **tax** and **budgeting** ("what
   actually came in / went out") and supplies realised figures (interest received, realised XIRR, spend by
   category). Rebuildable.

The two scenes meet only at a **reconciliation** layer — a *proposal* layer, never an automatic merge:

- Expected interest events generated from the Plan are matched against statement credits →
  `received | pending | missed`.
- Unmatched statement rows that look like interest or an investment are surfaced as **suggestions** to enrich
  the Plan ("looks like interest from X — add an investment?", "this outflow looks like a new SIP").
- Reconciliation never rewrites either scene automatically. It proposes; the owner decides.

## Consequences

- The dashboard is inherently **plan-vs-actual**: expected-in / actual-in, expected-out / actual-out, per
  month.
- Statement categorisation (former issue 001) is **retargeted** to tax/budgeting actuals + feeding
  reconciliation — not the KPI.
- The **Plan must be populated** before the KPI is meaningful. Bootstrapping helps: the statement *suggests*
  investments; `packages/info` (`subscriptions.json`, `recurring-payments.yaml`, `spending-profile.yaml`)
  *seeds* recurring expenses; the owner edits.
- Reinforces ADR-0001's store split with a clear semantic: **DuckDB = rebuildable actuals; SQLite = durable,
  owner-curated plan.** The `ATTACH` bridge (ADR-0004) is used at reconciliation time, read-only.
- ADR-0012 (kinds/splits/investment-linkage) still models statement postings, now in service of
  actuals/tax/reconciliation rather than the KPI.
