# 0015 — Coverage ladder, investment grouping, payout tiers & auto-expiry

- **Status:** Accepted
- **Date:** 2026-07-19
- **Revises:** the single-number KPI of [0011](0011-kpi-coverage-ratio.md) (the switchable-drawdown numerator).

## Context

ADR-0011 made coverage plan-driven with one numerator: cash interest + a switchable growth drawdown. Working
with the owner's real portfolio (a spreadsheet: 12 SustVest tranches, 3 Wint bonds, 9 SBI FDs, PPF, equity,
MF, US, crypto) surfaced three needs the single number couldn't meet:

1. The owner thinks in **total expected return** (every holding's `value × XIRR`), and wants to see how "free"
   they are at several levels of realizability — not one number.
2. Holdings come in **groups** (SustVest, Wint, FDs) of many tranches, each with its own value/XIRR; they want
   a group rollup with a value-weighted rate, expandable to tranches.
3. Bonds/FDs **mature**; a matured holding should stop counting automatically.

The single global drawdown rate also couldn't represent per-asset expected returns (equity 12%, crypto 2%…).

## Decision

### Coverage is a three-tier ladder (nested)

```
cash-in-hand   =  Σ monthlyReturn(h)  for income holdings with payout = "cash"
+ fixed-income =  Σ monthlyReturn(h)  for all income holdings (cash + accruing)
+ total return =  Σ monthlyReturn(h)  for every holding (adds growth/equity at its own XIRR)
                  ─────────────────────────────────────────────────────────────────────────
                                Σ monthly recurring expenses
```

- `monthlyReturn(h)` = explicit `expectedMonthlyInterest`, else `value × annualRate ÷ 12`.
- `cash ⊆ fixed ⊆ total`. The UI shows all three; the **total** tier is the headline. The
  switchable-drawdown term (ADR-0011) is **retired** — growth now contributes its own expected return in the
  total tier, and realizability is expressed by the ladder rather than a toggle.
- A new per-holding **`payout`** flag (`cash` | `accrue`) decides cash-tier membership. `income_class`
  (`income` | `growth`) decides fixed-vs-total.

### Grouping

- A per-holding **`group`** label clusters tranches. Holdings sharing a group roll up under one header with a
  **value-weighted annual rate** (`Σ value×rate ÷ Σ value`) and summed monthly return, expandable to the
  individual tranches. Ungrouped holdings stand alone.

### Auto-expiry

- A holding is **matured** once flagged, or once its `maturityDate` is strictly before today (server clock).
  Matured holdings are excluded from live coverage and wealth, and surfaced as a `maturedValue` "awaiting
  redeploy" bucket. `today` is injected into the pure compute (never read inside it).

### Wealth rollup (the "how's my money" view)

Alongside coverage, a `wealthSummary` exposes: total live value, value-weighted **avg ROI**, **required ROI**
(= annual expenses ÷ wealth — the return needed to be free), naive **years-of-runway** (= wealth ÷ annual
expenses), grouped rollups, and the matured bucket. Rendered on a dedicated **Wealth** page (distribution
donut + metrics + grouped holding cards).

## Consequences

- Schema: `investments.group` + `investments.payout` (migrations 0002/0003). Compute lives in
  `@money/shared/plan` (`monthlyReturn`, `coverageLadder`, `wealthSummary`, `isMatured`/`isLive`) — pure,
  unit-tested. API: `plan.ladder` + `plan.wealth` (server passes `today`).
- ADR-0011's `coverage()`/drawdown functions remain in the code as a secondary lens but no longer back the
  headline; the UI ladder is authoritative.
- Per-asset expected returns replace the single drawdown rate; a holding counts at its own XIRR.
- Future: realised XIRR from actual cashflows (issue 003) is distinct from these *expected* rates; capital
  gains, FD/premium calculators, tax (the owner's other spreadsheet tabs) remain later modules.
