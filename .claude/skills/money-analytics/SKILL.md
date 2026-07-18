---
name: money-analytics
description: Query the money app's DuckDB analytical database (read-only) to answer ad-hoc personal-finance questions — category summaries, net worth over time, XIRR, and the passive-income coverage ratio. Use when the user asks a data/analytics question about their transactions, holdings, income, or expenses.
---

# money-analytics

Answer ad-hoc analytics questions by querying the **DuckDB** analytical DB directly, **read-only**.

> **Status:** the domain **schema is not designed yet** (ADR-0010 / D5). This skill currently documents the
> connection pattern and domain vocabulary. The **schema reference and canonical queries below are
> placeholders** — fill them in after the feature/schema session, from `@money/analytics/sql/schema.sql`.

## Hard rules (do not violate)

- **Open DuckDB READ-ONLY. Never read-write.** (ADR-0003) Writes happen only through `bun run ingest`.
- **Go through `@money/analytics`.** Don't import `@duckdb/node-api` elsewhere (ADR-0009). Never import
  `@money/analytics/ingest` — that's the ingest-only read-write path.
- The DB file is `data/analytics.duckdb`, rebuildable from `data/raw/` — never migrate it in place.

## Read-only connection pattern

Via the package (preferred, once wired):

```ts
import { openReadOnly } from "@money/analytics";
const db = await openReadOnly();          // access_mode: "read_only"
const rows = await db.query("SELECT 1 AS ok");
await db.close();
```

Directly (what the package does under the hood):

```ts
import { DuckDBInstance } from "@duckdb/node-api";
const instance = await DuckDBInstance.create("data/analytics.duckdb", { access_mode: "read_only" });
const connection = await instance.connect();
const reader = await connection.runAndReadAll("SELECT ...");
const rows = reader.getRowObjects();
```

Ad-hoc from a shell (read-only), for quick checks:

```bash
duckdb -readonly data/analytics.duckdb "SELECT ...;"
```

## Domain concepts

- **Indian financial year (FY):** 1 Apr – 31 Mar. `FY2025-26` = 1 Apr 2025 … 31 Mar 2026. Use the helpers
  in `@money/shared` (`fyLabelForDate`, `fyBounds`, `fiscalYearStart`) rather than re-deriving. Currency
  is **INR**.
- **Coverage ratio (the north-star KPI):** monthly **passive income ÷ monthly expenses**. The whole app
  exists to push this toward ≥ 1 and to show whether it's trending up. Every analytics answer should be
  framable against it.
- **Passive income:** recurring income not from active work — bond/FD interest, investment payouts,
  dividends, savings interest (e.g. SustVest, Wint Wealth, SBI FDs, PPF). Distinct from salary.
- **Expenses:** outflows that are consumption, excluding transfers (e.g. credit-card *bill payment* is a
  transfer, not an expense — the underlying card spends are), investments, and sweeps.
- **XIRR:** money-weighted annualised return over irregular cashflows. Computed (TS, Newton's method) over
  an investment's cashflows: contributions negative, payouts/redemptions positive, plus current value as a
  final positive flow at "today". Reported per investment and lifetime across the hub account.

## Schema reference — PENDING (schema session)

_The tables/views (`transactions`, `categories`, `investments`, `investment_cashflows`,
`investment_valuations`, `subscriptions`, `networth_snapshots`, and derived views like `v_coverage_ratio`)
are designed in the feature/schema session. Document them here from `sql/schema.sql` once authored._

## Canonical example queries — PENDING (schema session)

_Add 5–8 here once the schema exists, e.g.: monthly coverage ratio + trend; category × month summary; net
worth over time with growth %; per-investment XIRR inputs; passive-income sources and monthly yield;
recurring subscriptions; expenses vs passive income delta._
