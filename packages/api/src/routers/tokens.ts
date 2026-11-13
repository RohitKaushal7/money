import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { controlDb } from "../db";
import { protectedProcedure } from "../index";
import { createToken, listTokens, revokeToken } from "../tokens";

/**
 * Deliberately carries NO `mcp` metadata: Claude must never be able to mint or revoke its own tokens.
 * The plaintext token and hash never leave in a list — only the prefix.
 */
export const tokensRouter = {
	list: protectedProcedure.handler(async ({ context }) => {
		const rows = await listTokens(controlDb(), context.uid);
		return rows.map(({ tokenHash: _hash, ...rest }) => rest);
	}),
	create: protectedProcedure
		.input(
			z.object({
				name: z.string().trim().min(1).max(80),
				scope: z.enum(["read", "read_write"]),
				expiresAt: z.coerce.date().optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "The expiry date is in the past — pick a later date.",
				});
			}
			const { token, row } = await createToken(controlDb(), context.uid, input);
			const { tokenHash: _hash, ...safe } = row;
			return { token, row: safe };
		}),
	revoke: protectedProcedure
		.input(z.object({ id: z.number().int() }))
		.handler(async ({ context, input }) => ({
			ok: await revokeToken(controlDb(), context.uid, input.id),
		})),
};
