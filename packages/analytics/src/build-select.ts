/**
 * The generic statement parser (spec 2026-07-21 generic CSV importer). Builds the DuckDB SELECT that maps one
 * bank's clean CSV (`read_csv`, which handles quoted multi-line fields natively) to the `transactions`
 * columns, driven entirely by a `StatementMapping`. This replaces the hard-coded `sbiTransactionsSelect`;
 * SBI is now just the seeded mapping (`SBI_SEED_FORMAT`) fed through here.
 *
 * Idempotency key (ADR-0013, generalised): `txn_id = md5(account | date | amount | anchor | occ)` where the
 * anchor is the running `balance` (balance-anchored formats — SBI keeps its exact key) or
 * `coalesce(ref_no, narration)` (ref-anchored formats, with narration as the per-row fallback for blank refs).
 * `occ` disambiguates genuinely-identical postings within an anchor group.
 */

import type { StatementMapping, StatementQuirk } from "@money/shared";

/** SQL-escape a single-quoted string literal. */
function lit(value: string): string {
	return value.replace(/'/g, "''");
}

/** Quote a source-CSV column as a SQL identifier. */
function col(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

/** Named cleanup transforms a format opts into for messiness a plain column-map can't express. */
const QUIRKS: Record<StatementQuirk, (expr: string) => string> = {
	// SBI wraps the narration across physical lines with a `\n ` inserted mid-token: rejoin split words
	// (drop `\n `), drop any bare `\n`, collapse whitespace runs, trim. Matches the original NARRATION_EXPR.
	multiline_unwrap: (expr) =>
		`trim(regexp_replace(replace(replace(${expr}, chr(10) || ' ', ''), chr(10), ''), ' +', ' ', 'g'))`,
};

/** FY start year (Apr–Mar): month >= April → same year, else previous year. */
const FY_START_EXPR =
	"(CASE WHEN month(txn_date) >= 4 THEN year(txn_date) ELSE year(txn_date) - 1 END)";

export interface BuildSelectParams {
	csvPath: string;
	accountId: number;
	sourceFile: string;
	importBatchId: number;
}

/**
 * Build the SELECT mapping `read_csv` rows to the `transactions` columns for one format. Column order matches
 * the table so it can feed `INSERT INTO transactions BY NAME (...) ON CONFLICT DO NOTHING`.
 */
export function buildTransactionsSelect(
	mapping: StatementMapping,
	params: BuildSelectParams,
): string {
	const { accountId, importBatchId } = params;
	const path = lit(params.csvPath);
	const source = lit(params.sourceFile);

	// narration: raw column, wrapped by each opted-in quirk in order (SBI → multiline_unwrap).
	let narrationExpr = col(mapping.narrationCol);
	for (const quirk of mapping.quirks) {
		const fn = QUIRKS[quirk];
		if (fn) narrationExpr = fn(narrationExpr);
	}

	const refExpr = mapping.refCol
		? `NULLIF(${col(mapping.refCol)}, '')`
		: "NULL";
	const balanceExpr = mapping.balanceCol
		? `CAST(${col(mapping.balanceCol)} AS DECIMAL(18, 2))`
		: "NULL::DECIMAL(18, 2)";
	const valueDateExpr = mapping.valueDateCol
		? `strptime(${col(mapping.valueDateCol)}, '${lit(mapping.dateFmt)}')::DATE`
		: "NULL::DATE";

	// Per-mode amount inputs (in `raw`) and the derived signed `amount` + `debit`/`credit` (in `computed`).
	let rawAmountCols: string;
	let derivedAmountCols: string;
	switch (mapping.amountMode) {
		case "debit_credit": {
			rawAmountCols = `
		CAST(NULLIF(${col(mustCol(mapping.debitCol, "debitCol"))}, '') AS DECIMAL(18, 2)) AS debit,
		CAST(NULLIF(${col(mustCol(mapping.creditCol, "creditCol"))}, '') AS DECIMAL(18, 2)) AS credit,`;
			derivedAmountCols =
				"(COALESCE(credit, 0) - COALESCE(debit, 0)) AS amount,";
			break;
		}
		case "signed": {
			const signed = `CAST(NULLIF(${col(mustCol(mapping.amountCol, "amountCol"))}, '') AS DECIMAL(18, 2))`;
			const amount =
				mapping.signConvention === "debit_positive"
					? `(-1 * ${signed})`
					: signed;
			rawAmountCols = `\n		${amount} AS amount,`;
			derivedAmountCols =
				"CASE WHEN amount < 0 THEN -amount END AS debit, CASE WHEN amount > 0 THEN amount END AS credit,";
			break;
		}
		case "amount_indicator": {
			const mag = `CAST(NULLIF(${col(mustCol(mapping.amountCol, "amountCol"))}, '') AS DECIMAL(18, 2))`;
			const token = lit((mapping.creditToken ?? "").toLowerCase());
			const isCredit = `(lower(trim(${col(mustCol(mapping.indicatorCol, "indicatorCol"))})) = '${token}')`;
			rawAmountCols = `\n		CASE WHEN ${isCredit} THEN ${mag} ELSE -${mag} END AS amount,`;
			derivedAmountCols =
				"CASE WHEN amount < 0 THEN -amount END AS debit, CASE WHEN amount > 0 THEN amount END AS credit,";
			break;
		}
		default:
			throw new Error(`Unknown amount mode: ${mapping.amountMode as string}`);
	}

	// anchor for the idempotency key: running balance, or ref falling back to narration on blanks.
	const anchorExpr =
		mapping.anchor === "balance" ? "balance" : "COALESCE(ref_no, narration)";

	return `
WITH raw AS (
	SELECT
		strptime(${col(mapping.dateCol)}, '${lit(mapping.dateFmt)}')::DATE AS txn_date,
		${valueDateExpr} AS value_date,
		${narrationExpr} AS narration,
		${refExpr} AS ref_no,${rawAmountCols}
		${balanceExpr} AS balance
	FROM read_csv('${path}', header = true, all_varchar = true)
),
computed AS (
	SELECT
		*,
		${derivedAmountCols}
		${FY_START_EXPR} AS fy_start
	FROM raw
),
keyed AS (
	-- occurrence index disambiguates genuinely-identical postings within one anchor group; singleton
	-- groups get occ=0 (key unchanged), only real collisions get occ>0.
	SELECT
		*,
		${anchorExpr} AS anchor_value,
		(row_number() OVER (PARTITION BY txn_date, amount, ${anchorExpr} ORDER BY ${anchorExpr}) - 1) AS occ
	FROM computed
)
SELECT
	md5(${accountId} || '|' || txn_date || '|' || amount || '|' || anchor_value || '|' || occ) AS txn_id,
	${accountId} AS account_id,
	txn_date,
	value_date,
	narration,
	ref_no,
	debit,
	credit,
	amount,
	balance,
	'${source}' AS source_file,
	${importBatchId} AS import_batch_id,
	'FY' || fy_start || '-' || lpad(((fy_start + 1) % 100)::VARCHAR, 2, '0') AS fy,
	strftime(txn_date, '%Y-%m') AS month
FROM keyed`;
}

/** Guard: a required column for the active amount mode must be present (validation should catch this first). */
function mustCol(value: string | null | undefined, field: string): string {
	if (!value) throw new Error(`Mapping is missing required column "${field}".`);
	return value;
}
