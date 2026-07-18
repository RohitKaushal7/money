import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type AnalyticsReader, openReadOnly } from "@money/analytics";
import { env } from "@money/env/server";

/**
 * Read-only access to the analytical DuckDB from the API (ADR-0003). The API NEVER opens it read-write;
 * writes happen only through the ingest runner. A short-lived connection is opened per call so the ingest
 * process can acquire the single-writer lock between requests.
 */

/** Resolve the DuckDB path: `ANALYTICS_DB_PATH` env override, else `<repo-root>/data/analytics.duckdb`. */
function analyticsDbPath(): string {
	if (env.ANALYTICS_DB_PATH) return env.ANALYTICS_DB_PATH;
	// this file is packages/api/src/analytics.ts → repo root is three levels up
	return fileURLToPath(
		new URL("../../../data/analytics.duckdb", import.meta.url),
	);
}

/** Whether an analytical DB exists yet (i.e. `bun run ingest` has produced one). */
export function analyticsReady(): boolean {
	return existsSync(analyticsDbPath());
}

/** Open a read-only reader, run `fn`, and always close. Throws if no DB exists — guard with {@link analyticsReady}. */
export async function withReader<T>(
	fn: (reader: AnalyticsReader) => Promise<T>,
): Promise<T> {
	const reader = await openReadOnly({ dbPath: analyticsDbPath() });
	try {
		return await fn(reader);
	} finally {
		await reader.close();
	}
}
