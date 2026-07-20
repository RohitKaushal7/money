import { type SpendingRow, spendingTrends } from "@money/shared";
import { z } from "zod";
import { analyticsReady, withReader } from "../analytics";
import { publicProcedure } from "../index";
import { loadRates } from "./currency";
import { listRecurring, recurringToInr } from "./plan";

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
async function expenseRows(uid: string): Promise<SpendingRow[]> {
	return withReader(uid, (reader) =>
		reader.query<SpendingRow>(
			`SELECT month, category_key AS "categoryKey", kind, amount, n
			FROM v_category_monthly
			WHERE kind = 'expense'
			ORDER BY month`,
		),
	);
}

export interface CategoryTxn {
	txnId: string;
	date: string;
	narration: string;
	amount: number;
	month: string;
}

export const spendingRouter = {
	/** Category spend trends vs plan budget: movers table + totals + budgeted-but-unspent footnote. */
	overview: publicProcedure
		.input(
			z
				.object({
					/** inclusive YYYY-MM-DD lower bound */
					from: z.string().optional(),
					/** inclusive YYYY-MM-DD upper bound */
					to: z.string().optional(),
				})
				.optional(),
		)
		.handler(async ({ context, input }) => {
			const rows = analyticsReady(context.uid)
				? await expenseRows(context.uid)
				: [];
			const [recurringNative, rates] = await Promise.all([
				listRecurring(context.appDb),
				loadRates(context.controlDb),
			]);
			// statement actuals are INR; normalise the (possibly foreign) plan budget to INR to match
			const recurring = recurringNative.map((r) => recurringToInr(r, rates));
			// scope to the requested date range (v_category_monthly.month is 'YYYY-MM'); cap to the last
			// 24 months either way so the sparkline bars stay legible as history grows
			const fromMonth = input?.from?.slice(0, 7);
			const toMonth = input?.to?.slice(0, 7);
			const months = [...new Set(rows.map((r) => r.month))]
				.sort()
				.filter(
					(m) =>
						(fromMonth == null || m >= fromMonth) &&
						(toMonth == null || m <= toMonth),
				)
				.slice(-24);
			return spendingTrends({ rows, recurring, months });
		}),

	/** Drill-in: the individual expense transactions filed under one category (newest first). */
	categoryTransactions: publicProcedure
		.input(z.object({ categoryKey: z.string().min(1) }))
		.handler(async ({ context, input }): Promise<CategoryTxn[]> => {
			if (!analyticsReady(context.uid)) return [];
			return withReader(context.uid, (reader) =>
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
