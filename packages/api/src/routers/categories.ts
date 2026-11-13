import {
	type AppDb,
	categories,
	rules,
	transactionManualSplits,
	transactionOverrides,
} from "@money/db";
import { ORPCError } from "@orpc/server";
import { asc, eq, max } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../index";

/**
 * Per-user category CRUD (spec 2026-07-21 §8). Seeded rows are `system` (locked: label + visibility only,
 * never deleted, key/Kind fixed); custom rows are fully editable/deletable. Deleting a referenced custom
 * category is blocked with counts. The DuckDB `categories` table is refreshed from here on the next Re-tag.
 */

const KINDS = [
	"active_income",
	"passive_income",
	"expense",
	"investment",
	"transfer",
] as const;

/** label → stable snake_case key. */
function slugify(label: string): string {
	const base = label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return base || "category";
}

/** Count how many rules / overrides / manual splits reference each category key. */
async function refCounts(
	appDb: AppDb,
): Promise<Map<string, { rules: number; txns: number }>> {
	const [ruleKeys, overrideKeys, splitKeys] = await Promise.all([
		appDb.select({ k: rules.assignCategoryKey }).from(rules),
		appDb
			.select({ k: transactionOverrides.overrideCategoryKey })
			.from(transactionOverrides),
		appDb
			.select({ k: transactionManualSplits.categoryKey })
			.from(transactionManualSplits),
	]);
	const counts = new Map<string, { rules: number; txns: number }>();
	const bump = (key: string | null, field: "rules" | "txns") => {
		if (!key) return;
		const c = counts.get(key) ?? { rules: 0, txns: 0 };
		c[field] += 1;
		counts.set(key, c);
	};
	for (const r of ruleKeys) bump(r.k, "rules");
	for (const o of overrideKeys) bump(o.k, "txns");
	for (const s of splitKeys) bump(s.k, "txns");
	return counts;
}

const createInput = z.object({
	label: z.string().min(1),
	kind: z.enum(KINDS),
	taxable: z.boolean().optional(),
});

export const categoriesRouter = {
	/** All categories (sort order), each with a reference count for the delete-UX. */
	list: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"All of the owner's spending categories in picker order. Takes no input. Returns each category's id, key, label, kind (active_income, passive_income, expense, investment or transfer), taxable flag, system flag (built-in, locked), active flag, sortOrder, colorSlot, plus `refRules` (rules using it) and `refTxns` (overrides and manual splits using it). Use `key` as the categoryKey in rules, overrides and splits. Read-only.",
			},
		})
		.handler(async ({ context }) => {
			const rows = await context.appDb
				.select()
				.from(categories)
				.orderBy(asc(categories.sortOrder), asc(categories.id));
			const counts = await refCounts(context.appDb);
			return rows.map((c) => {
				const rc = counts.get(c.key) ?? { rules: 0, txns: 0 };
				return { ...c, refRules: rc.rules, refTxns: rc.txns };
			});
		}),

	/** Add a custom category (fully editable). Key is slugged from the label, uniqueness-suffixed. */
	create: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Add a custom category. Input: `label` (display name), `kind` (one of active_income, passive_income, expense, investment, transfer), `taxable` (optional boolean). The `key` is generated from the label as snake_case, with _2, _3 added if taken, and the category goes to the end of the list. Returns the new row. Existing transactions are not affected until a rule, override or split uses it. The change can't be undone from the change log.",
			},
		})
		.input(createInput)
		.handler(async ({ context, input }) => {
			const existing = await context.appDb
				.select({ key: categories.key })
				.from(categories);
			const taken = new Set(existing.map((e) => e.key));
			let key = slugify(input.label);
			for (let i = 2; taken.has(key); i += 1) {
				key = `${slugify(input.label)}_${i}`;
			}
			const [maxRow] = await context.appDb
				.select({ m: max(categories.sortOrder) })
				.from(categories);
			const [row] = await context.appDb
				.insert(categories)
				.values({
					key,
					label: input.label,
					kind: input.kind,
					taxable: input.taxable ?? null,
					system: false,
					active: true,
					sortOrder: (maxRow?.m ?? 0) + 1,
				})
				.returning();
			return row;
		}),

	/** Edit a category. System rows accept label + `active` only; custom rows accept everything but the key. */
	update: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Edit a category. Input: `id` (whole number, the category's id from the category list) and any of `label`, `active` (false hides it), `colorSlot` (1-5 pins a chart colour, null clears the pin), and for custom categories only `kind` and `taxable` (null clears it). Built-in (system) categories accept only label, active and colorSlot; changing their kind or taxable is refused. Errors if the id is unknown or nothing is given. Returns the updated row. A category's kind is re-applied to spending data at the next re-tag. The change can't be undone from the change log.",
			},
		})
		.input(
			z.object({
				id: z.number().int(),
				label: z.string().min(1).optional(),
				kind: z.enum(KINDS).optional(),
				taxable: z.boolean().nullable().optional(),
				active: z.boolean().optional(),
				/** null clears the pin, letting the category claim a free slot instead. */
				colorSlot: z
					.union([
						z.literal(1),
						z.literal(2),
						z.literal(3),
						z.literal(4),
						z.literal(5),
					])
					.nullable()
					.optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			const [row] = await context.appDb
				.select()
				.from(categories)
				.where(eq(categories.id, input.id));
			if (!row) {
				throw new ORPCError("NOT_FOUND", { message: "No such category." });
			}
			if (
				row.system &&
				(input.kind !== undefined || input.taxable !== undefined)
			) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"System categories: only the label and visibility can be changed.",
				});
			}
			const set: Record<string, unknown> = {};
			if (input.label !== undefined) set.label = input.label;
			if (input.active !== undefined) set.active = input.active;
			// Colour is presentation, not taxonomy — editable on system rows too, and it has to be, since
			// the seeded pins sit on system categories.
			if (input.colorSlot !== undefined) set.colorSlot = input.colorSlot;
			if (!row.system) {
				if (input.kind !== undefined) set.kind = input.kind;
				if (input.taxable !== undefined) set.taxable = input.taxable;
			}
			if (Object.keys(set).length === 0) {
				throw new ORPCError("BAD_REQUEST", { message: "Nothing to update." });
			}
			const [updated] = await context.appDb
				.update(categories)
				.set(set)
				.where(eq(categories.id, input.id))
				.returning();
			return updated;
		}),

	/** Delete a custom category. Blocked for system rows and when referenced. */
	remove: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Permanently delete a custom category. Input: `id` (whole number, the category's id from the category list). Refused for built-in categories (hide them with the update tool instead) and for categories still used by any rule, override or manual split (reassign those first; the error gives the counts). Returns `{ deleted: id }`. The change can't be undone from the change log.",
			},
		})
		.input(z.object({ id: z.number().int() }))
		.handler(async ({ context, input }) => {
			const [row] = await context.appDb
				.select()
				.from(categories)
				.where(eq(categories.id, input.id));
			if (!row) {
				throw new ORPCError("NOT_FOUND", { message: "No such category." });
			}
			if (row.system) {
				throw new ORPCError("FORBIDDEN", {
					message: "System categories can't be deleted — hide it instead.",
				});
			}
			const rc = (await refCounts(context.appDb)).get(row.key) ?? {
				rules: 0,
				txns: 0,
			};
			if (rc.rules > 0 || rc.txns > 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Can't delete — ${rc.rules} rule(s) and ${rc.txns} transaction(s) use this. Reassign them first.`,
				});
			}
			await context.appDb.delete(categories).where(eq(categories.id, input.id));
			return { deleted: input.id };
		}),

	/** Reorder categories (picker order) from a top-to-bottom id list. */
	reorder: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Set the order categories appear in pickers. Input: `orderedIds` \u2014 every category id (whole numbers), top to bottom (at least one); each gets its position as sort order. Ids omitted keep their old order value, so pass the full list. Returns `{ reordered: count }`. Cosmetic only; spending figures are unaffected. The change can't be undone from the change log.",
			},
		})
		.input(z.object({ orderedIds: z.array(z.number().int()).min(1) }))
		.handler(async ({ context, input }) => {
			// One batch (one SQLite transaction): every position changes, or none does.
			const [first, ...rest] = input.orderedIds.map((id, sortOrder) =>
				context.appDb
					.update(categories)
					.set({ sortOrder })
					.where(eq(categories.id, id)),
			);
			if (first) await context.appDb.batch([first, ...rest]);
			return { reordered: input.orderedIds.length };
		}),
};
