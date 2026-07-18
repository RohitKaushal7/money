#!/usr/bin/env bun
/**
 * scripts/ingest.ts — the SOLE read-write owner of the analytical DuckDB (ADR-0003).
 *
 * The only place allowed to import `@money/analytics/ingest` / open DuckDB read-write. Run monthly or on
 * demand (`bun run ingest`). Reads immutable raw statement exports from `data/raw/` and rebuilds the
 * analytical DB (ADR-0002). The API never writes DuckDB.
 */

import { readdirSync } from "node:fs";
import { DUCKDB_RELATIVE_PATH, RAW_DIR_RELATIVE_PATH } from "@money/analytics";
import { openReadWrite } from "@money/analytics/ingest";
import { rebuild } from "@money/analytics/rebuild";

async function main(): Promise<void> {
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
	const writer = await openReadWrite({ dbPath: DUCKDB_RELATIVE_PATH });
	try {
		const reports = await rebuild(writer, { files });
		for (const r of reports) {
			console.log(
				`[ingest] ${r.sourceFile}: ${r.rowsNew} new, ${r.rowsDuplicate} duplicate (${r.rowsTotal} rows)`,
			);
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
