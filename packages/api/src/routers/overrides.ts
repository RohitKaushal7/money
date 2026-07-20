import { transactionOverrides } from "@money/db";
import { CATEGORY_BY_KEY } from "@money/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../index";

/**
 * Per-transaction category/kind **overrides** (ADR-0004 / ADR-0012, issue 001) — the manual retag layer.
 * When a rule miscategorises a statement row (or leaves it uncategorised), an override pins it to the right
 * category; `kind` is derived from the category taxonomy. Overrides live in SQLite and are applied at read
 * time by the reconcile endpoint (instant), and — once wired — baked into the DuckDB rebuild via `ATTACH`.
 */
export const overridesRouter = {
	/** All current overrides (txnId → category/kind). */
	list: protectedProcedure.handler(({ context }) =>
		context.appDb.select().from(transactionOverrides),
	),

	/** Pin a transaction to a category (kind derived from the taxonomy). Upserts on txnId. */
	set: protectedProcedure
		.input(
			z.object({
				txnId: z.string().min(1),
				categoryKey: z.string().min(1),
				note: z.string().optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			const kind = CATEGORY_BY_KEY.get(input.categoryKey)?.kind ?? null;
			await context.appDb
				.insert(transactionOverrides)
				.values({
					txnId: input.txnId,
					overrideCategoryKey: input.categoryKey,
					overrideKind: kind,
					note: input.note,
				})
				.onConflictDoUpdate({
					target: transactionOverrides.txnId,
					set: {
						overrideCategoryKey: input.categoryKey,
						overrideKind: kind,
						note: input.note,
					},
				});
			return { ok: true };
		}),

	/** Remove a transaction's override (revert to the rule-assigned category). */
	clear: protectedProcedure
		.input(z.object({ txnId: z.string().min(1) }))
		.handler(async ({ context, input }) => {
			await context.appDb
				.delete(transactionOverrides)
				.where(eq(transactionOverrides.txnId, input.txnId));
			return { ok: true };
		}),
};
