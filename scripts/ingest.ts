#!/usr/bin/env bun
/**
 * scripts/ingest.ts — the SOLE read-write owner of the analytical DuckDB (ADR-0003).
 *
 * The only place allowed to import `@money/analytics/ingest` / open DuckDB read-write. Run monthly or on
 * demand (`bun run ingest`). Reads immutable raw statement exports from `data/raw/` and rebuilds the
 * analytical DB (ADR-0002), sourcing rules/overrides/manual-splits from the SQLite app DB via `ATTACH`
 * (ADR-0004). The API never writes DuckDB.
 *
 * `bun run ingest --retag` re-derives categorisation from the current SQLite rules/overrides WITHOUT
 * re-importing the raw CSVs — the cheap "I edited a rule, apply it" path.
 */

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DUCKDB_RELATIVE_PATH, RAW_DIR_RELATIVE_PATH } from "@money/analytics";
import { openReadWrite } from "@money/analytics/ingest";
import { rebuild, retag } from "@money/analytics/rebuild";

/** Absolute path to the SQLite app DB (repo-root `local.db`) — DuckDB ATTACHes it for rules/overrides. */
const SQLITE_PATH = fileURLToPath(new URL("../local.db", import.meta.url));
const RETAG_ONLY = process.argv.includes("--retag");

async function main(): Promise<void> {
	// Defaults to DUCKDB_RELATIVE_PATH; ANALYTICS_DB_PATH can point it elsewhere (e.g. a throwaway test DB).
	const writer = await openReadWrite();
	try {
		if (RETAG_ONLY) {
			console.log(
				`[ingest] re-tagging ${DUCKDB_RELATIVE_PATH} from SQLite rules/overrides (no re-import)…`,
			);
			await retag(writer, SQLITE_PATH);
		} else {
			const files = readdirSync(RAW_DIR_RELATIVE_PATH)
				.filter((name) => name.toLowerCase().endsWith(".csv"))
				.sort()
				.map((name) => ({ path: `${RAW_DIR_RELATIVE_PATH}/${name}`, name }));
			if (files.length === 0) {
				console.log(
					`[ingest] no .csv files in ${RAW_DIR_RELATIVE_PATH}/ — drop your SBI statement export(s) there first.`,
				);
				return;
			}
			console.log(
				`[ingest] rebuilding ${DUCKDB_RELATIVE_PATH} from ${files.length} raw file(s)…`,
			);
			const reports = await rebuild(writer, { files, sqlitePath: SQLITE_PATH });
			for (const r of reports) {
				console.log(
					`[ingest] ${r.sourceFile}: ${r.rowsNew} new, ${r.rowsDuplicate} duplicate (${r.rowsTotal} rows)`,
				);
			}
		}
		const [row] = await writer.query<{ n: number }>(
			"SELECT count(*) AS n FROM transactions",
		);
		const [uncat] = await writer.query<{ n: number }>(
			"SELECT count(*) AS n FROM transaction_splits WHERE category_key = 'uncategorized'",
		);
		console.log(
			`[ingest] done — ${row?.n ?? 0} transactions (${uncat?.n ?? 0} splits need categorising).`,
		);
	} finally {
		await writer.close();
	}
}

main().catch((error: unknown) => {
	console.error(
		`[ingest] failed: ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exit(1);
});
