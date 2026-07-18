/**
 * `@money/shared` — framework-agnostic domain helpers and types (ADR-0007).
 *
 * - `fy` — Indian financial-year calendar helpers.
 * - `kinds` — the split `Kind` + `CashflowType` axes (ADR-0012).
 * - `categories` — the seed category taxonomy.
 * - `types` — domain & API response types.
 */

export * from "./categories";
export * from "./fy";
export * from "./kinds";
export * from "./types";
