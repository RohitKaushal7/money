import { auth } from "@money/auth";
import type { Context as HonoContext } from "hono";
import { controlDb } from "./db";

export type CreateContextOptions = {
	context: HonoContext;
};

/** The screen-lock pass, carried per-request because the client only ever holds it in memory. */
export const UNLOCK_HEADER = "x-unlock-token";

export async function createContext({ context }: CreateContextOptions) {
	const session = await auth.api.getSession({
		headers: context.req.raw.headers,
	});
	return {
		session,
		controlDb: controlDb(),
		unlockToken: context.req.raw.headers.get(UNLOCK_HEADER),
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
