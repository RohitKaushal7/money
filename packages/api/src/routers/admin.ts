import { user } from "@money/db";
import { z } from "zod";

import { analyticsReady } from "../analytics";
import { controlDb } from "../db";
import { adminProcedure } from "../index";
import { runRetag } from "../ingest-runner";

export const adminRouter = {
	/**
	 * When each user last signed in, keyed by id.
	 *
	 * Separate from Better-Auth's `listUsers` rather than added to it: the admin plugin only serializes
	 * fields it's been told about, and reading the column straight from control.db keeps the shape of the
	 * answer ours — the source can change without touching the auth config.
	 */
	lastLogins: adminProcedure.handler(async () => {
		const rows = await controlDb()
			.select({ id: user.id, lastLoginAt: user.lastLoginAt })
			.from(user);
		return Object.fromEntries(
			rows.map((r) => [r.id, r.lastLoginAt ? r.lastLoginAt.getTime() : null]),
		) as Record<string, number | null>;
	}),
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
