import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";
import { appDbFor } from "./db";

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

export const protectedProcedure = publicProcedure.use(requireAuth);
