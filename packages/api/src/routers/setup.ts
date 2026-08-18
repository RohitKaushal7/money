import { auth } from "@money/auth";
import {
	type ControlDb,
	installMeta,
	SETUP_COMPLETED_AT,
	user,
} from "@money/db";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { publicProcedure } from "../index";
import { canCreateFirstAdmin } from "../setup";

/** Rejects a second concurrent createAdmin within this process — the count check alone has a TOCTOU gap. */
let creating = false;

/** Has this install ever completed first-run setup? Latched once, never cleared. */
async function setupCompleted(controlDb: ControlDb): Promise<boolean> {
	const rows = await controlDb
		.select({ key: installMeta.key })
		.from(installMeta)
		.where(eq(installMeta.key, SETUP_COMPLETED_AT))
		.limit(1);
	return rows.length > 0;
}

export const setupRouter = {
	/** "Does this install still need its owner account?" — unauthenticated, safe to call from a route guard. */
	status: publicProcedure.handler(async ({ context }) => {
		const [rows, done] = await Promise.all([
			context.controlDb.select({ id: user.id }).from(user).limit(1),
			setupCompleted(context.controlDb),
		]);
		return { needsSetup: canCreateFirstAdmin(rows.length, done) };
	}),

	/**
	 * Create the owner account on a fresh install. This is the ONLY path to a user with no admin session,
	 * and it welds shut the moment one user exists. `disableSignUp` stays true — the public signup endpoint
	 * is never involved. `auth.api.createUser` with NO headers skips the admin-plugin permission check (the
	 * same call `scripts/create-user.ts` uses) and fires the provisionUserApp hook, so the owner's per-user
	 * storage is created too.
	 *
	 * The `install_meta` latch is written in the same call, so deleting every account later does NOT reopen
	 * this endpoint — an empty user table is only "fresh" the first time.
	 */
	createAdmin: publicProcedure
		.input(
			z.object({
				name: z.string().min(1),
				email: z.email(),
				password: z.string().min(8),
			}),
		)
		.handler(async ({ input, context }) => {
			if (creating) {
				throw new ORPCError("CONFLICT", {
					message: "Setup already in progress.",
				});
			}
			creating = true;
			try {
				const [rows, done] = await Promise.all([
					context.controlDb.select({ id: user.id }).from(user).limit(1),
					setupCompleted(context.controlDb),
				]);
				if (!canCreateFirstAdmin(rows.length, done)) {
					throw new ORPCError("FORBIDDEN", {
						message: "Setup is already complete.",
					});
				}
				await auth.api.createUser({
					body: {
						name: input.name,
						email: input.email,
						password: input.password,
						role: "admin",
					},
				});
				// Latch AFTER the account exists: if createUser throws, setup must stay open.
				await context.controlDb
					.insert(installMeta)
					.values({
						key: SETUP_COMPLETED_AT,
						value: new Date().toISOString(),
					})
					.onConflictDoNothing();
				return { ok: true } as const;
			} finally {
				creating = false;
			}
		}),
};
