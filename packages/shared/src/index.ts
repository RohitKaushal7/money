/**
 * `@money/shared` — framework-agnostic domain helpers and types (ADR-0007).
 *
 * - `freedom` — when the portfolio becomes big enough to never run out (spec 2026-07-22).
 * - `fy` — Indian financial-year calendar helpers.
 * - `kinds` — the split `Kind` + `CashflowType` axes (ADR-0012).
 * - `categories` — the seed category taxonomy.
 * - `types` — domain & API response types.
 * - `coverage-history` — calendar rules for replaying the KPI month by month.
 * - `plan` — the plan-driven coverage KPI compute (ADR-0011 revised / ADR-0014).
 * - `networth` — the net-worth log series + per-step annualised growth (issue 003).
 * - `reconcile` — expected-vs-actual matching for the statement bridge (ADR-0014 / issue 008).
 * - `runway` — drawdown projection: how long the portfolio lasts if income stops (ADR-0016).
 * - `spending` — category spend trends vs plan budget (issue 009).
 * - `spending-insights` — the window summarised: typical month, rolling level, partial-month, YoY.
 * - `statements` — the generic CSV importer mapping contract (spec 2026-07-21).
 */

export * from "./axio";
export * from "./card-categories";
export * from "./cards";
export * from "./categories";
export * from "./category-colors";
export * from "./coverage-history";
export * from "./csv";
export * from "./currency";
export * from "./freedom";
export * from "./fy";
export * from "./kinds";
export * from "./networth";
export * from "./plan";
export * from "./reconcile";
export * from "./runway";
export * from "./spending";
export * from "./spending-insights";
export * from "./statements";
export * from "./tax";
export * from "./tax-reference";
export * from "./types";
