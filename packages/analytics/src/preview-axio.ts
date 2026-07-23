import { buildAxioSelect } from "./build-axio-select";
import { openConnection } from "./duckdb";

/**
 * Import-wizard preview for an Axio export (spec 2026-07-23). Parses the candidate CSV in a throwaway
 * in-memory DuckDB and reports totals + a sample — WITHOUT touching the user's DB (the API's read-only
 * boundary; this mirrors `previewStatement`). Any parse failure is returned as `{ ok: false, error }`.
 */

export interface PreviewAxioOk {
	ok: true;
	total: number;
	expenseSum: number;
	minDate: string | null;
	maxDate: string | null;
	rows: Record<string, unknown>[];
}
export type PreviewAxioResult = PreviewAxioOk | { ok: false; error: string };

export async function previewAxio(csvPath: string): Promise<PreviewAxioResult> {
	const select = buildAxioSelect(csvPath, "preview");
	const conn = await openConnection(":memory:", "read_write");
	try {
		const agg = await conn.query<{
			total: number;
			expense_sum: number;
			lo: string | null;
			hi: string | null;
		}>(
			`SELECT count(*) AS total,
				CAST(SUM(CASE WHEN is_expense THEN amount ELSE 0 END) AS DOUBLE) AS expense_sum,
				CAST(min(txn_date) AS VARCHAR) AS lo, CAST(max(txn_date) AS VARCHAR) AS hi
			FROM (${select})`,
		);
		const first = agg[0];
		const rows = await conn.query(
			`SELECT CAST(txn_date AS VARCHAR) AS date, place, amount, category, is_expense
			FROM (${select}) WHERE is_expense ORDER BY txn_date DESC LIMIT 10`,
		);
		return {
			ok: true,
			total: Number(first?.total ?? 0),
			expenseSum: Number(first?.expense_sum ?? 0),
			minDate: first?.lo ?? null,
			maxDate: first?.hi ?? null,
			rows,
		};
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		await conn.close();
	}
}
