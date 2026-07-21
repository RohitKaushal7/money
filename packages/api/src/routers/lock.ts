import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { authedProcedure, protectedProcedure } from "../index";
import {
	clearPin,
	hasPin,
	setPin,
	verifyAccountPassword,
	verifyPin,
} from "../lock";
import {
	clearFailures,
	cooldownRemaining,
	grantToken,
	isFreshSession,
	noteFailure,
	revokeToken,
} from "../lock-tokens";

const pin = z.string().regex(/^\d{4}$/, "A PIN is exactly four digits.");

/**
 * The screen lock.
 *
 * `claim`, `unlock` and `lock` are `authedProcedure` — signed in but not past the lock — because they are
 * the only calls that must work *while* locked. Everything that changes the PIN is `protectedProcedure`,
 * so a locked screen can't reconfigure the lock even with the password: the way back from a forgotten PIN
 * is signing out, not arguing with the lock screen.
 */
export const lockRouter = {
	/**
	 * What the app asks on load: is a PIN set, and may I have a pass without presenting it?
	 *
	 * A token comes back only for a session created moments ago, i.e. one you just made by signing in.
	 * Reloading reuses an older session and gets nothing, which is what makes a reload re-lock.
	 */
	/** Is a PIN configured? Separate from {@link claim}, which mints a pass and must not be a polled read. */
	status: protectedProcedure.handler(async ({ context }) => ({
		configured: await hasPin(context.session?.user.id as string),
	})),

	claim: authedProcedure.handler(async ({ context }) => {
		const uid = context.session?.user.id as string;
		if (!(await hasPin(uid))) return { configured: false, token: null };
		const fresh = isFreshSession(context.session?.session.createdAt);
		return {
			configured: true,
			token: fresh ? grantToken(uid) : null,
		};
	}),

	unlock: authedProcedure
		.input(z.object({ pin }))
		.handler(async ({ context, input }) => {
			const uid = context.session?.user.id as string;

			const cooling = cooldownRemaining(uid);
			if (cooling > 0) {
				throw new ORPCError("TOO_MANY_REQUESTS", {
					message: `Too many attempts. Try again in ${Math.ceil(cooling / 1000)}s.`,
				});
			}

			if (!(await verifyPin(uid, input.pin))) {
				const wait = noteFailure(uid);
				throw new ORPCError("UNAUTHORIZED", {
					message: wait
						? `Wrong PIN. Too many attempts — try again in ${Math.ceil(wait / 1000)}s.`
						: "Wrong PIN.",
				});
			}

			clearFailures(uid);
			return { token: grantToken(uid) };
		}),

	/** Lock now (⇧L). Invalidating server-side matters: dropping the token client-side alone would leave a
	 *  live pass that anything replaying the header could still use. */
	lock: authedProcedure.handler(({ context }) => {
		revokeToken(context.unlockToken);
		return { ok: true };
	}),

	/**
	 * Set or change the PIN, proven with the account password.
	 *
	 * The password rather than the old PIN: it makes "I forgot my PIN" a route that already exists — sign
	 * out, sign in, change it — and it stops someone who finds the screen already unlocked from quietly
	 * changing the PIN and locking you out of your own machine.
	 */
	setPin: protectedProcedure
		.input(z.object({ password: z.string().min(1), pin }))
		.handler(async ({ context, input }) => {
			const uid = context.session?.user.id as string;
			if (!(await verifyAccountPassword(uid, input.password))) {
				throw new ORPCError("UNAUTHORIZED", {
					message: "That's not your password.",
				});
			}
			await setPin(uid, input.pin);
			return { ok: true };
		}),

	clearPin: protectedProcedure
		.input(z.object({ password: z.string().min(1) }))
		.handler(async ({ context, input }) => {
			const uid = context.session?.user.id as string;
			if (!(await verifyAccountPassword(uid, input.password))) {
				throw new ORPCError("UNAUTHORIZED", {
					message: "That's not your password.",
				});
			}
			await clearPin(uid);
			return { ok: true };
		}),
};
