/**
 * `@money/shared` — framework-agnostic domain helpers and types (ADR-0007).
 *
 * - `fy` — Indian financial-year calendar helpers.
 * - `kinds` — the split `Kind` + `CashflowType` axes (ADR-0012).
 * - `categories` — the seed category taxonomy.
 * - `types` — domain & API response types.
 * - `plan` — the plan-driven coverage KPI compute (ADR-0011 revised / ADR-0014).
 */

export * from "./categories";
export * from "./fy";
export * from "./kinds";
export * from "./plan";
export * from "./types";
