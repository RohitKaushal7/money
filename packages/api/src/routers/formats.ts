import { accounts, importFiles, statementFormats } from "@money/db";
import { ORPCError } from "@orpc/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../index";

/**
 * Saved statement formats (spec 2026-07-21). Read + delete only; creation happens in the import wizard
 * (`import.commit` mode `new`). Built-in `system` formats (SBI) can't be deleted, and a format still bound to
 * raw files is blocked with a count so its imports don't lose their parser.
 */
export const formatsRouter = {
	/** All saved formats, each with its account name + how many raw files use it. */
	list: protectedProcedure.handler(async ({ context }) => {
		const [formats, bindings, accts] = await Promise.all([
			context.appDb
				.select()
				.from(statementFormats)
				.orderBy(asc(statementFormats.system), asc(statementFormats.name)),
			context.appDb
				.select({ formatId: importFiles.formatId })
				.from(importFiles),
			context.appDb.select().from(accounts),
		]);
		const acctById = new Map(accts.map((a) => [a.id, a]));
		const useCount = new Map<number, number>();
		for (const b of bindings) {
			useCount.set(b.formatId, (useCount.get(b.formatId) ?? 0) + 1);
		}
		return formats.map((f) => ({
			id: f.id,
			name: f.name,
			system: f.system,
			builtin: f.builtin,
			amountMode: f.amountMode,
			anchor: f.anchor,
			accountId: f.accountId,
			accountName: acctById.get(f.accountId)?.name ?? null,
			files: useCount.get(f.id) ?? 0,
		}));
	}),

	/** Delete a custom format. Blocked for system rows and when raw files still reference it. */
	remove: protectedProcedure
		.input(z.object({ id: z.number().int() }))
		.handler(async ({ context, input }) => {
			const [row] = await context.appDb
				.select()
				.from(statementFormats)
				.where(eq(statementFormats.id, input.id));
			if (!row) {
				throw new ORPCError("NOT_FOUND", { message: "No such format." });
			}
			if (row.system) {
				throw new ORPCError("FORBIDDEN", {
					message: "Built-in formats can't be deleted.",
				});
			}
			const uses = await context.appDb
				.select({ id: importFiles.id })
				.from(importFiles)
				.where(eq(importFiles.formatId, input.id));
			if (uses.length > 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Can't delete — ${uses.length} imported file(s) use this format. Remove them first.`,
				});
			}
			await context.appDb
				.delete(statementFormats)
				.where(eq(statementFormats.id, input.id));
			return { deleted: input.id };
		}),
};
