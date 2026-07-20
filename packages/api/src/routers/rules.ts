import { rules } from "@money/db";
import { ORPCError } from "@orpc/server";
import { asc, eq, max } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../index";

/**
 * Per-user categorisation rules CRUD (spec 2026-07-21 §8). Rules live in the user's `app.db` and are applied
 * by the DuckDB rebuild/retag (ADR-0004). Edits are staged; the client applies them via the existing Re-tag.
 * `priority` is derived from list position (first-match-wins, lower = earlier) — `reorder` renumbers `1..N`.
 */

const KINDS = [
	"active_income",
	"passive_income",
	"expense",
	"investment",
	"transfer",
] as const;

const ruleInput = z.object({
	pattern: z.string().min(1),
	matchType: z.enum(["substring", "regex"]),
	assignKind: z.enum(KINDS),
	assignCategoryKey: z.string().min(1),
	assignInvestmentId: z.number().int().nullable().optional(),
	minAmount: z.number().nullable().optional(),
	maxAmount: z.number().nullable().optional(),
	active: z.boolean().optional(),
});

export const rulesRouter = {
	/** All rules in match order (priority asc, id asc). */
	list: protectedProcedure.handler(({ context }) =>
		context.appDb
			.select()
			.from(rules)
			.orderBy(asc(rules.priority), asc(rules.id)),
	),

	/** Add a rule at the end of the list (lowest match priority). */
	create: protectedProcedure
		.input(ruleInput)
		.handler(async ({ context, input }) => {
			const [{ m }] = await context.appDb
				.select({ m: max(rules.priority) })
				.from(rules);
			const [row] = await context.appDb
				.insert(rules)
				.values({
					priority: (m ?? 0) + 1,
					pattern: input.pattern,
					matchType: input.matchType,
					assignKind: input.assignKind,
					assignCategoryKey: input.assignCategoryKey,
					assignInvestmentId: input.assignInvestmentId ?? null,
					minAmount: input.minAmount ?? null,
					maxAmount: input.maxAmount ?? null,
					active: input.active ?? true,
				})
				.returning();
			return row;
		}),

	/** Edit a rule (partial). */
	update: protectedProcedure
		.input(ruleInput.partial().extend({ id: z.number().int() }))
		.handler(async ({ context, input }) => {
			const { id, ...rest } = input;
			const set: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(rest)) {
				if (v !== undefined) set[k] = v;
			}
			if (Object.keys(set).length === 0) {
				throw new ORPCError("BAD_REQUEST", { message: "Nothing to update." });
			}
			const [row] = await context.appDb
				.update(rules)
				.set(set)
				.where(eq(rules.id, id))
				.returning();
			if (!row) throw new ORPCError("NOT_FOUND", { message: "No such rule." });
			return row;
		}),

	/** Delete a rule. */
	remove: protectedProcedure
		.input(z.object({ id: z.number().int() }))
		.handler(async ({ context, input }) => {
			await context.appDb.delete(rules).where(eq(rules.id, input.id));
			return { deleted: input.id };
		}),

	/** Renumber priorities from a top-to-bottom ordering of rule ids (position = priority). */
	reorder: protectedProcedure
		.input(z.object({ orderedIds: z.array(z.number().int()).min(1) }))
		.handler(async ({ context, input }) => {
			let priority = 1;
			for (const id of input.orderedIds) {
				await context.appDb
					.update(rules)
					.set({ priority })
					.where(eq(rules.id, id));
				priority += 1;
			}
			return { reordered: input.orderedIds.length };
		}),
};
