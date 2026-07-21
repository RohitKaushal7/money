import { useSyncExternalStore } from "react";

/**
 * Where the screen-lock pass lives: a module variable, and nowhere else.
 *
 * Not localStorage, not sessionStorage, not a cookie — all three survive a reload, and "locked after a
 * reload" would then be a claim the code doesn't back. A reload tears down this module; the token dies with
 * it; the next load has to ask again. That's the entire mechanism.
 *
 * Deliberately free of app imports so `utils/orpc` can read the token for its request header without the
 * two modules importing each other.
 */

export type LockState =
	/** haven't asked the server yet — render nothing rather than a flash of either state */
	| "checking"
	/** no PIN configured, or we hold a valid pass */
	| "open"
	/** a PIN is set and we have no pass */
	| "locked";

let token: string | null = null;
let state: LockState = "checking";

const listeners = new Set<() => void>();

function notify() {
	for (const fn of listeners) fn();
}

/** The pass to send with API calls. `null` while locked or still checking. */
export function unlockToken(): string | null {
	return token;
}

export function openLock(newToken: string | null): void {
	token = newToken;
	state = "open";
	notify();
}

export function closeLock(): void {
	token = null;
	state = "locked";
	notify();
}

function subscribe(onChange: () => void): () => void {
	listeners.add(onChange);
	return () => {
		listeners.delete(onChange);
	};
}

export function useLockState(): LockState {
	return useSyncExternalStore(
		subscribe,
		() => state,
		() => "checking" as const,
	);
}
