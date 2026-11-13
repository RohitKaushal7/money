import type { AppDb } from "@money/db";
import { ORPCError, os } from "@orpc/server";

import {
	idOf,
	type NewChange,
	type RawRow,
	readEntityRow,
	recordChange,
} from "./change-log";
import type { Context } from "./context";
import { appDbFor } from "./db";
import { hasPin } from "./lock";
import { isUnlocked } from "./lock-tokens";
import { type McpMeta, mcpMetaOf, pinApplies } from "./mcp/meta";

export const o = os.$context<Context>().$meta<McpMeta>({});

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
	// Token contexts (MCP) are not behind the screen lock.
	if (!pinApplies(context)) {
		return next();
	}
	// No PIN configured is the default and the common case: nothing is ever locked, and the check costs one
	// cached lookup.
	if (uid && (await hasPin(uid)) && !isUnlocked(uid, context.unlockToken)) {
		throw new ORPCError("LOCKED", {
			message: "Locked — enter your PIN to continue.",
		});
	}
	return next();
});

/**
 * A read-only access token can't run a write. `/mcp` already refuses a write tool for such a token before
 * calling it; this is the same rule where every procedure call passes, so a write reached some other way
 * (a nested router client, a tool added later) is refused before its handler runs. Browser sessions have
 * no `via` and are unaffected.
 */
const requireWriteScope = o.middleware(
	async ({ context, next, path, procedure }) => {
		if (
			context.via?.scope === "read" &&
			mcpMetaOf(procedure)?.kind === "write"
		) {
			throw new ORPCError("FORBIDDEN", {
				message: `This access token is read-only (scope "read"): ${path.join(".")} changes data, so it needs a token with scope "read_write". Nothing was changed.`,
			});
		}
		return next();
	},
);

/**
 * Records every successful `kind: "write"` procedure in the user's change log — from the app and from
 * MCP alike. A write whose meta names an `entity` and `operation` also gets the raw row before and after,
 * which is what makes it undoable.
 *
 * This middleware runs ahead of oRPC's own input validation, so it parses the input with the procedure's
 * schema itself: ids are read — and the input logged — exactly as the handler will see them (`[5]` or
 * `true` coerce to an id just as they do for the handler). Input that fails to parse goes straight on to
 * oRPC, which rejects it, so nothing is written and nothing logged.
 *
 * Recording is best-effort: once the write has succeeded, a failed audit insert is logged and swallowed
 * rather than failing the request, since the caller would otherwise retry a write that already happened.
 * If a row can't be read, the entry is still written, but without its entity (audit only, not undoable) —
 * never with a missing `before` that undo could misread.
 */
const logWrites = os
	.$context<Context & { appDb: AppDb }>()
	.$meta<McpMeta>({})
	.middleware(async ({ context, next, path, procedure }, rawInput) => {
		const meta = mcpMetaOf(procedure);
		if (meta?.kind !== "write") {
			return next();
		}
		const schema = procedure["~orpc"].inputSchema;
		let input: unknown = rawInput;
		if (schema) {
			const parsed = await schema["~standard"].validate(rawInput);
			if (parsed.issues) return next();
			input = parsed.value;
		}

		const target =
			meta.entity && meta.operation
				? { entity: meta.entity, operation: meta.operation }
				: undefined;
		const inputId = idOf(input);
		let undoable = target !== undefined;
		let before: RawRow | null = null;
		if (target && target.operation !== "insert") {
			if (inputId === undefined) {
				undoable = false;
			} else {
				try {
					before = await readEntityRow(context.appDb, target.entity, inputId);
				} catch (e) {
					undoable = false;
					console.error(
						"[change-log] reading the row before a write failed:",
						e,
					);
				}
			}
		}

		const result = await next();

		try {
			let undo: Pick<
				NewChange,
				"entity" | "operation" | "entityId" | "before" | "after"
			> = {};
			if (target && undoable) {
				const entityId =
					target.operation === "insert" ? idOf(result.output) : inputId;
				try {
					if (entityId !== undefined) {
						const after = await readEntityRow(
							context.appDb,
							target.entity,
							entityId,
						);
						undo = { ...target, entityId, before, after };
					}
				} catch (e) {
					console.error(
						"[change-log] reading the row after a write failed:",
						e,
					);
				}
			}
			await recordChange(context.appDb, {
				batchId: context.batchId ?? crypto.randomUUID(),
				at: new Date(),
				source: context.via ? "mcp" : "app",
				tokenName: context.via?.name ?? null,
				procedure: path.join("."),
				input: input ?? {},
				...undo,
			});
		} catch (e) {
			console.error(`[change-log] recording ${path.join(".")} failed:`, e);
		}
		return result;
	});

export const protectedProcedure = authedProcedure
	.use(requireUnlocked)
	.use(requireWriteScope)
	.use(logWrites);

const requireAdmin = o.middleware(async ({ context, next }) => {
	if (context.session?.user.role !== "admin") {
		throw new ORPCError("FORBIDDEN");
	}
	return next();
});

export const adminProcedure = protectedProcedure.use(requireAdmin);
