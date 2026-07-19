import { CATEGORIES, type ImportReport } from "@money/shared";
import { type AnalyticsWriter, applySchema } from "./ingest";
import { SEED_RULES } from "./rules";
import { sbiTransactionsSelect } from "./sbi";

/**
 * The DuckDB rebuild (ADR-0002): from raw statement files → derived tables + views. Called by the ingest
 * runner, which holds the sole read-write connection (ADR-0003).
 *
 * Current scope (Slice 3): categories seed, idempotent transaction load, rule-based default splits, and
 * the cash-basis coverage-ratio view. Still to wire: SQLite ATTACH for user rules/overrides/manual splits,
 * investment cashflows/valuations, imputed drawdown, and net-worth snapshots.
 */

export interface RebuildFile {
	/** path DuckDB read_csv can open */
	path: string;
	/** stored source_file label */
	name: string;
}

function sqlStr(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

async function seedCategories(writer: AnalyticsWriter): Promise<void> {
	const values = CATEGORIES.map(
		(c, i) =>
			`(${sqlStr(c.key)}, ${sqlStr(c.label)}, ${sqlStr(c.kind)}, ${c.taxable == null ? "NULL" : c.taxable}, ${i})`,
	).join(", ");
	await writer.run(`INSERT INTO categories VALUES ${values}`);
}

async function seedRules(writer: AnalyticsWriter): Promise<void> {
	await writer.run(
		`CREATE OR REPLACE TABLE _rules (priority INTEGER, match_type VARCHAR, pattern VARCHAR,
		 assign_kind VARCHAR, assign_category_key VARCHAR, assign_investment_id INTEGER,
		 min_amount DOUBLE, max_amount DOUBLE, rid INTEGER)`,
	);
	const values = SEED_RULES.map(
		(r, i) =>
			`(${r.priority}, ${sqlStr(r.matchType)}, ${sqlStr(r.pattern)}, ${sqlStr(r.kind)}, ${sqlStr(r.categoryKey)}, ${r.investmentId ?? "NULL"}, ${r.minAmount ?? "NULL"}, ${r.maxAmount ?? "NULL"}, ${i})`,
	).join(", ");
	await writer.run(`INSERT INTO _rules VALUES ${values}`);
}

async function count(writer: AnalyticsWriter, sql: string): Promise<number> {
	const rows = await writer.query<{ n: number }>(
		`SELECT count(*) AS n FROM ${sql}`,
	);
	return rows[0]?.n ?? 0;
}

async function loadFile(
	writer: AnalyticsWriter,
	file: RebuildFile,
	accountId: number,
	batchId: number,
): Promise<ImportReport> {
	const select = sbiTransactionsSelect({
		csvPath: file.path,
		accountId,
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

/** Default one split per transaction from the best-matching seed rule (uncategorized when none match). */
async function buildSplits(writer: AnalyticsWriter): Promise<void> {
	await writer.run(`
		INSERT INTO transaction_splits (txn_id, seq, amount, kind, category_key, investment_id, cashflow_type)
		WITH matched AS (
			SELECT t.txn_id,
				r.assign_kind, r.assign_category_key, r.assign_investment_id,
				row_number() OVER (PARTITION BY t.txn_id ORDER BY r.priority ASC, r.rid ASC) AS rnk
			FROM transactions t
			JOIN _rules r
				ON ((r.match_type = 'substring' AND t.narration ILIKE '%' || r.pattern || '%')
					OR (r.match_type = 'regex' AND regexp_matches(t.narration, r.pattern)))
				AND (r.min_amount IS NULL OR t.amount >= r.min_amount)
				AND (r.max_amount IS NULL OR t.amount <= r.max_amount)
		)
		SELECT t.txn_id, 0 AS seq, t.amount,
			COALESCE(m.assign_kind, 'transfer') AS kind,
			COALESCE(m.assign_category_key, 'uncategorized') AS category_key,
			m.assign_investment_id, NULL AS cashflow_type
		FROM transactions t
		LEFT JOIN matched m ON m.txn_id = t.txn_id AND m.rnk = 1`);
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
	files: RebuildFile[];
	accountId?: number;
}

export async function rebuild(
	writer: AnalyticsWriter,
	options: RebuildOptions,
): Promise<ImportReport[]> {
	const accountId = options.accountId ?? 1;
	await applySchema(writer);
	await seedCategories(writer);
	await seedRules(writer);
	const reports: ImportReport[] = [];
	let batchId = 1;
	for (const file of options.files) {
		reports.push(await loadFile(writer, file, accountId, batchId));
		batchId += 1;
	}
	await buildSplits(writer);
	await createViews(writer);
	return reports;
}
