import type { AppDb } from "@money/db";
import { ORPCError, os } from "@orpc/server";

import {
	idOf,
	type NewChange,
	type RawRow,
	readEntityRow,
	recordChange,
	withEntityLock,
} from "./change-log";
import type { Context } from "./context";
import { appDbFor } from "./db";
import { hasPin } from "./lock";
import { isUnlocked } from "./lock-tokens";
import { isMcpExcluded, type McpMeta, mcpMetaOf, pinApplies } from "./mcp/meta";

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
/**
 * What an access token (MCP) may call — default-deny, on the procedure itself rather than only at `/mcp`:
 * only a procedure offered to Claude (it has `mcp` meta and isn't excluded), and under a `read` token only
 * one whose kind is `read`. Everything else — the tokens router above all, so Claude can never mint or
 * revoke a token, but also the lock, admin and anything added later without a description — is refused
 * before its handler runs, however the call got here (a router client built under a token context, as
 * update_holdings does, included). Browser sessions have no `via` and are unaffected.
 */
const requireTokenAccess = o.middleware(
	async ({ context, next, path, procedure }) => {
		const via = context.via;
		if (!via) return next();
		const meta = mcpMetaOf(procedure);
		const name = path.join(".") || "this procedure";
		if (!meta || isMcpExcluded(path)) {
			throw new ORPCError("FORBIDDEN", {
				message: `${name} is not available to access tokens.`,
			});
		}
		if (via.scope === "read" && meta.kind !== "read") {
			throw new ORPCError("FORBIDDEN", {
				message: `This access token is read-only (scope "read"): ${name} changes data, so it needs a token with scope "read_write". Nothing was changed.`,
			});
		}
		return next();
	},
);

export const authedProcedure = publicProcedure
	.use(requireAuth)
	.use(requireTokenAccess);

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
 * Records every successful `kind: "write"` procedure in the user's change log — from the app and from
 * MCP alike. A write whose meta names an `entity` and `operation` also gets the raw row before and after,
 * which is what makes it undoable.
 *
 * This middleware runs ahead of oRPC's own input validation, so it parses the input with the procedure's
 * schema itself: ids are read — and the input logged — exactly as the handler will see them (`[5]` or
 * `true` coerce to an id just as they do for the handler). Input that fails to parse goes straight on to
 * oRPC, which rejects it, so nothing is written and nothing logged. oRPC then parses the raw input a
 * second time for the handler, so a schema with a non-deterministic default (`.default(() => new
 * Date())`, a random id) would log a different value from the one the handler used. No write schema has
 * one today; give a write such a default and its logged input stops being exact.
 *
 * An undoable write holds the user's entity lock ({@link withEntityLock}) from the before-read through the
 * handler to the after-read and the log insert, so two writes to the same user's holdings or expenses —
 * parallel MCP calls, or the app and Claude at once — can't interleave and log each other's rows. The
 * handler of such a write must not call another entity write for the same user (the lock isn't
 * re-entrant).
 *
 * Recording is best-effort: once the write has succeeded, a failed audit insert is logged and swallowed
 * rather than failing the request, since the caller would otherwise retry a write that already happened.
 * If a row can't be read, the entry is still written, but without its entity (audit only, not undoable) —
 * never with a missing `before` that undo could misread. A write that throws is not logged: handlers that
 * write more than once do so in one transaction, so a failed write has changed nothing.
 */
const logWrites = os
	.$context<Context & { appDb: AppDb; uid: string }>()
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

		const writeAndLog = async () => {
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
					tokenId: context.via?.tokenId ?? null,
					procedure: path.join("."),
					input: input ?? {},
					...undo,
				});
			} catch (e) {
				console.error(`[change-log] recording ${path.join(".")} failed:`, e);
			}
			return result;
		};

		return target ? withEntityLock(context.uid, writeAndLog) : writeAndLog();
	});

export const protectedProcedure = authedProcedure
	.use(requireUnlocked)
	.use(logWrites);

const requireAdmin = o.middleware(async ({ context, next }) => {
	if (context.session?.user.role !== "admin") {
		throw new ORPCError("FORBIDDEN");
	}
	return next();
});

export const adminProcedure = protectedProcedure.use(requireAdmin);
