import { transactionManualSplits } from "@money/db";
import { CATEGORY_BY_KEY } from "@money/shared";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { analyticsReady, withReader } from "../analytics";
import { protectedProcedure } from "../index";

/**
 * Manual **allocation lines** for one transaction (spec §4 / issue 002) — how a mixed payout is split into
 * e.g. interest (`coupon`) vs principal (`redemption`). When any rows exist for a `txn_id` they REPLACE the
 * default single split at the next re-tag. Lines live in SQLite; `set` validates they reconcile to the
 * transaction's gross amount (DuckDB is the source of truth for the amount).
 */

const lineSchema = z.object({
	amount: z.number(),
	categoryKey: z.string().min(1),
	/** contribution | coupon | dividend | redemption | maturity */
	cashflowType: z.string().optional(),
	note: z.string().optional(),
});

export const splitsRouter = {
	/** The manual split lines for a transaction (empty = uses the default rule-derived split). */
	get: protectedProcedure
		.input(z.object({ txnId: z.string().min(1) }))
		.handler(({ context, input }) =>
			context.appDb
				.select()
				.from(transactionManualSplits)
				.where(eq(transactionManualSplits.txnId, input.txnId))
				.orderBy(transactionManualSplits.seq),
		),

	/** Replace all manual lines for a transaction. Lines must sum to the transaction's gross amount. */
	set: protectedProcedure
		.input(
			z.object({
				txnId: z.string().min(1),
				lines: z.array(lineSchema).min(1),
			}),
		)
		.handler(async ({ context, input }) => {
			if (analyticsReady(context.uid)) {
				const [txn] = await withReader(context.uid, (reader) =>
					reader.query<{ amount: number }>(
						"SELECT amount FROM transactions WHERE txn_id = ?",
						[input.txnId],
					),
				);
				if (!txn) {
					throw new ORPCError("NOT_FOUND", { message: "Unknown transaction." });
				}
				const sum = input.lines.reduce((a, l) => a + l.amount, 0);
				if (Math.abs(sum - txn.amount) > 0.01) {
					throw new ORPCError("BAD_REQUEST", {
						message: `Splits must sum to ${txn.amount.toFixed(2)} (got ${sum.toFixed(2)}).`,
					});
				}
			}
			await context.appDb
				.delete(transactionManualSplits)
				.where(eq(transactionManualSplits.txnId, input.txnId));
			await context.appDb.insert(transactionManualSplits).values(
				input.lines.map((l, i) => ({
					txnId: input.txnId,
					seq: i,
					amount: l.amount,
					kind: CATEGORY_BY_KEY.get(l.categoryKey)?.kind ?? "transfer",
					categoryKey: l.categoryKey,
					cashflowType: l.cashflowType ?? null,
					note: l.note ?? null,
				})),
			);
			return { ok: true, lines: input.lines.length };
		}),

	/** Remove all manual lines (revert to the default rule-derived split at the next re-tag). */
	clear: protectedProcedure
		.input(z.object({ txnId: z.string().min(1) }))
		.handler(async ({ context, input }) => {
			await context.appDb
				.delete(transactionManualSplits)
				.where(eq(transactionManualSplits.txnId, input.txnId));
			return { ok: true };
		}),
};
