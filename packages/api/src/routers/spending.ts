import { type SpendingRow, spendingTrends } from "@money/shared";
import { z } from "zod";
import { analyticsReady, withReader } from "../analytics";
import { publicProcedure } from "../index";
import { listRecurring } from "./plan";

/**
 * The **spending** router (issue 009) — the "where's it going, is it creeping" lens. Reads the categorised
 * expense actuals (DuckDB `v_category_monthly`, read-only) and the plan's recurring budget (SQLite, via
 * {@link listRecurring}), then runs the pure {@link spendingTrends} compute. Read-only over both stores.
 *
 * Actuals here read raw, matching the Overview money-map. Manual overrides (issue 001) become consistent
 * across every view once they're baked into the DuckDB rebuild via `ATTACH` (issue 001 Step 2).
 *
 * TODO(auth): `publicProcedure` for the localhost/tailnet dashboard. MUST become `protectedProcedure`
 * before any non-tailnet exposure — this reads financial data (ADR-0006).
 */

/** Expense category × month magnitudes from the analytical DB (read-only). */
async function expenseRows(): Promise<SpendingRow[]> {
	return withReader((reader) =>
		reader.query<SpendingRow>(
			`SELECT month, category_key AS "categoryKey", kind, amount, n
			FROM v_category_monthly
			WHERE kind = 'expense'
			ORDER BY month`,
		),
	);
}

interface CategoryTxn {
	txnId: string;
	date: string;
	narration: string;
	amount: number;
	month: string;
}

export const spendingRouter = {
	/** Category spend trends vs plan budget: movers table + totals + budgeted-but-unspent footnote. */
	overview: publicProcedure.handler(async () => {
		const rows = analyticsReady() ? await expenseRows() : [];
		const recurring = await listRecurring();
		return spendingTrends({ rows, recurring });
	}),

	/** Drill-in: the individual expense transactions filed under one category (newest first). */
	categoryTransactions: publicProcedure
		.input(z.object({ categoryKey: z.string().min(1) }))
		.handler(async ({ input }): Promise<CategoryTxn[]> => {
			if (!analyticsReady()) return [];
			return withReader((reader) =>
				reader.query<CategoryTxn>(
					`SELECT t.txn_id AS "txnId",
						CAST(t.txn_date AS VARCHAR) AS date,
						t.narration,
						-s.amount AS amount,
						t.month
					FROM transaction_splits s JOIN transactions t USING (txn_id)
					WHERE s.kind = 'expense' AND s.category_key = ? AND s.amount < 0
					ORDER BY t.txn_date DESC, t.txn_id DESC`,
					[input.categoryKey],
				),
			);
		}),
};
