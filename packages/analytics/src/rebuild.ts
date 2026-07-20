import type { ImportReport, StatementMapping } from "@money/shared";
import { buildTransactionsSelect } from "./build-select";
import { type AnalyticsWriter, applySchema } from "./ingest";

/**
 * The DuckDB rebuild (ADR-0002): from raw statement files → derived tables + views. Called by the ingest
 * runner, which holds the sole read-write connection (ADR-0003).
 *
 * Rules, per-transaction overrides, and manual splits are sourced from the SQLite app DB, `ATTACH`ed
 * read-only (ADR-0004) — so categorisation is editable data, not code. {@link retag} re-derives splits from
 * them without re-importing the raw CSVs (the cheap "I edited a rule, apply it" path).
 */

export interface RebuildFile {
	/** path DuckDB read_csv can open */
	path: string;
	/** stored source_file label */
	name: string;
	/** the format's parsing contract (resolved per-file from the import_files binding). */
	mapping: StatementMapping;
	/** the account this file's rows post to (part of txn_id). */
	accountId: number;
}

/** Minimal read surface {@link count}/{@link dryRun} need — satisfied by both a reader and a writer. */
type Queryable = Pick<AnalyticsWriter, "query">;

function sqlStr(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

/**
 * (Re)seed the DuckDB `categories` table from the ATTACHed per-user `app.categories` (spec 2026-07-21 §6) —
 * categories are now user-owned, not a code constant. Requires {@link attachApp} to have run first. Idempotent
 * (DELETE + INSERT), so it also refreshes after in-app category edits on the cheap {@link retag} path.
 */
async function seedCategories(writer: AnalyticsWriter): Promise<void> {
	await writer.run("DELETE FROM categories");
	await writer.run(
		`INSERT INTO categories (key, label, kind, taxable, sort_order)
			SELECT key, label, kind, CAST(taxable AS BOOLEAN), sort_order FROM app.categories`,
	);
}

/**
 * `ATTACH` the SQLite app DB read-only (ADR-0004) as `app`, so the rebuild can read user-editable `rules`,
 * `transaction_overrides`, and `transaction_manual_splits`. The `sqlite` extension ships with DuckDB; INSTALL
 * is idempotent and tolerated-if-offline (the bundled extension still LOADs).
 */
async function attachApp(
	writer: AnalyticsWriter,
	sqlitePath: string,
): Promise<void> {
	try {
		await writer.run("INSTALL sqlite");
	} catch {
		// already present / offline with the bundled extension — LOAD below still succeeds
	}
	await writer.run("LOAD sqlite");
	await writer.run(
		`ATTACH ${sqlStr(sqlitePath)} AS app (TYPE sqlite, READ_ONLY)`,
	);
}

async function count(db: Queryable, sql: string): Promise<number> {
	const rows = await db.query<{ n: number }>(
		`SELECT count(*) AS n FROM ${sql}`,
	);
	return rows[0]?.n ?? 0;
}

/** Dry-run counts for a single pasted CSV (ADR-0013): how many rows are new vs already present. */
export interface DryRunReport {
	sourceFile: string;
	rowsTotal: number;
	rowsNew: number;
	rowsDuplicate: number;
	rowsConflict: number;
}

/**
 * Parse ONE CSV and report how many rows are new vs already imported — **without writing anything**
 * (the ADR-0013 import preview). Deliberately never calls {@link applySchema} (that `CREATE OR REPLACE`s
 * the tables and would wipe live data); if `transactions` doesn't exist yet, every row counts as new.
 * Accepts any {@link Queryable}, so the ingest runner can hand it a read-only connection on the live DB.
 *
 * `rowsConflict` is always 0: the idempotency key (ADR-0013) excludes narration, so a re-import can only
 * ever be a byte-identical duplicate, never a same-key-different-content conflict.
 */
export async function dryRun(
	db: Queryable,
	file: RebuildFile,
): Promise<DryRunReport> {
	const select = buildTransactionsSelect(file.mapping, {
		csvPath: file.path,
		accountId: file.accountId,
		sourceFile: file.name,
		importBatchId: 0,
	});
	const rowsTotal = await count(db, `(${select})`);
	const tables = await db.query<{ n: number }>(
		"SELECT count(*) AS n FROM information_schema.tables WHERE table_name = 'transactions'",
	);
	if ((tables[0]?.n ?? 0) === 0) {
		return {
			sourceFile: file.name,
			rowsTotal,
			rowsNew: rowsTotal,
			rowsDuplicate: 0,
			rowsConflict: 0,
		};
	}
	const rowsDuplicate = await count(
		db,
		`(${select}) s WHERE s.txn_id IN (SELECT txn_id FROM transactions)`,
	);
	return {
		sourceFile: file.name,
		rowsTotal,
		rowsNew: rowsTotal - rowsDuplicate,
		rowsDuplicate,
		rowsConflict: 0,
	};
}

async function loadFile(
	writer: AnalyticsWriter,
	file: RebuildFile,
	batchId: number,
): Promise<ImportReport> {
	const select = buildTransactionsSelect(file.mapping, {
		csvPath: file.path,
		accountId: file.accountId,
		sourceFile: file.name,
		importBatchId: batchId,
	});
	const total = await count(writer, `(${select})`);
	const before = await count(writer, "transactions");
	await writer.run(
		`INSERT INTO transactions BY NAME (${select}) ON CONFLICT DO NOTHING`,
	);
	const rowsNew = (await count(writer, "transactions")) - before;
	await writer.run(
		`INSERT INTO import_batches VALUES (${batchId}, ${sqlStr(file.name)}, now(), ${total}, ${rowsNew}, ${total - rowsNew}, 0, 'committed')`,
	);
	return {
		batchId: String(batchId),
		sourceFile: file.name,
		rowsTotal: total,
		rowsNew,
		rowsDuplicate: total - rowsNew,
		rowsConflict: 0,
		dryRun: false,
	};
}

/**
 * Derive splits from the ATTACHed app DB (ADR-0004):
 *  1. `app.transaction_manual_splits` REPLACE the default split for their txn (interest vs principal);
 *  2. every other txn gets one split from the best-matching **active**, amount-bounded `app.rules` row, then
 *     `app.transaction_overrides` pins its category/kind (kind falls back to the `categories` table when the
 *     override left it null). No match → uncategorized/transfer, so unknowns never inflate the KPI.
 * Deletes existing splits first, so it is safe to re-run standalone — this is the cheap {@link retag} path.
 */
async function buildSplits(writer: AnalyticsWriter): Promise<void> {
	await writer.run("DELETE FROM transaction_splits");
	await writer.run(`
		INSERT INTO transaction_splits (txn_id, seq, amount, kind, category_key, investment_id, cashflow_type)
		SELECT ms.txn_id, ms.seq, ms.amount, ms.kind, ms.category_key, ms.investment_id, ms.cashflow_type
		FROM app.transaction_manual_splits ms
		WHERE ms.txn_id IN (SELECT txn_id FROM transactions)
		UNION ALL
		SELECT t.txn_id, 0 AS seq, t.amount,
			COALESCE(o.override_kind, oc.kind, m.assign_kind, 'transfer') AS kind,
			COALESCE(o.override_category_key, m.assign_category_key, 'uncategorized') AS category_key,
			m.assign_investment_id, NULL AS cashflow_type
		FROM transactions t
		LEFT JOIN (
			SELECT txn_id, assign_kind, assign_category_key, assign_investment_id FROM (
				SELECT t2.txn_id, r.assign_kind, r.assign_category_key, r.assign_investment_id,
					row_number() OVER (PARTITION BY t2.txn_id ORDER BY r.priority ASC, r.id ASC) AS rnk
				FROM transactions t2
				JOIN app.rules r
					ON ((r.match_type = 'substring' AND t2.narration ILIKE '%' || r.pattern || '%')
						OR (r.match_type = 'regex' AND regexp_matches(t2.narration, r.pattern)))
					AND (r.min_amount IS NULL OR t2.amount >= r.min_amount)
					AND (r.max_amount IS NULL OR t2.amount <= r.max_amount)
					AND CAST(r.active AS INTEGER) = 1
			) WHERE rnk = 1
		) m ON m.txn_id = t.txn_id
		LEFT JOIN app.transaction_overrides o ON o.txn_id = t.txn_id
		LEFT JOIN categories oc ON oc.key = o.override_category_key
		WHERE t.txn_id NOT IN (SELECT txn_id FROM app.transaction_manual_splits)`);
}

/** Cash-basis KPI views (imputed drawdown + settings wiring come later; ADR-0011). */
async function createViews(writer: AnalyticsWriter): Promise<void> {
	await writer.run(`
		CREATE OR REPLACE VIEW v_monthly_kpi AS
		SELECT t.month,
			SUM(CASE WHEN s.kind = 'passive_income' THEN s.amount ELSE 0 END) AS passive_income_cash,
			SUM(CASE WHEN s.kind = 'expense' THEN -s.amount ELSE 0 END) AS expenses
		FROM transaction_splits s JOIN transactions t USING (txn_id)
		GROUP BY t.month`);
	await writer.run(`
		CREATE OR REPLACE VIEW v_coverage_ratio AS
		SELECT month, passive_income_cash, expenses,
			CASE WHEN expenses = 0 THEN NULL ELSE passive_income_cash / expenses END AS ratio
		FROM v_monthly_kpi ORDER BY month`);
	await writer.run(`
		CREATE OR REPLACE VIEW v_category_monthly AS
		SELECT t.month, s.category_key, s.kind, SUM(s.amount) AS amount, count(*) AS n
		FROM transaction_splits s JOIN transactions t USING (txn_id)
		GROUP BY t.month, s.category_key, s.kind`);
}

export interface RebuildOptions {
	/** Each file carries its own resolved mapping + account (from its import_files binding). */
	files: RebuildFile[];
	/** Absolute path to the SQLite app DB to ATTACH for rules/overrides/manual-splits (ADR-0004). */
	sqlitePath: string;
}

export async function rebuild(
	writer: AnalyticsWriter,
	options: RebuildOptions,
): Promise<ImportReport[]> {
	await applySchema(writer);
	await attachApp(writer, options.sqlitePath);
	await seedCategories(writer);
	const reports: ImportReport[] = [];
	let batchId = 1;
	for (const file of options.files) {
		reports.push(await loadFile(writer, file, batchId));
		batchId += 1;
	}
	await buildSplits(writer);
	await createViews(writer);
	return reports;
}

/**
 * The cheap **re-tag**: re-derive splits + KPI views from the transactions already in DuckDB and the current
 * ATTACHed app rules/overrides/splits — WITHOUT re-importing raw CSVs or touching the schema. For "I edited a
 * rule/override, apply it everywhere" — milliseconds, not a full rebuild. Requires a prior full ingest.
 */
export async function retag(
	writer: AnalyticsWriter,
	sqlitePath: string,
): Promise<void> {
	await attachApp(writer, sqlitePath);
	await seedCategories(writer); // refresh categories so in-app category edits apply on retag
	await buildSplits(writer);
	await createViews(writer);
}
