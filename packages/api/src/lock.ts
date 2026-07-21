import { auth } from "@money/auth";
import { account, settings } from "@money/db";
import { and, eq } from "drizzle-orm";
import { appDbFor, controlDb } from "./db";
import { revokeAllFor } from "./lock-tokens";

/**
 * The screen lock: a 4-digit PIN between a friend at your keyboard and your balances.
 *
 * Not a security boundary against an attacker — your password is that. This is the second layer that makes
 * an already-signed-in browser useless to someone who wanders up to it. It is nonetheless enforced on the
 * *server*: while locked the API answers nothing, so there is no data in the page to reveal rather than a
 * panel drawn over data that's already there.
 *
 * Unlocking mints a token the client holds in a JS variable and nowhere else — not localStorage, not a
 * cookie. That is the whole mechanism behind "locked after a reload": a reload has to lose it. Anything
 * persisted would survive, and "locked on reload" would be a lie. See `lock-tokens.ts` for the passes
 * themselves; this file is the parts that need the database.
 */

const PIN_KEY = "lock.pin";

/** PIN hashes, cached per user so the lock check on every request isn't a query. Writes invalidate. */
const pinCache = new Map<string, string | null>();

export async function pinHashFor(uid: string): Promise<string | null> {
	const cached = pinCache.get(uid);
	if (cached !== undefined) return cached;
	const rows = await appDbFor(uid)
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, PIN_KEY));
	const value = rows[0]?.value;
	const hash = typeof value === "string" && value.length > 0 ? value : null;
	pinCache.set(uid, hash);
	return hash;
}

export async function hasPin(uid: string): Promise<boolean> {
	return (await pinHashFor(uid)) !== null;
}

/**
 * Hashed, not stored plain — and the reason isn't this app's threat model.
 *
 * A 4-digit PIN is exactly the kind people reuse for a phone or a bank card. Plain text would put that in
 * every database backup, which lives somewhere with very different exposure from the laptop this is meant
 * to guard.
 */
export async function verifyPin(uid: string, pin: string): Promise<boolean> {
	const hash = await pinHashFor(uid);
	if (!hash) return false;
	const ctx = await auth.$context;
	return ctx.password.verify({ password: pin, hash });
}

export async function setPin(uid: string, pin: string): Promise<void> {
	const ctx = await auth.$context;
	const hash = await ctx.password.hash(pin);
	await appDbFor(uid)
		.insert(settings)
		.values({ key: PIN_KEY, value: hash })
		.onConflictDoUpdate({ target: settings.key, set: { value: hash } });
	pinCache.set(uid, hash);
	// Changing the PIN shouldn't leave older tabs holding a pass minted under the previous one.
	revokeAllFor(uid);
}

export async function clearPin(uid: string): Promise<void> {
	await appDbFor(uid).delete(settings).where(eq(settings.key, PIN_KEY));
	pinCache.set(uid, null);
}

/** Verify the account password — the proof required to set or remove a PIN, and the way back in. */
export async function verifyAccountPassword(
	uid: string,
	password: string,
): Promise<boolean> {
	const rows = await controlDb()
		.select({ password: account.password })
		.from(account)
		.where(and(eq(account.userId, uid), eq(account.providerId, "credential")));
	const hash = rows[0]?.password;
	if (!hash) return false;
	const ctx = await auth.$context;
	return ctx.password.verify({ password, hash });
}
