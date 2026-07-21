import { beforeEach, describe, expect, test } from "bun:test";
import {
	__resetLockState,
	clearFailures,
	cooldownRemaining,
	grantToken,
	isFreshSession,
	isUnlocked,
	noteFailure,
	revokeAllFor,
	revokeToken,
} from "./lock-tokens";

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-07-21T12:00:00Z");

beforeEach(() => {
	__resetLockState();
});

describe("passes", () => {
	test("a freshly minted token unlocks its own user", () => {
		const token = grantToken("alice", T0);
		expect(isUnlocked("alice", token, T0)).toBe(true);
	});

	test("one user's token does not unlock another's data", () => {
		const token = grantToken("alice", T0);
		expect(isUnlocked("bob", token, T0)).toBe(false);
	});

	test("no token means locked", () => {
		expect(isUnlocked("alice", null)).toBe(false);
		expect(isUnlocked("alice", undefined)).toBe(false);
		expect(isUnlocked("alice", "")).toBe(false);
	});

	test("an invented token is not a pass", () => {
		grantToken("alice", T0);
		expect(isUnlocked("alice", "deadbeef".repeat(8), T0)).toBe(false);
	});

	test("tokens are unique per mint", () => {
		const seen = new Set(
			Array.from({ length: 50 }, () => grantToken("alice", T0)),
		);
		expect(seen.size).toBe(50);
	});

	test("a token expires, and stops working the moment it does", () => {
		const token = grantToken("alice", T0);
		expect(isUnlocked("alice", token, T0 + 11 * HOUR)).toBe(true);
		// exactly at expiry counts as expired — a pass that works "at" its deadline is a pass with no deadline
		expect(isUnlocked("alice", token, T0 + 12 * HOUR)).toBe(false);
		expect(isUnlocked("alice", token, T0 + 13 * HOUR)).toBe(false);
	});

	test("an expired token stays dead even if time is asked about again", () => {
		const token = grantToken("alice", T0);
		isUnlocked("alice", token, T0 + 13 * HOUR); // evicts it
		expect(isUnlocked("alice", token, T0)).toBe(false);
	});

	test("revoking one token leaves the user's other tabs alone", () => {
		const a = grantToken("alice", T0);
		const b = grantToken("alice", T0);
		revokeToken(a);
		expect(isUnlocked("alice", a, T0)).toBe(false);
		expect(isUnlocked("alice", b, T0)).toBe(true);
	});

	test("changing the PIN revokes every pass that user holds, and nobody else's", () => {
		const a1 = grantToken("alice", T0);
		const a2 = grantToken("alice", T0);
		const b1 = grantToken("bob", T0);
		revokeAllFor("alice");
		expect(isUnlocked("alice", a1, T0)).toBe(false);
		expect(isUnlocked("alice", a2, T0)).toBe(false);
		expect(isUnlocked("bob", b1, T0)).toBe(true);
	});

	test("revoking null is a no-op, not a crash", () => {
		const token = grantToken("alice", T0);
		revokeToken(null);
		revokeToken(undefined);
		expect(isUnlocked("alice", token, T0)).toBe(true);
	});
});

describe("the free pass after signing in", () => {
	test("a session made seconds ago gets one", () => {
		expect(isFreshSession(new Date(T0 - 2000), T0)).toBe(true);
	});

	test("a session from earlier does not — this is what makes a reload re-lock", () => {
		expect(isFreshSession(new Date(T0 - 5 * 60_000), T0)).toBe(false);
		expect(isFreshSession(new Date(T0 - 8 * HOUR), T0)).toBe(false);
	});

	test("the window is wide enough to survive a slow first paint", () => {
		expect(isFreshSession(new Date(T0 - 20_000), T0)).toBe(true);
		expect(isFreshSession(new Date(T0 - 45_000), T0)).toBe(true);
	});

	test("the boundary is closed at 60s", () => {
		expect(isFreshSession(new Date(T0 - 59_999), T0)).toBe(true);
		expect(isFreshSession(new Date(T0 - 60_000), T0)).toBe(false);
	});

	test("no session date is not a free pass", () => {
		expect(isFreshSession(null, T0)).toBe(false);
		expect(isFreshSession(undefined, T0)).toBe(false);
	});
});

describe("guessing budget", () => {
	test("four wrong PINs still allow a fifth try", () => {
		for (let i = 0; i < 4; i += 1) expect(noteFailure("alice", T0)).toBe(0);
		expect(cooldownRemaining("alice", T0)).toBe(0);
	});

	test("the fifth starts a cooldown", () => {
		for (let i = 0; i < 4; i += 1) noteFailure("alice", T0);
		expect(noteFailure("alice", T0)).toBe(60_000);
		expect(cooldownRemaining("alice", T0)).toBe(60_000);
	});

	test("the cooldown counts down and then clears", () => {
		for (let i = 0; i < 5; i += 1) noteFailure("alice", T0);
		expect(cooldownRemaining("alice", T0 + 30_000)).toBe(30_000);
		expect(cooldownRemaining("alice", T0 + 60_000)).toBe(0);
		expect(cooldownRemaining("alice", T0 + 90_000)).toBe(0);
	});

	test("one user's cooldown doesn't lock out another", () => {
		for (let i = 0; i < 5; i += 1) noteFailure("alice", T0);
		expect(cooldownRemaining("bob", T0)).toBe(0);
	});

	test("a correct PIN clears the record, so the next slip starts from five again", () => {
		for (let i = 0; i < 4; i += 1) noteFailure("alice", T0);
		clearFailures("alice");
		for (let i = 0; i < 4; i += 1) expect(noteFailure("alice", T0)).toBe(0);
	});

	test("guessing through a cooldown re-arms it rather than resetting the budget", () => {
		for (let i = 0; i < 5; i += 1) noteFailure("alice", T0);
		// keep hammering after the wait: the next five failures cost another minute
		for (let i = 0; i < 4; i += 1) noteFailure("alice", T0 + 60_000);
		expect(noteFailure("alice", T0 + 60_000)).toBe(60_000);
	});

	test("an untouched user has no cooldown", () => {
		expect(cooldownRemaining("nobody", T0)).toBe(0);
	});
});
