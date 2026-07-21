import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";
import { appDbFor } from "./db";
import { hasPin } from "./lock";
import { isUnlocked } from "./lock-tokens";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
	const user = context.session?.user;
	if (!user) {
		throw new ORPCError("UNAUTHORIZED");
	}
	return next({
		context: {
			session: context.session,
			uid: user.id,
			appDb: appDbFor(user.id),
		},
	});
});

/**
 * Signed in, but NOT past the screen lock.
 *
 * Only the lock router itself may use this — it has to be reachable while locked in order to unlock. Every
 * other procedure uses {@link protectedProcedure}, so the lock is opt-*out*: a router added later is
 * covered by default, and forgetting is a compile-time choice rather than a silent hole.
 */
export const authedProcedure = publicProcedure.use(requireAuth);

const requireUnlocked = o.middleware(async ({ context, next }) => {
	const uid = context.session?.user.id;
	// No PIN configured is the default and the common case: nothing is ever locked, and the check costs one
	// cached lookup.
	if (uid && (await hasPin(uid)) && !isUnlocked(uid, context.unlockToken)) {
		throw new ORPCError("LOCKED", {
			message: "Locked — enter your PIN to continue.",
		});
	}
	return next();
});

export const protectedProcedure = authedProcedure.use(requireUnlocked);

const requireAdmin = o.middleware(async ({ context, next }) => {
	const role = (context.session?.user as { role?: string } | undefined)?.role;
	if (role !== "admin") {
		throw new ORPCError("FORBIDDEN");
	}
	return next();
});

export const adminProcedure = protectedProcedure.use(requireAdmin);
