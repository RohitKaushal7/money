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

	/** Pin a transaction to a category (kind derived from the taxonomy). Upserts on txnId. */
	set: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Pin one bank transaction to a category, overriding the rules; replaces any existing override for it. Input: `txnId` (from the transactions tool), `categoryKey` (a category key). The kind is looked up in the built-in category taxonomy only, not the owner's custom categories: a custom (user-created) category key gets kind null, so prefer built-in keys here and tell the owner when a custom category is genuinely needed, `note` (optional text). Returns `{ ok: true }`. The transactions tool shows the override immediately, but spending figures and `query` read the rebuilt data, so call the re-tag tool afterwards for it to show up there. The change can't be undone from the change log.",
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
