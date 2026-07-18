/**
 * SBI statement ingestion (parse via DuckDB `read_csv`, which handles the quoted, multi-line `Details`
 * field natively). This module only builds SQL; the ingest runner executes it against the RW connection.
 *
 * Statement shape: `Date,Details,Ref No/Cheque No,Debit,Credit,Balance` — date `DD/MM/YYYY`; Debit/Credit
 * separate columns (one blank per row); Balance is the running balance. The `Details` narration is wrapped
 * across physical lines with a `\n ` inserted mid-token, so we strip `\n ` (rejoining split words) before
 * collapsing whitespace.
 */

/** SQL-escape a single-quoted literal. */
function lit(value: string): string {
	return value.replace(/'/g, "''");
}

/** DuckDB expression that cleans the wrapped `Details` narration into a single tidy line. */
const NARRATION_EXPR = `trim(regexp_replace(replace(replace("Details", chr(10) || ' ', ''), chr(10), ''), ' +', ' ', 'g'))`;

/** FY start year (Apr–Mar): month >= April → same year, else previous year. */
const FY_START_EXPR =
	"(CASE WHEN month(txn_date) >= 4 THEN year(txn_date) ELSE year(txn_date) - 1 END)";

/**
 * Build the SELECT mapping SBI `read_csv` rows to the `transactions` columns (ADR-0013 idempotency key
 * `txn_id = md5(account|date|signed-amount|balance)` — narration excluded on purpose). Column order matches
 * the `transactions` table so it can feed `INSERT INTO transactions (...) SELECT ... ON CONFLICT DO NOTHING`.
 */
export function sbiTransactionsSelect(params: {
	csvPath: string;
	accountId: number;
	sourceFile: string;
	importBatchId: number;
}): string {
	const { accountId, importBatchId } = params;
	const path = lit(params.csvPath);
	const source = lit(params.sourceFile);
	return `
WITH raw AS (
	SELECT
		strptime("Date", '%d/%m/%Y')::DATE AS txn_date,
		${NARRATION_EXPR} AS narration,
		NULLIF("Ref No/Cheque No", '') AS ref_no,
		CAST(NULLIF("Debit", '') AS DECIMAL(18, 2)) AS debit,
		CAST(NULLIF("Credit", '') AS DECIMAL(18, 2)) AS credit,
		CAST("Balance" AS DECIMAL(18, 2)) AS balance
	FROM read_csv('${path}', header = true, all_varchar = true)
),
computed AS (
	SELECT
		*,
		(COALESCE(credit, 0) - COALESCE(debit, 0)) AS amount,
		${FY_START_EXPR} AS fy_start
	FROM raw
),
keyed AS (
	-- occurrence index disambiguates genuinely-identical postings (same date+amount+balance),
	-- e.g. two identical same-day SIP debits with a sweep-in resetting the balance between them.
	-- Singleton groups get occ=0 (key unchanged); only real collisions get occ>0.
	SELECT
		*,
		(row_number() OVER (PARTITION BY txn_date, amount, balance ORDER BY balance) - 1) AS occ
	FROM computed
)
SELECT
	md5(${accountId} || '|' || txn_date || '|' || amount || '|' || balance || '|' || occ) AS txn_id,
	${accountId} AS account_id,
	txn_date,
	NULL::DATE AS value_date,
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
