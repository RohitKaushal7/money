#!/usr/bin/env bun
/**
 * scripts/ingest.ts — the SOLE read-write owner of the analytical DuckDB (ADR-0003).
 *
 * The only place allowed to import `@money/analytics/ingest` / open DuckDB read-write. Run monthly or on
 * demand (`bun run ingest`). Reads immutable raw statement exports from `data/raw/` and rebuilds the
 * analytical DB (ADR-0002), sourcing rules/overrides/manual-splits from the SQLite app DB via `ATTACH`
 * (ADR-0004). The API never writes DuckDB — it spawns THIS script (see `packages/api/src/ingest-runner.ts`).
 *
 * Modes:
 *   (default)            full rebuild from `data/raw/*.csv`.
 *   --retag              re-derive categorisation from the current SQLite rules/overrides — no re-import.
 *   --dry-run <csvpath>  parse one CSV and report new/duplicate counts WITHOUT writing (import preview).
 *
 * Every run prints a machine-readable `[ingest:result] <json>` line as its LAST output so a caller
 * (the API runner) can parse the outcome without scraping the human logs.
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DUCKDB_RELATIVE_PATH,
	openReadOnly,
	RAW_DIR_RELATIVE_PATH,
} from "@money/analytics";
import { openReadWrite } from "@money/analytics/ingest";
import { dryRun, rebuild, retag } from "@money/analytics/rebuild";

/** Absolute path to the SQLite app DB (repo-root `local.db`) — DuckDB ATTACHes it for rules/overrides. */
const SQLITE_PATH = fileURLToPath(new URL("../local.db", import.meta.url));

const argv = process.argv.slice(2);
const RETAG_ONLY = argv.includes("--retag");
const dryRunIdx = argv.indexOf("--dry-run");
const DRY_RUN_PATH = dryRunIdx >= 0 ? argv[dryRunIdx + 1] : undefined;

/** Same resolution as `resolveDbPath`: env override, else the repo-relative default (resolved vs cwd). */
const DB_PATH = process.env.ANALYTICS_DB_PATH ?? DUCKDB_RELATIVE_PATH;

/** Emit the final machine-readable result line (parsed by the API ingest runner). */
function emit(result: Record<string, unknown>): void {
	console.log(`[ingest:result] ${JSON.stringify(result)}`);
}

/** Import preview: count new vs duplicate rows for one CSV against the live DB, writing nothing. */
async function dryRunMode(csvPath: string): Promise<void> {
	const file = { path: csvPath, name: "dry-run" };
	if (existsSync(DB_PATH)) {
		// Live DB present: read it read-only so a concurrent full ingest is never blocked.
		const reader = await openReadOnly();
		try {
			emit({ mode: "dryrun", ...(await dryRun(reader, file)) });
		} finally {
			await reader.close();
		}
		return;
	}
	// No DB yet: spin up a throwaway so read_csv can still count the file (every row is "new").
	const scratch = join(tmpdir(), `money-dryrun-${process.pid}.duckdb`);
	const writer = await openReadWrite({ dbPath: scratch });
	try {
		emit({ mode: "dryrun", ...(await dryRun(writer, file)) });
	} finally {
		await writer.close();
		rmSync(scratch, { force: true });
		rmSync(`${scratch}.wal`, { force: true });
	}
}

/** Report the current totals + uncategorised backlog after a write. */
async function totals(
	writer: Awaited<ReturnType<typeof openReadWrite>>,
): Promise<{ transactions: number; uncategorized: number }> {
	const [row] = await writer.query<{ n: number }>(
		"SELECT count(*) AS n FROM transactions",
	);
	const [uncat] = await writer.query<{ n: number }>(
		"SELECT count(*) AS n FROM transaction_splits WHERE category_key = 'uncategorized'",
	);
	return { transactions: row?.n ?? 0, uncategorized: uncat?.n ?? 0 };
}

async function main(): Promise<void> {
	if (DRY_RUN_PATH) {
		await dryRunMode(DRY_RUN_PATH);
		return;
	}

	// Defaults to DUCKDB_RELATIVE_PATH; ANALYTICS_DB_PATH can point it elsewhere (e.g. a throwaway test DB).
	const writer = await openReadWrite();
	try {
		if (RETAG_ONLY) {
			console.log(
				`[ingest] re-tagging ${DUCKDB_RELATIVE_PATH} from SQLite rules/overrides (no re-import)…`,
			);
			await retag(writer, SQLITE_PATH);
			const t = await totals(writer);
			console.log(
				`[ingest] done — ${t.transactions} transactions (${t.uncategorized} splits need categorising).`,
			);
			emit({ mode: "retag", ...t });
			return;
		}

		const files = readdirSync(RAW_DIR_RELATIVE_PATH)
			.filter((name) => name.toLowerCase().endsWith(".csv"))
			.sort()
			.map((name) => ({ path: `${RAW_DIR_RELATIVE_PATH}/${name}`, name }));
		if (files.length === 0) {
			console.log(
				`[ingest] no .csv files in ${RAW_DIR_RELATIVE_PATH}/ — drop your SBI statement export(s) there first.`,
			);
			emit({ mode: "rebuild", transactions: 0, uncategorized: 0, reports: [] });
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
		const t = await totals(writer);
		console.log(
			`[ingest] done — ${t.transactions} transactions (${t.uncategorized} splits need categorising).`,
		);
		emit({ mode: "rebuild", ...t, reports });
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
