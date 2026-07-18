#!/usr/bin/env bun
/**
 * scripts/ingest.ts — the SOLE read-write owner of the analytical DuckDB (ADR-0003).
 *
 * This is the only place allowed to import `@money/analytics/ingest` / open DuckDB read-write. Run it
 * monthly or on demand (`bun run ingest`). The API never writes to DuckDB.
 *
 * Status: **stub**. The schema and the SBI parser are designed in later sessions (D2/D5). Running this
 * today prints the intended pipeline and then exits, because `@duckdb/node-api` is not wired yet.
 */

import {
	DUCKDB_RELATIVE_PATH,
	RAW_DIR_RELATIVE_PATH,
	SQLITE_RELATIVE_PATH,
} from "@money/analytics";
import { openReadWrite } from "@money/analytics/ingest";

async function main(): Promise<void> {
	console.log("[ingest] money analytical rebuild");
	console.log(
		"[ingest] planned pipeline (data-layer phase — see docs/roadmap.md):",
	);
	console.log(
		`  1. read immutable raw statement exports from ${RAW_DIR_RELATIVE_PATH}/`,
	);
	console.log(
		`  2. open the SOLE read-write DuckDB connection at ${DUCKDB_RELATIVE_PATH}`,
	);
	console.log(
		"  3. drop & recreate derived tables from @money/analytics/sql/schema.sql",
	);
	console.log(
		`  4. ATTACH ${SQLITE_RELATIVE_PATH} and apply transaction overrides (ADR-0004)`,
	);
	console.log(
		"  5. append point-in-time facts to persisted tables (sql/persist/*)",
	);

	// Establishes the read-write boundary in code. Throws NOT_WIRED until the data-layer phase.
	const writer = await openReadWrite({ dbPath: DUCKDB_RELATIVE_PATH });
	await writer.close();
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[ingest] not run: ${message}`);
	process.exit(1);
});
