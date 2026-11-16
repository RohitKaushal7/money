import type { SqlParam } from "@money/analytics";
import { categories, investments } from "@money/db";
import {
	COVERAGE_CSV_COLUMNS,
	type CoverageCsvRow,
	INVESTMENT_CSV_COLUMNS,
	type InvestmentCsvRow,
	RECURRING_EXPENSE_CSV_COLUMNS,
	type RecurringExpenseCsvRow,
	SPENDING_CSV_COLUMNS,
	type SpendingCsvRow,
	TRANSACTION_CSV_COLUMNS,
	type TransactionCsvRow,
	toCsv,
} from "@money/shared";
import { z } from "zod";
import { analyticsReady, withReader } from "../analytics";
import { protectedProcedure } from "../index";
import { loadTxnOverlays } from "../load-txn-overlays";
import { enrichTransactions, type RawTxnRow } from "../transactions";
import { listRecurring } from "./plan";

/** Same filter shape as analytics.transactions, minus pagination. */
const txnFilter = z.object({
	month: z.string().optional(),
	kind: z.string().optional(),
	uncategorizedOnly: z.boolean().optional(),
	search: z.string().optional(),
	dateFrom: z.string().optional(),
	dateTo: z.string().optional(),
});

const monthRange = z.object({
	dateFrom: z.string().optional(),
	dateTo: z.string().optional(),
});

/** YYYY-MM bounds from YYYY-MM-DD, for filtering the month-keyed views. */
function monthWhere(input: { dateFrom?: string; dateTo?: string }): {
	sql: string;
	params: SqlParam[];
} {
	const where: string[] = [];
	const params: SqlParam[] = [];
	if (input.dateFrom) {
		where.push("month >= ?");
		params.push(input.dateFrom.slice(0, 7));
	}
	if (input.dateTo) {
		where.push("month <= ?");
		params.push(input.dateTo.slice(0, 7));
	}
	return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const EMPTY = { csv: "", rows: 0 };

/**
 * Read-only CSV exports (ADR-0003). Each procedure builds the full dataset server-side and returns it as a
 * string; the client turns it into a download. No new DuckDB reader — reads go through the existing
 * read-only withReader. The transactions export shares enrichTransactions with the list, so its category/kind
 * can never disagree with the on-screen table.
 */
export const exportRouter = {
	transactions: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"Export the owner's bank transactions as CSV text, newest first. Input (all optional): `month` (YYYY-MM), `kind` (active_income, passive_income, expense, investment or transfer), `uncategorizedOnly`, `search` (narration substring), `dateFrom`, `dateTo` (YYYY-MM-DD inclusive). No paging, so the whole match is returned; can be large. Returns `{ csv, rows }`, columns date, narration, amount (signed INR), balance, category label and kind, with the owner's current overrides applied. Empty csv when nothing is imported. Read-only: nothing is written or downloaded.",
			},
		})
		.input(txnFilter)
		.handler(async ({ context, input }) => {
			if (!analyticsReady(context.uid)) return EMPTY;
			const overlays = await loadTxnOverlays(context.appDb);
			return withReader(context.uid, async (reader) => {
				const where: string[] = [];
				const params: SqlParam[] = [];
				if (input.month) {
					where.push("t.month = ?");
					params.push(input.month);
				}
				if (input.kind) {
					where.push("s.kind = ?");
					params.push(input.kind);
				}
				if (input.uncategorizedOnly) {
					where.push(
						"(s.category_key = 'uncategorized' OR s.category_key IS NULL)",
					);
				}
				if (input.search) {
					where.push("t.narration ILIKE '%' || ? || '%'");
					params.push(input.search);
				}
				if (input.dateFrom) {
					where.push("t.txn_date >= ?");
					params.push(input.dateFrom);
				}
				if (input.dateTo) {
					where.push("t.txn_date <= ?");
					params.push(input.dateTo);
				}
				const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
				const raw = await reader.query<RawTxnRow>(
					`SELECT t.txn_id AS "txnId", CAST(t.txn_date AS VARCHAR) AS date, t.narration,
						t.amount, t.balance, s.category_key AS "categoryKey", s.kind
					FROM transactions t
					LEFT JOIN transaction_splits s ON s.txn_id = t.txn_id AND s.seq = 0
					${whereSql}
					ORDER BY t.txn_date DESC, t.balance DESC`,
					params,
				);
				const rows: TransactionCsvRow[] = enrichTransactions(raw, overlays).map(
					(e) => ({
						date: e.date,
						narration: e.narration,
						amount: e.amount,
						balance: e.balance,
						categoryLabel: e.categoryLabel,
						kind: e.kind,
					}),
				);
				return { csv: toCsv(rows, TRANSACTION_CSV_COLUMNS), rows: rows.length };
			});
		}),

	investments: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"Export all of the owner's holdings as CSV text. Takes no input. Returns `{ csv, rows }` with columns name, type, incomeClass, platform, group, principal (amount invested), currentValue (today's value), currency, annualRate (fraction, pre-tax: 0.1175 = 11.75%), interestCadence, payout, startDate, maturityDate, status, isPassiveIncomeSource. Amounts are in each row's currency. Read-only.",
			},
		})
		.handler(async ({ context }) => {
			const invs = await context.appDb.select().from(investments);
			const rows: InvestmentCsvRow[] = invs.map((i) => ({
				name: i.name,
				type: i.type,
				incomeClass: i.incomeClass,
				platform: i.platform,
				group: i.group,
				principal: i.principal,
				currentValue: i.currentValue,
				currency: i.currency,
				annualRate: i.annualRate,
				interestCadence: i.interestCadence,
				payout: i.payout,
				startDate: i.startDate,
				maturityDate: i.maturityDate,
				status: i.status,
				isPassiveIncomeSource: i.isPassiveIncomeSource,
			}));
			return { csv: toCsv(rows, INVESTMENT_CSV_COLUMNS), rows: rows.length };
		}),

	recurringExpenses: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"Export the owner's recurring expenses (the plan's budget) as CSV text. Takes no input. Returns `{ csv, rows }` with columns name, category, amount, currency, cadence, active, startDate, endDate, paidWith (what it is paid with, as the owner wrote it). Amounts are per cadence in each row's currency. Read-only.",
			},
		})
		.handler(async ({ context }) => {
			const exps = await listRecurring(context.appDb);
			const rows: RecurringExpenseCsvRow[] = exps.map((e) => ({
				name: e.name,
				category: e.category ?? null,
				amount: e.amount,
				currency: e.currency ?? "INR",
				cadence: e.cadence,
				active: e.active,
				startDate: e.startDate ?? null,
				endDate: e.endDate ?? null,
				paidWith: e.paidWith ?? null,
			}));
			return {
				csv: toCsv(rows, RECURRING_EXPENSE_CSV_COLUMNS),
				rows: rows.length,
			};
		}),

	spendingByCategory: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"Export monthly totals per category as CSV text from the baked bank-statement data. Input (optional): `dateFrom`, `dateTo` (YYYY-MM-DD; month granularity, inclusive). Returns `{ csv, rows }` with columns month, category (label), kind, amount (INR, signed sums), count. Empty when nothing is imported. Read-only.",
			},
		})
		.input(monthRange)
		.handler(async ({ context, input }) => {
			if (!analyticsReady(context.uid)) return EMPTY;
			const cats = await context.appDb
				.select({ key: categories.key, label: categories.label })
				.from(categories);
			const labelByKey = new Map(cats.map((c) => [c.key, c.label]));
			return withReader(context.uid, async (reader) => {
				const { sql, params } = monthWhere(input);
				const raw = await reader.query<{
					month: string;
					categoryKey: string;
					kind: string;
					amount: number;
					n: number;
				}>(
					`SELECT month, category_key AS "categoryKey", kind, amount, n
					FROM v_category_monthly ${sql} ORDER BY month, kind, category_key`,
					params,
				);
				const rows: SpendingCsvRow[] = raw.map((r) => ({
					month: r.month,
					category: labelByKey.get(r.categoryKey) ?? r.categoryKey,
					kind: r.kind,
					amount: r.amount,
					count: r.n,
				}));
				return { csv: toCsv(rows, SPENDING_CSV_COLUMNS), rows: rows.length };
			});
		}),

	coverageHistory: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"Export the monthly passive-income coverage of expenses as CSV text. Input (optional): `dateFrom`, `dateTo` (YYYY-MM-DD; month granularity, inclusive). Returns `{ csv, rows }` with columns month, passiveIncome (INR cash), expenses (INR), ratio (fraction of expenses covered; 0.5 = half). Empty when nothing is imported. Read-only.",
			},
		})
		.input(monthRange)
		.handler(async ({ context, input }) => {
			if (!analyticsReady(context.uid)) return EMPTY;
			return withReader(context.uid, async (reader) => {
				const { sql, params } = monthWhere(input);
				const rows = await reader.query<CoverageCsvRow>(
					`SELECT month, passive_income_cash AS "passiveIncome", expenses, ratio
					FROM v_coverage_ratio ${sql} ORDER BY month`,
					params,
				);
				return { csv: toCsv(rows, COVERAGE_CSV_COLUMNS), rows: rows.length };
			});
		}),
};
