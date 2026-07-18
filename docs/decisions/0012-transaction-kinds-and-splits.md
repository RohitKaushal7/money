# 0012 — Ledger model: transaction kinds, splits, and orthogonal investment-linkage

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

The SBI ledger has to answer three questions at once: what is this flow for the KPI (income? expense?
transfer?), which investment (if any) does it feed for XIRR, and how do we handle a single bank credit
that is partly interest and partly returned principal. Cramming these into one "category" field forces
wrong compromises.

## Decision

Three orthogonal concepts:

1. **Kind** — every transaction split has exactly one of: `active_income`, `passive_income`, `expense`,
   `investment` (signed: contribution −, redemption/maturity +), `transfer`. This is the KPI/accounting
   role. KPI: numerator = `passive_income` (+ imputed drawdown), denominator = `expense`; `investment`
   and `transfer` excluded.
2. **Split/allocation** — a transaction decomposes into 1+ splits. Default = one split for the whole
   amount (assigned by the rules engine). Mixed payouts and split-bills get multiple splits. **Rules, the
   KPI, and XIRR read splits, never raw transactions.**
3. **Investment-linkage** — a split may carry `investment_id` + `cashflow_type`
   (`contribution|coupon|dividend|redemption|maturity`), independent of its kind. A bond coupon is
   `kind = passive_income` **and** a positive cashflow on that bond.

## Rationale

- Orthogonality keeps each axis clean: the KPI reads `kind`; XIRR reads investment-linked cashflows; a
  coupon is correctly both income and a cashflow with no special-casing.
- Splits are the standard, scalable way (YNAB/GnuCash/Actual) to represent a mixed payout — the guard that
  stops returned principal from being counted as passive income (ADR-0011).

## Consequences

- The rebuild computes `transaction_splits` as: default split from `rules` → replaced by
  `transaction_manual_splits` where present → category/kind adjusted by `transaction_overrides` (all
  ATTACH-joined from SQLite).
- `investment_cashflows` is derived from investment-linked splits; XIRR runs over it.
- Slightly more join complexity in every report, accepted for correctness and flexibility.
- Amortizing-bond payouts start as manual splits; schedule-based auto-split can auto-fill them later.
