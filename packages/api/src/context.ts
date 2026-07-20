import { auth } from "@money/auth";
import { env } from "@money/env/server";
import type { Context as HonoContext } from "hono";
import { appDbFor, controlDb } from "./db";

export type CreateContextOptions = {
	context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
	const session = await auth.api.getSession({
		headers: context.req.raw.headers,
	});
	// 1a seam: a single owner. Auth (1b) replaces this with `session?.user?.id`.
	const uid = env.OWNER_USER_ID ?? session?.user?.id ?? "owner";
	return {
		auth: null,
		session,
		uid,
		controlDb: controlDb(),
		appDb: appDbFor(uid),
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
