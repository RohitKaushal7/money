import type { SqlParam } from "@money/analytics";
import { transactionManualSplits, transactionOverrides } from "@money/db";
import { CATEGORY_BY_KEY, type CoverageRatioPoint } from "@money/shared";
import { z } from "zod";
import { analyticsReady, withReader } from "../analytics";
import { publicProcedure } from "../index";

const UNCATEGORIZED = "uncategorized";

/** Union of the category keys, ignoring order/duplicates — a stable signature for "same categorisation". */
function categorySignature(keys: string[]): string {
	return [...new Set(keys)].sort().join("|");
}

/**
 * Read-only analytics endpoints backing the dashboards. All open DuckDB read-only (ADR-0003).
 *
 * TODO(auth): these are `publicProcedure` for the first dashboard on localhost/tailnet. Before any
 * non-tailnet exposure they MUST become `protectedProcedure` — this is financial data (ADR-0006).
 */

export interface CategoryRow {
	month: string;
	categoryKey: string;
	kind: string;
	amount: number;
	n: number;
}

export interface TransactionRow {
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
	status: publicProcedure.handler(({ context }) => ({
		ready: analyticsReady(context.uid),
	})),

	/** Headline totals + the uncategorised backlog (the review signal). */
	summary: publicProcedure.handler(async ({ context }) => {
		if (!analyticsReady(context.uid)) {
			return {
				ready: false,
				transactions: 0,
				uncategorized: 0,
				months: [] as string[],
			};
		}
		return withReader(context.uid, async (reader) => {
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
		async ({ context }): Promise<CoverageRatioPoint[]> => {
			if (!analyticsReady(context.uid)) return [];
			return withReader(context.uid, (reader) =>
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
		async ({ context }): Promise<CategoryRow[]> => {
			if (!analyticsReady(context.uid)) return [];
			return withReader(context.uid, (reader) =>
				reader.query<CategoryRow>(
					`SELECT month, category_key AS "categoryKey", kind, amount, n
				FROM v_category_monthly ORDER BY month, kind, category_key`,
				),
			);
		},
	),

	/** Most recent transactions with their primary split's category/kind. */
	recentTransactions: publicProcedure.handler(
		async ({ context }): Promise<TransactionRow[]> => {
			if (!analyticsReady(context.uid)) return [];
			return withReader(context.uid, (reader) =>
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

	/**
	 * The **Transactions review** page (issue 002). A filtered, uncategorised-first page of transactions with
	 * their baked category/kind, **overlaid live with the current SQLite overrides** (so an edit shows
	 * instantly, before a re-tag bakes it — the same trick Reconcile uses). `pendingRetag` counts rows whose
	 * SQLite intent (override or manual split) isn't yet reflected in DuckDB — it drives the "Re-tag now"
	 * banner. Filters run against the BAKED split (DuckDB truth); a freshly-overridden row keeps showing its
	 * new category until the next re-tag.
	 */
	transactions: publicProcedure
		.input(
			z.object({
				month: z.string().optional(),
				kind: z.string().optional(),
				uncategorizedOnly: z.boolean().optional(),
				search: z.string().optional(),
				/** YYYY-MM-DD inclusive lower bound */
				dateFrom: z.string().optional(),
				/** YYYY-MM-DD inclusive upper bound */
				dateTo: z.string().optional(),
				limit: z.number().int().min(1).max(500).optional(),
				offset: z.number().int().min(0).optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			if (!analyticsReady(context.uid)) {
				return { transactions: [], total: 0, pendingRetag: 0 };
			}
			const limit = input.limit ?? 100;
			const offset = input.offset ?? 0;

			// Overlay sources from SQLite (small tables — read whole, index in JS).
			const [overrides, manualSplits] = await Promise.all([
				context.appDb.select().from(transactionOverrides),
				context.appDb.select().from(transactionManualSplits),
			]);
			const overrideByTxn = new Map(overrides.map((o) => [o.txnId, o]));
			const manualByTxn = new Map<string, typeof manualSplits>();
			for (const m of manualSplits) {
				const arr = manualByTxn.get(m.txnId) ?? [];
				arr.push(m);
				manualByTxn.set(m.txnId, arr);
			}

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

				const [countRow] = await reader.query<{ n: number }>(
					`SELECT count(*) AS n
					FROM transactions t
					LEFT JOIN transaction_splits s ON s.txn_id = t.txn_id AND s.seq = 0
					${whereSql}`,
					params,
				);
				const total = countRow?.n ?? 0;

				const rows = await reader.query<{
					txnId: string;
					date: string;
					narration: string;
					amount: number;
					balance: number;
					categoryKey: string | null;
					kind: string | null;
				}>(
					`SELECT t.txn_id AS "txnId", CAST(t.txn_date AS VARCHAR) AS date, t.narration,
						t.amount, t.balance, s.category_key AS "categoryKey", s.kind
					FROM transactions t
					LEFT JOIN transaction_splits s ON s.txn_id = t.txn_id AND s.seq = 0
					${whereSql}
					ORDER BY t.txn_date DESC, t.balance DESC
					LIMIT ${limit} OFFSET ${offset}`,
					params,
				);

				const transactions = rows.map((r) => {
					const ov = overrideByTxn.get(r.txnId);
					const manual = manualByTxn.get(r.txnId);
					const bakedCategoryKey = r.categoryKey ?? UNCATEGORIZED;
					const effectiveCategoryKey =
						ov?.overrideCategoryKey ?? bakedCategoryKey;
					const effectiveKind =
						ov?.overrideKind ??
						CATEGORY_BY_KEY.get(effectiveCategoryKey)?.kind ??
						r.kind ??
						"transfer";
					return {
						txnId: r.txnId,
						date: r.date,
						narration: r.narration,
						amount: r.amount,
						balance: r.balance,
						bakedCategoryKey,
						categoryKey: effectiveCategoryKey,
						kind: effectiveKind,
						hasOverride: ov != null,
						overrideNote: ov?.note ?? null,
						manualSplitCount: manual?.length ?? 0,
					};
				});

				// pendingRetag: any candidate whose expected category signature differs from what's baked.
				const candidateIds = new Set<string>([
					...overrideByTxn.keys(),
					...manualByTxn.keys(),
				]);
				let pendingRetag = 0;
				if (candidateIds.size > 0) {
					const idList = [...candidateIds]
						.map((id) => `'${id.replace(/'/g, "''")}'`)
						.join(",");
					const bakedRows = await reader.query<{
						txnId: string;
						categoryKey: string;
					}>(
						`SELECT txn_id AS "txnId", category_key AS "categoryKey"
						FROM transaction_splits WHERE txn_id IN (${idList})`,
					);
					const bakedByTxn = new Map<string, string[]>();
					for (const b of bakedRows) {
						const arr = bakedByTxn.get(b.txnId) ?? [];
						arr.push(b.categoryKey);
						bakedByTxn.set(b.txnId, arr);
					}
					for (const id of candidateIds) {
						const manual = manualByTxn.get(id);
						const ov = overrideByTxn.get(id);
						let expected: string;
						if (manual && manual.length > 0) {
							expected = categorySignature(manual.map((m) => m.categoryKey));
						} else if (ov?.overrideCategoryKey) {
							expected = categorySignature([ov.overrideCategoryKey]);
						} else {
							continue; // override with no category → nothing to bake
						}
						if (expected !== categorySignature(bakedByTxn.get(id) ?? [])) {
							pendingRetag++;
						}
					}
				}

				return { transactions, total, pendingRetag };
			});
		}),
};
