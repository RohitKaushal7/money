# ADR-0016 — Runway is modelled, not divided

**Status:** accepted · 2026-07-21
**Supersedes:** the `yearsLeft` field of `WealthSummary` (introduced with ADR-0015)

## Context

The Wealth page reported "Years of runway" as:

```ts
yearsLeft = totalValue / (monthlyExpenses * 12)
```

Two problems.

**It was a duplicate.** `requiredRoi = annualExpenses / totalValue` is that same fraction inverted. The
metrics grid showed 10.9% and 9.1 yr side by side: one fact wearing two costumes, presented as two
independent readings.

**It modelled a mattress.** The balance neither earned nor faced rising prices. Both omissions are large
and they point in opposite directions, so the error was invisible — the number looked plausible because
the two mistakes happened to cancel. Against a representative portfolio (₹50L, 7.9% blended, ₹60k/mo):

| model | runway |
| --- | --- |
| naive division | 9.2 yr |
| balance earns 7.9% | 16.4 yr |
| earns 7.9%, spending inflates 4% | 11.8 yr |
| earns 7.9%, spending inflates 6% | **10.5 yr** |
| earns 7.9%, spending inflates 8% | 9.7 yr |

Adding returns alone would have nearly doubled the headline. That is the tempting half-fix and it is a
lie by omission: ₹60k/mo of 2026 spending is not ₹60k/mo of 2042 spending. Shipping both terms lands at
10.5 yr — close to the old number, but for reasons that survive a change in either input.

## Decision

Runway is a projection, in `@money/shared/runway`:

```
balance = balance * (1 + annualReturn / 12) - spend   // monthly
spend  *= (1 + inflation)                             // every 12th month
```

- **Both forces are optional and default on.** A disabled force is passed as `0`, so the naive figure is
  not a special case in the code — it is the same arithmetic with both terms zeroed, pinned by a test that
  asserts exact equality with `totalValue / annualExpenses`.
- **Never-depletes returns `null`, not a large number.** When the return outpaces spending plus inflation
  the balance grows forever. That is the same fact as coverage ≥ 1.0× (ADR-0011/0015), drawn as a curve
  instead of a ratio, and a projection is capped at 40 years rather than run to a false horizon.
- **The final month is interpolated.** Depletion lands at the fraction of the month the balance covers, so
  the answer is continuous in the inputs rather than stepping a month at a time.
- **The assumptions live on the client.** They are view state, not financial record: nothing here belongs
  in the per-user SQLite, and reading them must not need a round trip. They persist to `localStorage`
  through `apps/web/src/lib/preferences.ts`, whose `DEFAULTS` object is the single registry — the default
  is both the fallback and the type, so the two cannot drift.
- **The chart and the metric card share the preference hook**, so they cannot report different years.

`WealthSummary.yearsLeft` is removed rather than deprecated. Leaving a naive field beside the model that
supersedes it is an invitation to use the wrong one, and nothing is lost: zeroing both terms recovers it.

## Consequences

- The wealth payload no longer carries `yearsLeft`. No API shape depends on it (single user, ADR-0010).
- Runway is tax-aware for free: `plan.wealth` already applies `netIncomeOfTax` server-side, so the blended
  return feeding the projection follows the post-tax chip.
- Runway ignores maturities. The blended rate is a single portfolio-wide number, so an FD maturing in two
  years keeps earning in the model. Per-holding drawdown would need a redeployment policy and a withdrawal
  order, neither of which the plan schema expresses. Deliberately deferred.
- Contributions are ignored by construction. Runway asks what happens if the income stops — adding savings
  would answer a different question.
