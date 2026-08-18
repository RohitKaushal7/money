import { describe, expect, test } from "bun:test";
import { canCreateFirstAdmin } from "./setup";

describe("canCreateFirstAdmin", () => {
	test("allows the first admin only when no users exist", () => {
		expect(canCreateFirstAdmin(0, false)).toBe(true);
	});

	test("refuses once any user exists", () => {
		expect(canCreateFirstAdmin(1, false)).toBe(false);
		expect(canCreateFirstAdmin(5, false)).toBe(false);
	});

	// The reason the latch exists: deleting every account empties the user table, and a count-only check
	// would read that as a fresh install and re-open the unauthenticated create-an-admin endpoint.
	test("stays shut on an emptied install once setup has completed", () => {
		expect(canCreateFirstAdmin(0, true)).toBe(false);
	});

	test("the latch dominates regardless of user count", () => {
		expect(canCreateFirstAdmin(3, true)).toBe(false);
	});
});
