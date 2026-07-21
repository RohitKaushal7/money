/**
 * Who currently holds a pass past the screen lock, and who has been guessing.
 *
 * Split from `lock.ts` — which needs the DB and Better-Auth — because this half is where a mistake actually
 * costs you: a token that outlives its expiry, or one user's pass opening another user's data. Keeping it
 * dependency-free means it can be tested for exactly those things.
 *
 * All state is in memory by design. Tokens are already per-page-load, so a server restart costing everyone
 * one PIN entry is the right trade for having no table, no cleanup, and no way for a stale row to hold a
 * lock open.
 */

/** A token is dropped by any reload, so this ceiling only bounds a tab left open for days. */
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * How new a session must be to be handed a pass without presenting the PIN.
 *
 * This is what keeps "I forgot my PIN" from being a dead end: signing out and back in lands you unlocked,
 * so you can clear the PIN in Settings. A login creates a *new* session; a reload reuses an old one — so
 * the session's own age separates the two, with no state to keep and nothing a server restart could reset
 * into granting everyone a free pass.
 *
 * A minute rather than a few seconds, because that escape route has to survive a slow first paint — a cold
 * container serving its first request can eat most of a short window, and a user who has forgotten their
 * PIN would then land back on the lock screen with nowhere left to go. Widening it costs nothing: claiming
 * inside the window still requires a session this new, and making one requires the password.
 */
const CLAIM_WINDOW_MS = 60 * 1000;

/** Four digits is 10 000 combinations — trivial to exhaust without a budget. */
const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 60 * 1000;

interface Grant {
	uid: string;
	expiresAt: number;
}

interface Attempts {
	count: number;
	cooldownUntil: number;
}

const grants = new Map<string, Grant>();
const attempts = new Map<string, Attempts>();

export function grantToken(uid: string, now = Date.now()): string {
	const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(
		/-/g,
		"",
	);
	grants.set(token, { uid, expiresAt: now + TOKEN_TTL_MS });
	return token;
}

export function revokeToken(token: string | null | undefined): void {
	if (token) grants.delete(token);
}

/** Every pass this user holds, in every tab. Used when the PIN changes. */
export function revokeAllFor(uid: string): void {
	for (const [token, grant] of grants) {
		if (grant.uid === uid) grants.delete(token);
	}
}

/**
 * Is this token a live pass *for this user*?
 *
 * The uid comparison is the load-bearing line: tokens are handed out per user, and a token that unlocked
 * anyone's data would make the lock worthless the moment two people shared a server.
 */
export function isUnlocked(
	uid: string,
	token: string | null | undefined,
	now = Date.now(),
): boolean {
	if (!token) return false;
	const grant = grants.get(token);
	if (!grant) return false;
	if (grant.expiresAt <= now) {
		grants.delete(token);
		return false;
	}
	return grant.uid === uid;
}

/** A session young enough to be one you just made by signing in. */
export function isFreshSession(
	createdAt: Date | null | undefined,
	now = Date.now(),
): boolean {
	if (!createdAt) return false;
	return now - createdAt.getTime() < CLAIM_WINDOW_MS;
}

/** Milliseconds until this user may try again; 0 when they may try now. */
export function cooldownRemaining(uid: string, now = Date.now()): number {
	const a = attempts.get(uid);
	if (!a) return 0;
	return Math.max(0, a.cooldownUntil - now);
}

/** Record a wrong PIN. Returns the cooldown this triggered, or 0 if they still have attempts left. */
export function noteFailure(uid: string, now = Date.now()): number {
	const a = attempts.get(uid) ?? { count: 0, cooldownUntil: 0 };
	a.count += 1;
	if (a.count >= MAX_ATTEMPTS) {
		a.cooldownUntil = now + COOLDOWN_MS;
		a.count = 0;
	}
	attempts.set(uid, a);
	return Math.max(0, a.cooldownUntil - now);
}

export function clearFailures(uid: string): void {
	attempts.delete(uid);
}

/** Test seam: drop all in-memory state. */
export function __resetLockState(): void {
	grants.clear();
	attempts.clear();
}
