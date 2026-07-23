import { auth } from "@money/auth";
import { user } from "@money/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { publicProcedure } from "../index";
import { canCreateFirstAdmin } from "../setup";

/** Rejects a second concurrent createAdmin within this process — the count check alone has a TOCTOU gap. */
let creating = false;

export const setupRouter = {
	/** "Does this install still need its owner account?" — unauthenticated, safe to call from a route guard. */
	status: publicProcedure.handler(async ({ context }) => {
		const rows = await context.controlDb
			.select({ id: user.id })
			.from(user)
			.limit(1);
		return { needsSetup: canCreateFirstAdmin(rows.length) };
	}),

	/**
	 * Create the owner account on a fresh install. This is the ONLY path to a user with no admin session,
	 * and it welds shut the moment one user exists. `disableSignUp` stays true — the public signup endpoint
	 * is never involved. `auth.api.createUser` with NO headers skips the admin-plugin permission check (the
	 * same call `scripts/create-user.ts` uses) and fires the provisionUserApp hook, so the owner's per-user
	 * storage is created too.
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
				const rows = await context.controlDb
					.select({ id: user.id })
					.from(user)
					.limit(1);
				if (!canCreateFirstAdmin(rows.length)) {
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
				return { ok: true } as const;
			} finally {
				creating = false;
			}
		}),
};
