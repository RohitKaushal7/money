import { auth } from "@money/auth";
import type { Context as HonoContext } from "hono";
import { controlDb } from "./db";
import type { TokenVia } from "./mcp/meta";

export type CreateContextOptions = {
	context: HonoContext;
};

/** The screen-lock pass, carried per-request because the client only ever holds it in memory. */
export const UNLOCK_HEADER = "x-unlock-token";

type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

/**
 * Who is calling. A browser sign-in carries Better-Auth's whole session; a call made with an access token
 * (MCP, see `contextFor`) carries only the token's user, and has no `session` row — no id, expiry or
 * creation time — so anything that reads `session.session` has to handle its absence.
 */
export interface ContextSession {
	user: Pick<AuthSession["user"], "id" | "email" | "name"> & {
		role?: string | null;
	};
	session?: AuthSession["session"];
}

export async function createContext({ context }: CreateContextOptions) {
	const session: ContextSession | null = await auth.api.getSession({
		headers: context.req.raw.headers,
	});
	return {
		session,
		controlDb: controlDb(),
		unlockToken: context.req.raw.headers.get(UNLOCK_HEADER),
		// Supplied by the MCP handler; browser sessions never have it.
		via: undefined as TokenVia | undefined,
		// Set by bulk applies so one apply shares a change-log batch.
		batchId: undefined as string | undefined,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
