# 0011 — KPI: passive-income coverage ratio (plan-driven; expected interest ÷ expected recurring)

- **Status:** Accepted — **revised 2026-07-19** (supersedes the 2026-07-18 statement-split formulation)
- **Date:** 2026-07-18 (revised 2026-07-19)

## Context

The north star is "does passive income cover my recurring lifestyle costs, and is that trending up."

The **original** formulation (2026-07-18) computed the ratio from bank-statement splits:
`passive_income_cash` (transactions tagged `kind=passive_income`) ÷ tagged expenses. The first real SBI
statement disproved that basis. The statement's credits are dominated by **amortising P2P/NBFC payouts**
(principal + interest mixed, arriving as *separate*, lumpy transactions), **salary** (matched on the employer's payroll narration),
salary **rerouted** from another account, and **self-transfers**. Deriving the freedom KPI from that noise
makes it swing month-to-month, forces brittle principal-vs-interest attribution, and conflates one-off spend
with baseline lifestyle.

The owner's actual mental model is **two separate scenes** (ADR-0014): a **Plan** (manually-curated
investments + recurring expenses) and **Actuals** (the ingested statement). The coverage KPI belongs to the
Plan. The statement is for tax/budgeting + reconciliation, and never feeds the KPI.

## Decision

```
coverage_ratio =  Σ expected_monthly_interest(income investments)
                + [drawdown_enabled] × (drawdown_rate / 12) × Σ current_value(growth investments)
                  ─────────────────────────────────────────────────────────────────────────────
                            Σ expected_monthly_amount(recurring expenses)
```

- **Numerator term 1 — expected monthly interest** (per income investment) =
  `principal × annual_rate ÷ 12`, **or** an explicitly-entered `expected_monthly_interest` (for amortising
  instruments where `principal × rate ÷ 12` misstates it). Smooth and cadence-independent — the portfolio's
  steady-state *earning power*, not the month's actual receipts.
- **Numerator term 2 — imputed drawdown** on growth (non-yielding) investments: switchable
  (`drawdown_enabled`), adjustable rate (default `0.04`), stored in SQLite `settings`. Off ⇒ the numerator is
  pure interest. Imputed only on `income_class = growth` to avoid double-counting cash-yielding assets.
- **Denominator — expected recurring monthly expenses** = Σ over `recurring_expenses` of
  `amount × periods_per_year ÷ 12` (rent, subscriptions, insurance annual→monthly, committed recurring
  outflows). **One-off / irregular spend is deliberately excluded** — it lives in the budgeting/actuals view,
  not in "am I free yet."
- **Neither side reads the bank statement.** Interest *actually received* (from the statement) is tracked
  separately for reconciliation + tax and shown as a **secondary** line; it does not feed the KPI.

## Rationale

- This is the classic financial-independence definition: passive income vs baseline recurring cost. Smooth on
  both sides ⇒ a **stable trend you can actually watch climb**.
- Computing from the Plan removes dependence on de-noising the statement (amortising P2P principal-vs-interest,
  salary-vs-transfer), which real data proved brittle.
- Drawdown lets growth assets contribute a *sustainable* imputed income without pretending unrealised gains
  are cash — and the owner can toggle it or retune the rate to see both views.

## Consequences

- Requires the **Plan** in SQLite: `investments` (rate / expected-interest + `income_class` + current value)
  and `recurring_expenses` — both durable and user-curated.
- The KPI is computed with `settings` (drawdown toggle/rate) **injected**, not a hardcoded view.
- **Monthly snapshots** of the ratio are persisted so the trend is chartable — a *plan-state* snapshot,
  distinct from statement actuals.
- The statement pipeline (DuckDB) is **retargeted**: it produces tax/budgeting actuals + reconciliation, and
  no longer computes the KPI. The `v_coverage_ratio` DuckDB view (slice 3) is retired in favour of the
  plan-driven computation. ADR-0012's interest/principal split is downgraded from "load-bearing for the KPI"
  to "useful for tax + reconciliation."
- Secondary lenses (actual-received yield; different drawdown rates; total-return) are the same inputs viewed
  differently — cheap to expose later.
