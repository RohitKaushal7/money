import { z } from "zod";

import { listChanges, undoChange } from "../change-log";
import { protectedProcedure } from "../index";

/** The change log of writes to this user's data, and undo for holdings and recurring expenses. */
export const changesRouter = {
	list: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					'List recent changes to the owner\'s data, newest first — writes made in the app (source "app") and by Claude (source "mcp"), with the procedure called, its input, and for holdings and recurring expenses the row before and after. Input: `limit` — how many changes to return (whole number, 1–200, default 50). Use a change\'s `id` with the undo tool.',
			},
		})
		.input(
			z
				.object({ limit: z.number().int().min(1).max(200).optional() })
				.optional(),
		)
		.handler(({ context, input }) =>
			listChanges(context.appDb, { limit: input?.limit ?? 50 }),
		),
	undo: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Undo one earlier change to a holding (investment) or recurring expense: an add is removed, an edit is reverted to the previous values, a delete is restored with the same id. Input: `id` — the change's id from the change list (whole number). Refused, with the reason, if that holding or expense has been edited since, if the change was already undone, or if it was not to a holding or expense.",
			},
		})
		.input(z.object({ id: z.number().int().positive() }))
		.handler(({ context, input }) => undoChange(context.appDb, input.id)),
};
