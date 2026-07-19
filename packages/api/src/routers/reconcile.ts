import { reconcile, type StatementCredit } from "@money/shared";
import { z } from "zod";
import { analyticsReady, withReader } from "../analytics";
import { publicProcedure } from "../index";
import { listInvestments } from "./plan";

/**
 * The **reconciliation** router (ADR-0014 / issue 008) — the bridge between the two scenes. Reads the Plan
 * (SQLite, via {@link listInvestments}) and the month's actual credits (DuckDB read-only, via `withReader`),
 * then runs the pure `reconcile` compute. Read-only over both stores: it proposes, never mutates either
 * scene.
 *
 * TODO(auth): `publicProcedure` for the localhost/tailnet dashboard. MUST become `protectedProcedure`
 * before any non-tailnet exposure — this reads financial data (ADR-0006).
 */

/** Today as YYYY-MM-DD (server clock) — drives pending-vs-missed and per-month liveness. */
function todayISO(): string {
	return new Date().toISOString().slice(0, 10);
}

/** Pull month M's positive credits + their primary-split kind from the analytical DB (read-only). */
async function monthCredits(month: string): Promise<StatementCredit[]> {
	return withReader((reader) =>
		reader.query<StatementCredit>(
			`SELECT t.txn_id AS "txnId",
				CAST(t.txn_date AS VARCHAR) AS date,
				t.narration,
				t.amount::DOUBLE AS amount,
				t.month,
				s.kind,
				s.category_key AS "categoryKey"
			FROM transactions t
			LEFT JOIN transaction_splits s ON s.txn_id = t.txn_id AND s.seq = 0
			WHERE t.amount > 0 AND t.month = ?
			ORDER BY t.txn_date`,
			[month],
		),
	);
}

const monthInput = z.object({
	/** YYYY-MM; defaults to the current month */
	month: z
		.string()
		.regex(/^\d{4}-\d{2}$/)
		.optional(),
});

export const reconcileRouter = {
	/** Expected-vs-actual for a month: received/pending/missed events + unrecognised-credit suggestions. */
	month: publicProcedure.input(monthInput).handler(async ({ input }) => {
		const today = todayISO();
		const month = input.month ?? today.slice(0, 7);
		const investments = await listInvestments();
		// No statement ingested yet → still show the expected side (all pending/missed); no credits, no matches.
		const credits = analyticsReady() ? await monthCredits(month) : [];
		return reconcile({ investments, credits, month, today });
	}),

	/** Statement months available to reconcile (newest first), for the picker. */
	months: publicProcedure.handler(async (): Promise<string[]> => {
		if (!analyticsReady()) return [];
		const rows = await withReader((reader) =>
			reader.query<{ month: string }>(
				"SELECT DISTINCT month FROM transactions ORDER BY month DESC",
			),
		);
		return rows.map((r) => r.month);
	}),
};
