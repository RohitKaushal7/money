/**
 * `@money/analytics/ingest` — the **read-write** DuckDB factory + schema loader.
 *
 * ── HARD RULE ──────────────────────────────────────────────────────────────────────────────────────
 * This subpath is imported ONLY by `scripts/ingest.ts` (ADR-0003). An import of `@money/analytics/ingest`
 * from `packages/api` or `apps/*` is a bug. Flag it in review.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Only one read-write DuckDB process may exist at a time, so ingest holds the sole writer while the API
 * stays read-only.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	type DuckConnection,
	openConnection,
	resolveDbPath,
	type SqlParam,
} from "./duckdb";

/** Read-write handle onto the analytical DB. Extends the read-only surface with write execution. */
export interface AnalyticsWriter {
	query<T = Record<string, unknown>>(
		sql: string,
		params?: SqlParam[],
	): Promise<T[]>;
	run(sql: string, params?: SqlParam[]): Promise<void>;
	close(): Promise<void>;
}

export interface OpenReadWriteOptions {
	dbPath?: string;
}

/** Open the **sole** read-write connection to the analytical DB. Do not call this from the API. */
export async function openReadWrite(
	options: OpenReadWriteOptions = {},
): Promise<AnalyticsWriter> {
	const connection: DuckConnection = await openConnection(
		resolveDbPath(options.dbPath),
		"read_write",
	);
	return {
		query: connection.query,
		run: connection.run,
		close: connection.close,
	};
}

/** Absolute path to this package's `sql/` directory (resolved from source; ingest runs unbundled). */
const SQL_DIR = fileURLToPath(new URL("../sql/", import.meta.url));

/**
 * Apply the DuckDB schema: rebuildable tables (`schema.sql`, CREATE OR REPLACE) then persisted tables
 * (`persist/*.sql`, IF NOT EXISTS, applied in filename order). ATTACH-dependent views (`views.sql`) are
 * applied separately by the rebuild once the SQLite app DB is attached.
 */
export async function applySchema(writer: AnalyticsWriter): Promise<void> {
	await writer.run(readFileSync(`${SQL_DIR}schema.sql`, "utf8"));
	const persistDir = `${SQL_DIR}persist`;
	const persistFiles = readdirSync(persistDir)
		.filter((file) => file.endsWith(".sql"))
		.sort();
	for (const file of persistFiles) {
		await writer.run(readFileSync(`${persistDir}/${file}`, "utf8"));
	}
}
