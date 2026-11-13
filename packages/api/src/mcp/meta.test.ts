import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpMetaOf, pinApplies } from "./meta";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "money-meta-"));
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0";
const { o } = await import("../index");

describe("pinApplies", () => {
	test("applies to cookie sessions", () => {
		expect(pinApplies({})).toBe(true);
	});
	test("does not apply to token contexts", () => {
		expect(
			pinApplies({
				via: { kind: "token", tokenId: 1, name: "t", scope: "read" },
			}),
		).toBe(false);
	});
});

describe("mcpMetaOf", () => {
	test("reads the mcp metadata off a procedure", () => {
		const p = o
			.meta({ mcp: { description: "d", kind: "read" } })
			.handler(() => 1);
		expect(mcpMetaOf(p)).toEqual({ description: "d", kind: "read" });
	});
	test("is undefined without metadata", () => {
		expect(mcpMetaOf(o.handler(() => 1))).toBeUndefined();
	});
});
