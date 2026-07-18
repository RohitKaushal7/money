# 0011 — KPI: passive-income coverage ratio (cash yield + switchable imputed drawdown)

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

The north star is "passive income fully covers expenses." The portfolio mixes cash-yielding assets
(bond coupons, FD/sweep interest, SustVest payouts) with growth assets (MF, stocks) that pay out nothing
until sold. A pure cash-basis numerator would show ~₹0 income from a growth-heavy portfolio; a pure
total-return numerator wouldn't reflect "cash that can actually pay the bills."

## Decision

```
coverage_ratio(month) = ( passive_income_cash + [imputed_drawdown if enabled] ) / expenses
```

- **`passive_income_cash`** = Σ transaction splits with `kind = passive_income` in the month. For a mixed
  payout, only the **interest** split counts; the principal split is `kind = investment` (ADR-0012).
- **`imputed_drawdown`** = `drawdown_enabled ? (drawdown_rate/12) × Σ current_value(income_class = growth)`
  `: 0`. A **switchable** setting with an **adjustable rate** (default 4%), stored in SQLite `settings`.
- **`expenses`** = Σ splits with `kind = expense`. `transfer` and `investment` kinds are excluded from both
  numerator and denominator.

## Rationale

- Cash yield is the honest "can passive income pay my expenses today" signal.
- The imputed-drawdown toggle lets growth assets contribute a *sustainable* imputed income (safe-withdrawal
  style) without pretending un-realized gains are cash — and the owner can turn it off or retune the rate
  to see both views.
- Imputing only on `growth` assets avoids double-counting the real payouts already captured from
  cash-yielding assets.

## Consequences

- Requires `investment_valuations` (current value per growth asset) and a live `settings` store — both
  drive the KPI, so it is computed with those parameters injected (not a hardcoded view).
- The principal-vs-interest split (ADR-0012) is load-bearing: mislabeling returned principal as interest
  would inflate the KPI.
- Secondary lenses (total-return; different drawdown rates) are just the same formula with different
  settings — cheap to expose later.
