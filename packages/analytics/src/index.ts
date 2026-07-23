/**
 * `@money/analytics` — the ONLY package that touches DuckDB / `@duckdb/node-api` (ADR-0009).
 *
 * This main entry exposes the **read-only** surface used by `packages/api` and the Claude CLI. The
 * read-write factory lives behind `@money/analytics/ingest` and is imported ONLY by `scripts/ingest.ts`
 * (ADR-0003).
 *
 * ── HARD RULE ──────────────────────────────────────────────────────────────────────────────────────
 * The API opens DuckDB READ-ONLY. Never read-write. If you need to write, you are in the ingest script.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────
 */

import {
	type DuckConnection,
	openConnection,
	resolveDbPath,
	type SqlParam,
} from "./duckdb";

// Re-export the parse/detection helpers so the root ingest script (which cannot resolve @money/shared
// directly — it is not hoisted to the root node_modules) can reach them via this package.
export {
	rowToStatementMapping,
	splitCsvHeader,
	statementHeaderSignature,
} from "@money/shared";
export { buildAxioSelect } from "./build-axio-select";
export type { BuildSelectParams } from "./build-select";
export { buildTransactionsSelect } from "./build-select";
export type { SqlParam } from "./duckdb";
export * from "./paths";
export type {
	PreviewParams,
	PreviewResult,
} from "./preview";
export { previewStatement } from "./preview";

/** Read-only handle onto the analytical DB. Exposes queries only — no write surface (ADR-0003). */
export interface AnalyticsReader {
	query<T = Record<string, unknown>>(
		sql: string,
		params?: SqlParam[],
	): Promise<T[]>;
	close(): Promise<void>;
}

export interface OpenReadOnlyOptions {
	/** Absolute (or cwd-relative) path to the DuckDB file. Defaults to `$ANALYTICS_DB_PATH` or `data/analytics.duckdb`. */
	dbPath?: string;
}

/**
 * Open a **read-only** connection to the analytical DB (`access_mode: "read_only"`). Safe to call from the
 * API and from multiple readers concurrently (ADR-0003). Remember to `close()` when done.
 */
export async function openReadOnly(
	options: OpenReadOnlyOptions = {},
): Promise<AnalyticsReader> {
	const connection: DuckConnection = await openConnection(
		resolveDbPath(options.dbPath),
		"read_only",
	);
	return { query: connection.query, close: connection.close };
}
