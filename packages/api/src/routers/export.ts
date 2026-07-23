import type { SqlParam } from "@money/analytics";
import { categories, investments, recurringExpenses } from "@money/db";
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

	investments: protectedProcedure.handler(async ({ context }) => {
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

	recurringExpenses: protectedProcedure.handler(async ({ context }) => {
		const exps = await context.appDb.select().from(recurringExpenses);
		const rows: RecurringExpenseCsvRow[] = exps.map((e) => ({
			name: e.name,
			category: e.category,
			amount: e.amount,
			currency: e.currency,
			cadence: e.cadence,
			active: e.active,
			startDate: e.startDate,
			endDate: e.endDate,
		}));
		return {
			csv: toCsv(rows, RECURRING_EXPENSE_CSV_COLUMNS),
			rows: rows.length,
		};
	}),

	spendingByCategory: protectedProcedure
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
