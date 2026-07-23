/**
 * CSV serialisation — the one place the app turns rows into CSV text (RFC 4180). Pure and framework-free:
 * @money/shared is imported by the browser, so no node:* here (string ops only).
 */

/** One output column: which row key to read, the header text, and an optional per-cell formatter. */
export interface CsvColumn<Row> {
	key: keyof Row & string;
	header: string;
	/** Map the raw cell value to a string before escaping. Defaults to the shared cell renderer. */
	format?: (value: Row[keyof Row & string], row: Row) => string;
}

const NEEDS_QUOTING = /[",\r\n]/;

/** Render one cell: null/undefined → "", everything else via String(). */
function defaultCell(value: unknown): string {
	if (value === null || value === undefined) return "";
	return String(value);
}

/** Escape one already-rendered cell per RFC 4180. */
function escapeCell(text: string): string {
	if (!NEEDS_QUOTING.test(text)) return text;
	return `"${text.replace(/"/g, '""')}"`;
}

/** Serialise `rows` to CSV using `columns` (order preserved). Header row + one line per row, CRLF-joined. */
export function toCsv<Row>(rows: Row[], columns: CsvColumn<Row>[]): string {
	const header = columns.map((c) => escapeCell(c.header)).join(",");
	const body = rows.map((row) =>
		columns
			.map((c) => {
				const raw = row[c.key];
				const rendered = c.format ? c.format(raw, row) : defaultCell(raw);
				return escapeCell(rendered);
			})
			.join(","),
	);
	return [header, ...body].join("\r\n");
}

/** Money cell: plain decimal, 2 dp, no separators or symbol. Blank for null/undefined/empty. */
export function csvAmount(value: unknown): string {
	if (value === null || value === undefined || value === "") return "";
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n.toFixed(2) : "";
}

// ── Transactions ─────────────────────────────────────────────────────────────
export interface TransactionCsvRow {
	date: string;
	narration: string;
	amount: number;
	balance: number;
	categoryLabel: string;
	kind: string;
}

export const TRANSACTION_CSV_COLUMNS: CsvColumn<TransactionCsvRow>[] = [
	{ key: "date", header: "date" },
	{ key: "narration", header: "narration" },
	{ key: "amount", header: "amount", format: csvAmount },
	{ key: "balance", header: "balance", format: csvAmount },
	{ key: "categoryLabel", header: "category" },
	{ key: "kind", header: "kind" },
];

// ── Investments ──────────────────────────────────────────────────────────────
export interface InvestmentCsvRow {
	name: string;
	type: string;
	incomeClass: string;
	platform: string | null;
	group: string | null;
	principal: number | null;
	currentValue: number | null;
	currency: string;
	annualRate: number | null;
	interestCadence: string | null;
	payout: string;
	startDate: string | null;
	maturityDate: string | null;
	status: string;
	isPassiveIncomeSource: boolean;
}

export const INVESTMENT_CSV_COLUMNS: CsvColumn<InvestmentCsvRow>[] = [
	{ key: "name", header: "name" },
	{ key: "type", header: "type" },
	{ key: "incomeClass", header: "income_class" },
	{ key: "platform", header: "platform" },
	{ key: "group", header: "group" },
	{ key: "principal", header: "principal", format: csvAmount },
	{ key: "currentValue", header: "current_value", format: csvAmount },
	{ key: "currency", header: "currency" },
	{ key: "annualRate", header: "annual_rate" },
	{ key: "interestCadence", header: "interest_cadence" },
	{ key: "payout", header: "payout" },
	{ key: "startDate", header: "start_date" },
	{ key: "maturityDate", header: "maturity_date" },
	{ key: "status", header: "status" },
	{ key: "isPassiveIncomeSource", header: "is_passive_income_source" },
];

// ── Recurring expenses ───────────────────────────────────────────────────────
export interface RecurringExpenseCsvRow {
	name: string;
	category: string | null;
	amount: number;
	currency: string;
	cadence: string;
	active: boolean;
	startDate: string | null;
	endDate: string | null;
}

export const RECURRING_EXPENSE_CSV_COLUMNS: CsvColumn<RecurringExpenseCsvRow>[] =
	[
		{ key: "name", header: "name" },
		{ key: "category", header: "category" },
		{ key: "amount", header: "amount", format: csvAmount },
		{ key: "currency", header: "currency" },
		{ key: "cadence", header: "cadence" },
		{ key: "active", header: "active" },
		{ key: "startDate", header: "start_date" },
		{ key: "endDate", header: "end_date" },
	];

// ── Spending by category ─────────────────────────────────────────────────────
export interface SpendingCsvRow {
	month: string;
	category: string;
	kind: string;
	amount: number;
	count: number;
}

export const SPENDING_CSV_COLUMNS: CsvColumn<SpendingCsvRow>[] = [
	{ key: "month", header: "month" },
	{ key: "category", header: "category" },
	{ key: "kind", header: "kind" },
	{ key: "amount", header: "amount", format: csvAmount },
	{ key: "count", header: "count" },
];

// ── Coverage history ─────────────────────────────────────────────────────────
export interface CoverageCsvRow {
	month: string;
	passiveIncome: number;
	expenses: number;
	ratio: number;
}

export const COVERAGE_CSV_COLUMNS: CsvColumn<CoverageCsvRow>[] = [
	{ key: "month", header: "month" },
	{ key: "passiveIncome", header: "passive_income", format: csvAmount },
	{ key: "expenses", header: "expenses", format: csvAmount },
	{ key: "ratio", header: "ratio" },
];
