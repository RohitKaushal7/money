/**
 * Parse an Axio (formerly Walnut) expense-report CSV into `axio_expenses` columns via DuckDB `read_csv`
 * (ADR-0009: only this package touches DuckDB). The export has a six-line preamble and a header on line 7,
 * then rows, then a `POWERED BY axio` footer and scattered blanks — so we skip to the header, read every
 * column as text, and keep only rows whose DATE parses. Amounts strip thousands separators.
 *
 * The `axio_id` expression MUST stay byte-identical to `axioRowId` (`./axio-id`) — a parity test pins them.
 */

/** SQL string literal (single-quote escaped). */
function lit(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

export function buildAxioSelect(csvPath: string, sourceFile: string): string {
	// Read every column as VARCHAR; skip the 6 preamble lines so line 7 is the header. ignore_errors +
	// null_padding tolerate the ragged footer/blank lines, which the guards below then drop. parallel=false
	// is REQUIRED: the export has quoted newlines (embedded in PLACE/NOTE), which DuckDB's parallel scanner
	// refuses to combine with null_padding.
	const readCsv = `read_csv(${lit(csvPath)}, skip=6, header=true, all_varchar=true, ignore_errors=true, null_padding=true, parallel=false)`;
	const amt = `CAST(replace("AMOUNT", ',', '') AS DOUBLE)`;
	// Every NOT-NULL column and every md5 component is COALESCE'd: the real export has rows with a blank
	// CATEGORY (and the odd blank ACCOUNT/DR-CR), and a NULL anywhere in the `||` chain would null the whole
	// id. Rows without a parseable DATE or AMOUNT are dropped (preamble/footer/blanks). Finally QUALIFY
	// de-dupes identical rows: the id excludes category, so two byte-identical spends collapse to one — the
	// PRIMARY KEY forbids both, and `INSERT … ON CONFLICT` cannot dedupe within a single command.
	return `
		SELECT * FROM (
			SELECT
				md5("DATE" || '|' || COALESCE("TIME", '') || '|' || printf('%.2f', ${amt})
					|| '|' || COALESCE("DR/CR", '') || '|' || COALESCE("ACCOUNT", '')
					|| '|' || COALESCE("PLACE", '')) AS axio_id,
				CAST("DATE" AS DATE) AS txn_date,
				"TIME" AS txn_time,
				COALESCE("PLACE", '') AS place,
				CAST(${amt} AS DECIMAL(18, 2)) AS amount,
				COALESCE("DR/CR", '') AS drcr,
				COALESCE("ACCOUNT", '') AS account,
				("EXPENSE" = 'Yes') AS is_expense,
				("INCOME" = 'Yes') AS is_income,
				COALESCE("CATEGORY", 'UNKNOWN') AS category,
				"TAGS" AS tags,
				"NOTE" AS note,
				strftime(CAST("DATE" AS DATE), '%Y-%m') AS month,
				${lit(sourceFile)} AS source_file
			FROM ${readCsv}
			WHERE try_cast("DATE" AS DATE) IS NOT NULL
				AND try_cast(replace("AMOUNT", ',', '') AS DOUBLE) IS NOT NULL
		) QUALIFY row_number() OVER (PARTITION BY axio_id) = 1`;
}
