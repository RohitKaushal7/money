import { describe, expect, test } from "bun:test";
import { canCreateFirstAdmin } from "./setup";

describe("canCreateFirstAdmin", () => {
	test("allows the first admin only when no users exist", () => {
		expect(canCreateFirstAdmin(0)).toBe(true);
	});

	test("refuses once any user exists", () => {
		expect(canCreateFirstAdmin(1)).toBe(false);
		expect(canCreateFirstAdmin(5)).toBe(false);
	});
});
