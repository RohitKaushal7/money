import { transactionOverrides } from "@money/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { categoryKinds } from "../category-kinds";
import { protectedProcedure } from "../index";

/**
 * Per-transaction category/kind **overrides** (ADR-0004 / ADR-0012, issue 001) — the manual retag layer.
 * When a rule miscategorises a statement row (or leaves it uncategorised), an override pins it to the right
 * category; `kind` is that category's kind in the owner's own categories (see `categoryKinds`). Overrides
 * live in SQLite and are applied at read time by the reconcile endpoint (instant), and — once wired — baked
 * into the DuckDB rebuild via `ATTACH`.
 */
export const overridesRouter = {
	/** All current overrides (txnId → category/kind). */
	list: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"All per-transaction category overrides the owner has set (a manual pin that beats the rules). Takes no input. Each has txnId, overrideCategoryKey, overrideKind and note. Read-only.",
			},
		})
		.handler(({ context }) =>
			context.appDb.select().from(transactionOverrides),
		),

	/** Pin a transaction to a category (kind from the owner's categories). Upserts on txnId. */
	set: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Pin one bank transaction to a category, overriding the rules; replaces any existing override for it. Input: `txnId` (from the transactions tool), `categoryKey` (a key from the owner's categories, built-in or custom, as the category list shows) and `note` (optional text). The override's kind is that category's kind in the owner's categories; an unknown key is refused and nothing is written. Returns `{ ok: true }`. The transactions tool shows the override immediately, but spending figures and `query` read the rebuilt data, so call the re-tag tool afterwards for it to show up there. The change can't be undone from the change log.",
			},
		})
		.input(
			z.object({
				txnId: z.string().min(1),
				categoryKey: z.string().min(1),
				note: z.string().optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			const kindOf = await categoryKinds(context.appDb, [input.categoryKey]);
			const kind = kindOf(input.categoryKey);
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
		.meta({
			mcp: {
				kind: "write",
				description:
					"Remove a transaction's category override so it reverts to whatever the rules give it. Input: `txnId`. Returns `{ ok: true }` even if there was none. Spending figures and `query` read the rebuilt data, so call the re-tag tool afterwards for this to show up there. The change can't be undone from the change log.",
			},
		})
		.input(z.object({ txnId: z.string().min(1) }))
		.handler(async ({ context, input }) => {
			await context.appDb
				.delete(transactionOverrides)
				.where(eq(transactionOverrides.txnId, input.txnId));
			return { ok: true };
		}),
};
