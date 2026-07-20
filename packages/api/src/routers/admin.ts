import { z } from "zod";

import { analyticsReady } from "../analytics";
import { adminProcedure } from "../index";
import { runRetag } from "../ingest-runner";

export const adminRouter = {
	/** Re-tag a specific user's ledger (support: they added a rule / got stuck). */
	retagUser: adminProcedure
		.input(z.object({ uid: z.string().min(1) }))
		.handler(async ({ input }) => {
			const r = await runRetag(input.uid);
			return { ok: r.ok, result: r.result };
		}),
	/** Whether a user has an analytical DB yet. */
	ingestStatus: adminProcedure
		.input(z.object({ uid: z.string().min(1) }))
		.handler(({ input }) => ({ ready: analyticsReady(input.uid) })),
};
