import { type AppDb, transactionOverrides } from "@money/db";
import { reconcile, type StatementCredit } from "@money/shared";
import { z } from "zod";
import { analyticsReady, withReader } from "../analytics";
import { protectedProcedure } from "../index";
import { listInvestments } from "./plan";

/**
 * The **reconciliation** router (ADR-0014 / issue 008) — the bridge between the two scenes. Reads the Plan
 * (SQLite, via {@link listInvestments}) and the month's actual credits (DuckDB read-only, via `withReader`),
 * then runs the pure `reconcile` compute. Read-only over both stores: it proposes, never mutates either
 * scene.
 */

/** Today as YYYY-MM-DD (server clock) — drives pending-vs-missed and per-month liveness. */
function todayISO(): string {
	return new Date().toISOString().slice(0, 10);
}

const CREDIT_SELECT = `SELECT t.txn_id AS "txnId",
		CAST(t.txn_date AS VARCHAR) AS date,
		t.narration,
		t.amount::DOUBLE AS amount,
		t.month,
		s.kind,
		s.category_key AS "categoryKey"
	FROM transactions t
	LEFT JOIN transaction_splits s ON s.txn_id = t.txn_id AND s.seq = 0
	WHERE t.amount > 0`;

/** Pull month M's positive credits + their primary-split kind from the analytical DB (read-only). */
async function monthCredits(
	month: string,
	uid: string,
): Promise<StatementCredit[]> {
	return withReader(uid, (reader) =>
		reader.query<StatementCredit>(
			`${CREDIT_SELECT} AND t.month = ? ORDER BY t.txn_date`,
			[month],
		),
	);
}

/** Every credit from `from` (YYYY-MM) onward, in one read — the history chart reconciles N months. */
async function creditsSince(
	from: string,
	uid: string,
): Promise<StatementCredit[]> {
	return withReader(uid, (reader) =>
		reader.query<StatementCredit>(
			`${CREDIT_SELECT} AND t.month >= ? ORDER BY t.txn_date`,
			[from],
		),
	);
}

/** Step back n months from a YYYY-MM. */
function minusMonths(month: string, n: number): string {
	const [y, m] = month.split("-").map(Number);
	return new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1 - n, 1))
		.toISOString()
		.slice(0, 7);
}

/**
 * Overlay manual overrides (issue 001) onto the fetched credits at read time — so a retag recategorises
 * instantly, before a full re-ingest bakes it into DuckDB via `ATTACH`. Pins category_key (+ derived kind).
 */
async function applyOverrides(
	credits: StatementCredit[],
	appDb: AppDb,
): Promise<StatementCredit[]> {
	const rows = await appDb.select().from(transactionOverrides);
	if (rows.length === 0) return credits;
	const byTxn = new Map(rows.map((r) => [r.txnId, r]));
	return credits.map((c) => {
		const o = byTxn.get(c.txnId);
		if (!o?.overrideCategoryKey) return c;
		return {
			...c,
			categoryKey: o.overrideCategoryKey,
			kind: o.overrideKind ?? c.kind,
		};
	});
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
	month: protectedProcedure
		.input(monthInput)
		.handler(async ({ context, input }) => {
			const today = todayISO();
			const month = input.month ?? today.slice(0, 7);
			const investments = await listInvestments(context.appDb);
			// No statement ingested yet → still show the expected side (all pending/missed); no credits, no matches.
			const raw = analyticsReady(context.uid)
				? await monthCredits(month, context.uid)
				: [];
			const credits = await applyOverrides(raw, context.appDb);
			return reconcile({ investments, credits, month, today });
		}),

	/**
	 * The last N months reconciled in one pass — expected vs actual per month, for the history chart.
	 *
	 * Investments and credits are each read **once** and the pure `reconcile` runs per month in memory, so
	 * a twelve-month history costs two queries rather than twenty-four. Returns the summaries only; the
	 * selected month's detail comes from `month` above.
	 */
	history: protectedProcedure
		.input(
			z.object({ months: z.coerce.number().int().min(1).max(36).default(12) }),
		)
		.handler(async ({ context, input }) => {
			const today = todayISO();
			const current = today.slice(0, 7);
			const from = minusMonths(current, input.months - 1);
			const investments = await listInvestments(context.appDb);
			const raw = analyticsReady(context.uid)
				? await creditsSince(from, context.uid)
				: [];
			const credits = await applyOverrides(raw, context.appDb);

			const byMonth = new Map<string, StatementCredit[]>();
			for (const c of credits) {
				const arr = byMonth.get(c.month) ?? [];
				arr.push(c);
				byMonth.set(c.month, arr);
			}

			return Array.from({ length: input.months }, (_, i) => {
				const month = minusMonths(current, input.months - 1 - i);
				return reconcile({
					investments,
					credits: byMonth.get(month) ?? [],
					month,
					today,
				}).summary;
			});
		}),

	/** Statement months available to reconcile (newest first), for the picker. */
	months: protectedProcedure.handler(async ({ context }): Promise<string[]> => {
		if (!analyticsReady(context.uid)) return [];
		const rows = await withReader(context.uid, (reader) =>
			reader.query<{ month: string }>(
				"SELECT DISTINCT month FROM transactions ORDER BY month DESC",
			),
		);
		return rows.map((r) => r.month);
	}),
};
