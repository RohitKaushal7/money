#!/usr/bin/env bun
/**
 * scripts/ingest.ts — the SOLE read-write owner of the analytical DuckDB (ADR-0003).
 *
 * The only place allowed to import `@money/analytics/ingest` / open DuckDB read-write. The API never writes
 * DuckDB — it spawns THIS script (see `packages/api/src/ingest-runner.ts`). Operates on ONE user's private
 * files under `data/users/<uid>/` (ADR-0002); rules/overrides/manual-splits come from that user's `app.db`
 * via `ATTACH` (ADR-0004).
 *
 * Modes:
 *   (default)            full rebuild from the user's `raw/*.csv`.
 *   --retag              re-derive categorisation from the user's SQLite rules/overrides — no re-import.
 *   --dry-run <csvpath>  parse one CSV and report new/duplicate counts WITHOUT writing (import preview).
 *   --user <uid>         REQUIRED — selects data/users/<uid>/{analytics.duckdb, app.db, raw/}.
 *
 * Every run prints a machine-readable `[ingest:result] <json>` line as its LAST output so the API runner can
 * parse the outcome without scraping the human logs.
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	openReadOnly,
	userAppDbPath,
	userDuckdbPath,
	userRawDir,
} from "@money/analytics";
import { openReadWrite } from "@money/analytics/ingest";
import { dryRun, rebuild, retag } from "@money/analytics/rebuild";
import { env } from "@money/env/server";

const argv = process.argv.slice(2);
const RETAG_ONLY = argv.includes("--retag");
const dryRunIdx = argv.indexOf("--dry-run");
const DRY_RUN_PATH = dryRunIdx >= 0 ? argv[dryRunIdx + 1] : undefined;
const userIdx = argv.indexOf("--user");
const USER_ID = userIdx >= 0 ? argv[userIdx + 1] : undefined;
if (!USER_ID) {
	console.error("[ingest] --user <uid> is required");
	process.exit(1);
}

/** Per-user analytical DuckDB (this script is its sole read-write owner). */
const DB_PATH = userDuckdbPath(env.DATA_DIR, USER_ID);
/** Per-user SQLite app DB that DuckDB ATTACHes for rules/overrides/splits (ADR-0004). */
const SQLITE_PATH = userAppDbPath(env.DATA_DIR, USER_ID);
/** Per-user immutable raw statement dir. */
const RAW_DIR = userRawDir(env.DATA_DIR, USER_ID);

/** Emit the final machine-readable result line (parsed by the API ingest runner). */
function emit(result: Record<string, unknown>): void {
	console.log(`[ingest:result] ${JSON.stringify(result)}`);
}

/** Import preview: count new vs duplicate rows for one CSV against the user's live DB, writing nothing. */
async function dryRunMode(csvPath: string): Promise<void> {
	const file = { path: csvPath, name: "dry-run" };
	if (existsSync(DB_PATH)) {
		// Live DB present: read it read-only so a concurrent full ingest is never blocked.
		const reader = await openReadOnly({ dbPath: DB_PATH });
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

	const writer = await openReadWrite({ dbPath: DB_PATH });
	try {
		if (RETAG_ONLY) {
			console.log(
				`[ingest] re-tagging ${DB_PATH} from SQLite rules/overrides (no re-import)…`,
			);
			await retag(writer, SQLITE_PATH);
			const t = await totals(writer);
			console.log(
				`[ingest] done — ${t.transactions} transactions (${t.uncategorized} splits need categorising).`,
			);
			emit({ mode: "retag", ...t });
			return;
		}

		if (!existsSync(RAW_DIR)) {
			console.log(`[ingest] no raw dir ${RAW_DIR}/ yet — nothing to import.`);
			emit({ mode: "rebuild", transactions: 0, uncategorized: 0, reports: [] });
			return;
		}
		const files = readdirSync(RAW_DIR)
			.filter((name) => name.toLowerCase().endsWith(".csv"))
			.sort()
			.map((name) => ({ path: `${RAW_DIR}/${name}`, name }));
		if (files.length === 0) {
			console.log(
				`[ingest] no .csv files in ${RAW_DIR}/ — drop statement export(s) there first.`,
			);
			emit({ mode: "rebuild", transactions: 0, uncategorized: 0, reports: [] });
			return;
		}
		console.log(
			`[ingest] rebuilding ${DB_PATH} from ${files.length} raw file(s)…`,
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
