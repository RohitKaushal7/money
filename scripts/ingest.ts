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

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	openReadOnly,
	rowToStatementMapping,
	splitCsvHeader,
	statementHeaderSignature,
	userAppDbPath,
	userDuckdbPath,
	userRawDir,
} from "@money/analytics";
import { openReadWrite } from "@money/analytics/ingest";
import {
	dryRun,
	type RebuildFile,
	rebuild,
	retag,
} from "@money/analytics/rebuild";
import { createAppDb } from "@money/db";
import { importFiles, statementFormats } from "@money/db/schema/app";
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

type FormatRow = typeof statementFormats.$inferSelect;

/**
 * Load this user's statement formats + per-file bindings from `app.db`. Each raw file is parsed with the
 * format its `import_files` row points to; unbound (legacy pre-backfill) files fall back to the SBI built-in,
 * since every historic raw file is an SBI export.
 */
async function loadFormatIndex(): Promise<{
	byId: Map<number, FormatRow>;
	bySignature: Map<string, FormatRow>;
	bindingByName: Map<string, number>;
	sbi: FormatRow | null;
}> {
	const db = createAppDb(`file:${SQLITE_PATH}`);
	const formats = await db.select().from(statementFormats);
	const bindings = await db.select().from(importFiles);
	return {
		byId: new Map(formats.map((f) => [f.id, f])),
		bySignature: new Map(formats.map((f) => [f.headerSignature, f])),
		bindingByName: new Map(bindings.map((b) => [b.filename, b.formatId])),
		sbi: formats.find((f) => f.builtin === "sbi") ?? null,
	};
}

/** The header signature of a CSV file's first line (for signature-based format detection). */
function fileHeaderSignature(path: string): string | null {
	try {
		const firstLine = readFileSync(path, "utf8").split(/\r?\n/, 1)[0] ?? "";
		return statementHeaderSignature(splitCsvHeader(firstLine));
	} catch {
		return null;
	}
}

/** Turn a resolved format row + raw file into a {@link RebuildFile} the engine can parse. */
function toRebuildFile(
	path: string,
	name: string,
	format: FormatRow,
): RebuildFile {
	return {
		path,
		name,
		mapping: rowToStatementMapping(format),
		accountId: format.accountId,
	};
}

/** Import preview: count new vs duplicate rows for one CSV against the user's live DB, writing nothing. */
async function dryRunMode(csvPath: string): Promise<void> {
	const index = await loadFormatIndex();
	const sig = fileHeaderSignature(csvPath);
	const format = (sig ? index.bySignature.get(sig) : undefined) ?? index.sbi;
	if (!format) {
		console.error(
			"[ingest] no statement format found (seed the SBI built-in).",
		);
		process.exit(1);
	}
	const file = toRebuildFile(csvPath, "dry-run", format);
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
): Promise<{
	transactions: number;
	uncategorized: number;
	axioExpenses: number;
}> {
	const [row] = await writer.query<{ n: number }>(
		"SELECT count(*) AS n FROM transactions",
	);
	const [uncat] = await writer.query<{ n: number }>(
		"SELECT count(*) AS n FROM transaction_splits WHERE category_key = 'uncategorized'",
	);
	let axioExpenses = 0;
	try {
		const [ax] = await writer.query<{ n: number }>(
			"SELECT count(*) AS n FROM axio_expenses",
		);
		axioExpenses = ax?.n ?? 0;
	} catch {
		axioExpenses = 0; // table absent on a retag-only DB built before this feature
	}
	return {
		transactions: row?.n ?? 0,
		uncategorized: uncat?.n ?? 0,
		axioExpenses,
	};
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
		const allCsv = readdirSync(RAW_DIR)
			.filter((name) => name.toLowerCase().endsWith(".csv"))
			.sort();
		// The Axio export is a SEPARATE ledger, not a bank statement — keep it out of the statement path.
		const axioName = allCsv.find((name) =>
			name.toLowerCase().startsWith("axio-"),
		);
		const names = allCsv.filter(
			(name) => !name.toLowerCase().startsWith("axio-"),
		);
		const axioFile = axioName
			? { path: `${RAW_DIR}/${axioName}`, name: axioName }
			: undefined;
		if (names.length === 0 && !axioFile) {
			console.log(
				`[ingest] no .csv files in ${RAW_DIR}/ — drop statement export(s) there first.`,
			);
			emit({ mode: "rebuild", transactions: 0, uncategorized: 0, reports: [] });
			return;
		}
		// Resolve each raw file to its format via the import_files binding; unbound → SBI fallback.
		const index = await loadFormatIndex();
		const files: RebuildFile[] = [];
		for (const name of names) {
			const path = `${RAW_DIR}/${name}`;
			const boundId = index.bindingByName.get(name);
			const format =
				(boundId ? index.byId.get(boundId) : undefined) ?? index.sbi;
			if (!format) {
				throw new Error(
					`No format for raw file "${name}" and no SBI built-in to fall back to — run backfill/seed first.`,
				);
			}
			if (!boundId) {
				console.log(
					`[ingest] ${name}: no format binding — using SBI fallback.`,
				);
			}
			files.push(toRebuildFile(path, name, format));
		}
		console.log(
			`[ingest] rebuilding ${DB_PATH} from ${files.length} raw file(s)…`,
		);
		const reports = await rebuild(writer, {
			files,
			sqlitePath: SQLITE_PATH,
			axioFile,
		});
		if (axioFile)
			console.log(`[ingest] loaded Axio ledger from ${axioFile.name}`);
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
