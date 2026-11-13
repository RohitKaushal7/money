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
	list: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"The owner's categorisation rules in match order (priority ascending; the first matching active rule wins when statements are tagged). Takes no input. Each rule has id, priority, pattern, matchType, assignKind, assignCategoryKey, assignInvestmentId, minAmount, maxAmount and active. Read-only.",
			},
		})
		.handler(({ context }) =>
			context.appDb
				.select()
				.from(rules)
				.orderBy(asc(rules.priority), asc(rules.id)),
		),

	/** Add a rule at the end of the list (lowest match priority). */
	create: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Add a categorisation rule at the end of the list (lowest priority, so earlier rules win). Input: `pattern` (text to look for in a transaction narration), `matchType` (substring or regex), `assignKind` (active_income, passive_income, expense, investment or transfer), `assignCategoryKey` (a category key from the category list), `assignInvestmentId` (optional holding id to link, or null), `minAmount` and `maxAmount` (optional INR bounds on the transaction amount magnitude, or null), `active` (default true). Returns the new rule. Spending figures and `query` read the rebuilt data, so it takes effect there only after you call the re-tag tool. The change can't be undone from the change log.",
			},
		})
		.input(ruleInput)
		.handler(async ({ context, input }) => {
			const [maxRow] = await context.appDb
				.select({ m: max(rules.priority) })
				.from(rules);
			const [row] = await context.appDb
				.insert(rules)
				.values({
					priority: (maxRow?.m ?? 0) + 1,
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
		.meta({
			mcp: {
				kind: "write",
				description:
					"Edit a rule; send only the fields to change. Input: `id` (whole number, the rule's id from the rule list) plus any of `pattern`, `matchType`, `assignKind`, `assignCategoryKey`, `assignInvestmentId`, `minAmount`, `maxAmount`, `active` (same meaning as when creating). Errors if the id is unknown or no field is given. Returns the updated rule. Spending figures and `query` read the rebuilt data, so call the re-tag tool afterwards for this to show up there. The change can't be undone from the change log.",
			},
		})
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
		.meta({
			mcp: {
				kind: "write",
				description:
					"Permanently delete a rule. Input: `id` (whole number, the rule's id from the rule list). Returns `{ deleted: id }` even if no such rule existed. Transactions it tagged keep their category until the next re-tag, which then re-derives them without it. Spending figures and `query` read the rebuilt data, so call the re-tag tool afterwards for this to show up there. The change can't be undone from the change log.",
			},
		})
		.input(z.object({ id: z.number().int() }))
		.handler(async ({ context, input }) => {
			await context.appDb.delete(rules).where(eq(rules.id, input.id));
			return { deleted: input.id };
		}),

	/** Renumber priorities from a top-to-bottom ordering of rule ids (position = priority). */
	reorder: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Change which rules win by renumbering priorities from a top-to-bottom list. Input: `orderedIds` \u2014 rule ids (whole numbers) in the desired match order (priority 1 for the first); pass every rule id, since omitted rules keep their old priority and may clash. Returns `{ reordered: count }`. Spending figures and `query` read the rebuilt data, so call the re-tag tool afterwards for this to show up there. The change can't be undone from the change log.",
			},
		})
		.input(z.object({ orderedIds: z.array(z.number().int()).min(1) }))
		.handler(async ({ context, input }) => {
			// One batch (one SQLite transaction): every priority changes, or none does.
			const [first, ...rest] = input.orderedIds.map((id, i) =>
				context.appDb
					.update(rules)
					.set({ priority: i + 1 })
					.where(eq(rules.id, id)),
			);
			if (first) await context.appDb.batch([first, ...rest]);
			return { reordered: input.orderedIds.length };
		}),
};
