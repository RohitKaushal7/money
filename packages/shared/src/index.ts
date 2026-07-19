/**
 * `@money/shared` — framework-agnostic domain helpers and types (ADR-0007).
 *
 * - `fy` — Indian financial-year calendar helpers.
 * - `kinds` — the split `Kind` + `CashflowType` axes (ADR-0012).
 * - `categories` — the seed category taxonomy.
 * - `types` — domain & API response types.
 * - `plan` — the plan-driven coverage KPI compute (ADR-0011 revised / ADR-0014).
 * - `networth` — the net-worth log series + per-step annualised growth (issue 003).
 * - `reconcile` — expected-vs-actual matching for the statement bridge (ADR-0014 / issue 008).
 * - `spending` — category spend trends vs plan budget (issue 009).
 */

export * from "./categories";
export * from "./currency";
export * from "./fy";
export * from "./kinds";
export * from "./networth";
export * from "./plan";
export * from "./reconcile";
export * from "./spending";
export * from "./tax";
export * from "./tax-reference";
export * from "./types";
