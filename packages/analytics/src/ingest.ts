/**
 * `@money/analytics/ingest` — the **read-write** DuckDB factory.
 *
 * ── HARD RULE ──────────────────────────────────────────────────────────────────────────────────────
 * This subpath is imported ONLY by `scripts/ingest.ts` (ADR-0003). An import of `@money/analytics/ingest`
 * from anywhere else — especially `packages/api` or `apps/*` — is a bug. Flag it in review.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Only one read-write DuckDB process may exist at a time, so ingest holds the sole writer while the API
 * stays read-only. Status: **stub** — `@duckdb/node-api` is not installed yet (D2). The intended
 * implementation opens with `access_mode: "read_write"` (the default), rebuilds derived tables from the
 * raw exports, and `ATTACH`es the SQLite file to apply overrides (ADR-0004).
 */

import type { AnalyticsReader } from "./index";

const NOT_WIRED =
	"DuckDB ingest not wired yet — @money/analytics/ingest is a stub this session. " +
	"See docs/roadmap.md (data-layer phase) and docs/decisions/0003-ingest-owns-readwrite.md.";

/** Read-write handle onto the analytical DB. Extends the read-only surface with write execution. */
export interface AnalyticsWriter extends AnalyticsReader {
	/** Execute a statement that does not return rows (DDL, INSERT, ATTACH, ...). */
	run(sql: string, params?: unknown[]): Promise<void>;
}

export interface OpenReadWriteOptions {
	/** Absolute path to the DuckDB file. Defaults to `DUCKDB_RELATIVE_PATH` resolved against the repo root. */
	dbPath?: string;
}

/**
 * Open the **sole** read-write connection to the analytical DB. Do not call this from the API.
 *
 * @throws until the data-layer phase installs `@duckdb/node-api` and implements this.
 */
export function openReadWrite(
	_options: OpenReadWriteOptions = {},
): Promise<AnalyticsWriter> {
	return Promise.reject(new Error(NOT_WIRED));
}
