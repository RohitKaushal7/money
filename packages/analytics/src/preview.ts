import { existsSync } from "node:fs";
import type { StatementMapping } from "@money/shared";
import { buildTransactionsSelect } from "./build-select";
import { openConnection } from "./duckdb";

/**
 * Import-wizard live preview (spec 2026-07-21). Parses a candidate CSV with a mapping and reports sample rows
 * + new/duplicate counts, WITHOUT writing the user's analytical DB. Runs in a throwaway in-memory DuckDB; the
 * user's DB, if it exists, is ATTACHed **READ-ONLY** purely to antijoin existing `txn_id`s for the duplicate
 * count. This is the API's read-only path — it never opens the user's file read-write (ADR-0003). Any parse
 * failure (bad date format, missing column) is returned as `{ ok: false, error }` so the wizard can surface it.
 */

export interface PreviewOk {
	ok: true;
	total: number;
	newRows: number;
	duplicate: number;
	rows: Record<string, unknown>[];
}
export type PreviewResult = PreviewOk | { ok: false; error: string };

export interface PreviewParams {
	/** Path to the user's analytical DuckDB (may not exist yet — then every row is "new"). */
	userDbPath: string;
	csvPath: string;
	mapping: StatementMapping;
	/** Account the rows would post to (part of txn_id); use a fresh/sentinel id for a to-be-created account. */
	accountId: number;
	sampleLimit?: number;
}

export async function previewStatement(
	params: PreviewParams,
): Promise<PreviewResult> {
	const sampleLimit = params.sampleLimit ?? 10;
	const select = buildTransactionsSelect(params.mapping, {
		csvPath: params.csvPath,
		accountId: params.accountId,
		sourceFile: "preview",
		importBatchId: 0,
	});
	const conn = await openConnection(":memory:", "read_write");
	try {
		const totalRows = await conn.query<{ n: number }>(
			`SELECT count(*) AS n FROM (${select})`,
		);
		const total = Number(totalRows[0]?.n ?? 0);
		const rows = await conn.query(
			`SELECT * FROM (${select}) ORDER BY txn_date LIMIT ${sampleLimit}`,
		);
		let duplicate = 0;
		if (existsSync(params.userDbPath)) {
			await conn.run(
				`ATTACH '${params.userDbPath.replace(/'/g, "''")}' AS live (READ_ONLY)`,
			);
			try {
				const dup = await conn.query<{ n: number }>(
					`SELECT count(*) AS n FROM (${select}) s WHERE s.txn_id IN (SELECT txn_id FROM live.transactions)`,
				);
				duplicate = Number(dup[0]?.n ?? 0);
			} catch {
				// live DB has no transactions table yet — every row is new.
				duplicate = 0;
			}
			await conn.run("DETACH live");
		}
		return { ok: true, total, newRows: total - duplicate, duplicate, rows };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		await conn.close();
	}
}
