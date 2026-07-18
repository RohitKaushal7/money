import type { CoverageRatioPoint } from "@money/shared";
import { analyticsReady, withReader } from "../analytics";
import { publicProcedure } from "../index";

/**
 * Read-only analytics endpoints backing the dashboards. All open DuckDB read-only (ADR-0003).
 *
 * TODO(auth): these are `publicProcedure` for the first dashboard on localhost/tailnet. Before any
 * non-tailnet exposure they MUST become `protectedProcedure` — this is financial data (ADR-0006).
 */

interface CategoryRow {
	month: string;
	categoryKey: string;
	kind: string;
	amount: number;
	n: number;
}

interface TransactionRow {
	txnId: string;
	date: string;
	narration: string;
	amount: number;
	balance: number;
	kind: string | null;
	categoryKey: string | null;
}

export const analyticsRouter = {
	/** Whether an ingest has produced an analytical DB yet. */
	status: publicProcedure.handler(() => ({ ready: analyticsReady() })),

	/** Headline totals + the uncategorised backlog (the review signal). */
	summary: publicProcedure.handler(async () => {
		if (!analyticsReady()) {
			return {
				ready: false,
				transactions: 0,
				uncategorized: 0,
				months: [] as string[],
			};
		}
		return withReader(async (reader) => {
			const [txns] = await reader.query<{ n: number }>(
				"SELECT count(*) AS n FROM transactions",
			);
			const [uncat] = await reader.query<{ n: number }>(
				"SELECT count(*) AS n FROM transaction_splits WHERE category_key = 'uncategorized'",
			);
			const months = await reader.query<{ month: string }>(
				"SELECT DISTINCT month FROM transactions ORDER BY month",
			);
			return {
				ready: true,
				transactions: txns?.n ?? 0,
				uncategorized: uncat?.n ?? 0,
				months: months.map((m) => m.month),
			};
		});
	}),

	/** The north-star KPI per month (cash-basis; imputed drawdown wiring is later, ADR-0011). */
	coverageRatio: publicProcedure.handler(
		async (): Promise<CoverageRatioPoint[]> => {
			if (!analyticsReady()) return [];
			return withReader((reader) =>
				reader.query<CoverageRatioPoint>(
					`SELECT month,
					passive_income_cash AS "passiveIncomeCash",
					0 AS "imputedDrawdown",
					expenses,
					ratio
				FROM v_coverage_ratio`,
				),
			);
		},
	),

	/** Category × month × kind breakdown (the old pivot / "where's my money"). */
	categoryBreakdown: publicProcedure.handler(
		async (): Promise<CategoryRow[]> => {
			if (!analyticsReady()) return [];
			return withReader((reader) =>
				reader.query<CategoryRow>(
					`SELECT month, category_key AS "categoryKey", kind, amount, n
				FROM v_category_monthly ORDER BY month, kind, category_key`,
				),
			);
		},
	),

	/** Most recent transactions with their primary split's category/kind. */
	recentTransactions: publicProcedure.handler(
		async (): Promise<TransactionRow[]> => {
			if (!analyticsReady()) return [];
			return withReader((reader) =>
				reader.query<TransactionRow>(
					`SELECT t.txn_id AS "txnId", t.txn_date AS "date", t.narration, t.amount, t.balance,
					s.kind, s.category_key AS "categoryKey"
				FROM transactions t
				LEFT JOIN transaction_splits s ON s.txn_id = t.txn_id AND s.seq = 0
				ORDER BY t.txn_date DESC, t.balance DESC
				LIMIT 50`,
				),
			);
		},
	),
};
