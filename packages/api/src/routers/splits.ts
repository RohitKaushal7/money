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
		.meta({
			mcp: {
				kind: "read",
				description:
					"The manual split lines for one transaction (how a mixed payout is divided, e.g. interest vs principal). Input: `txnId`. Returns lines in order with seq, amount (signed INR), kind, categoryKey, cashflowType and note; an empty list means the transaction uses its default single rule-derived split. Read-only.",
			},
		})
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
		.meta({
			mcp: {
				kind: "write",
				description:
					"Replace all manual split lines of one transaction, e.g. to divide a maturity payout into interest and principal. Input: `txnId` and `lines` (at least one): each `{ amount (signed INR, same sign convention as the transaction), categoryKey (the line's kind is looked up in the built-in category taxonomy only: a custom, user-created category key silently gets kind transfer, which can misclassify income or expense after a re-tag, so use built-in keys and tell the owner when a custom category is needed), cashflowType (optional: contribution, coupon, dividend, redemption or maturity), note (optional) }`. The lines must add up to the transaction's amount within 0.01, otherwise it is refused saying the expected sum; an unknown transaction is refused. Returns `{ ok, lines }`. These lines replace the default split at the next re-tag. Spending figures and `query` read the rebuilt data, so call the re-tag tool afterwards for this to show up there. The change can't be undone from the change log.",
			},
		})
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
			// One batch (one SQLite transaction): if the insert fails, the old lines are still there.
			await context.appDb.batch([
				context.appDb
					.delete(transactionManualSplits)
					.where(eq(transactionManualSplits.txnId, input.txnId)),
				context.appDb.insert(transactionManualSplits).values(
					input.lines.map((l, i) => ({
						txnId: input.txnId,
						seq: i,
						amount: l.amount,
						kind: CATEGORY_BY_KEY.get(l.categoryKey)?.kind ?? "transfer",
						categoryKey: l.categoryKey,
						cashflowType: l.cashflowType ?? null,
						note: l.note ?? null,
					})),
				),
			]);
			return { ok: true, lines: input.lines.length };
		}),

	/** Remove all manual lines (revert to the default rule-derived split at the next re-tag). */
	clear: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Delete all manual split lines for one transaction so it goes back to its default rule-derived split. Input: `txnId`. Returns `{ ok: true }`. Spending figures and `query` read the rebuilt data, so call the re-tag tool afterwards for this to show up there. The change can't be undone from the change log.",
			},
		})
		.input(z.object({ txnId: z.string().min(1) }))
		.handler(async ({ context, input }) => {
			await context.appDb
				.delete(transactionManualSplits)
				.where(eq(transactionManualSplits.txnId, input.txnId));
			return { ok: true };
		}),
};
