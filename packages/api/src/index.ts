import type { AppDb } from "@money/db";
import { ORPCError, os } from "@orpc/server";

import { idOf, type RawRow, readEntityRow, recordChange } from "./change-log";
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
 * Records every successful `kind: "write"` procedure in the user's change log — from the app and from
 * MCP alike. For writes to an `entity`, the row is read (raw) before and after so the write can be undone.
 *
 * Runs before input validation, so `input` is what the caller sent. Recording is best-effort: once the
 * write has succeeded, a failed audit insert is logged and swallowed rather than failing the request,
 * since the caller would otherwise retry a write that already happened.
 */
const logWrites = os
	.$context<Context & { appDb: AppDb }>()
	.$meta<McpMeta>({})
	.middleware(async ({ context, next, path, procedure }, input) => {
		const meta = mcpMetaOf(procedure);
		if (meta?.kind !== "write") {
			return next();
		}
		const entity = meta.entity;
		const inputId = idOf(input);
		let before: RawRow | null = null;
		if (entity && inputId !== undefined) {
			try {
				before = await readEntityRow(context.appDb, entity, inputId);
			} catch (e) {
				console.error("[change-log] reading the row before a write failed:", e);
			}
		}

		const result = await next();

		try {
			const outputId = idOf(result.output);
			// An insert's input has no id; one sent anyway is not the row written, so its `before` is not either.
			if (outputId !== undefined && outputId !== inputId) before = null;
			const entityId = entity ? (outputId ?? inputId) : undefined;
			const after =
				entity && entityId !== undefined
					? await readEntityRow(context.appDb, entity, entityId)
					: null;
			await recordChange(context.appDb, {
				batchId: context.batchId ?? crypto.randomUUID(),
				at: new Date(),
				source: context.via ? "mcp" : "app",
				tokenName: context.via?.name ?? null,
				procedure: path.join("."),
				input: input ?? {},
				entity: entity ?? null,
				entityId: entityId ?? null,
				before,
				after,
			});
		} catch (e) {
			console.error(`[change-log] recording ${path.join(".")} failed:`, e);
		}
		return result;
	});

export const protectedProcedure = authedProcedure
	.use(requireUnlocked)
	.use(logWrites);

const requireAdmin = o.middleware(async ({ context, next }) => {
	const role = (context.session?.user as { role?: string } | undefined)?.role;
	if (role !== "admin") {
		throw new ORPCError("FORBIDDEN");
	}
	return next();
});

export const adminProcedure = protectedProcedure.use(requireAdmin);
