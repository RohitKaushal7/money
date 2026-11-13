import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "./context";
import { migrateLiveControlDb } from "./testing/control-db";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "money-caller-errors-"));
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";

const { createRouterClient, ORPCError } = await import("@orpc/server");
const { provisionUserApp } = await import("@money/db/migrate");
const { appRouter } = await import("./routers/index");
const { controlDb } = await import("./db");

const UID = "caller-errors-u";

/**
 * A caller's mistake must reach the caller — and Claude, through /mcp — as a BAD_REQUEST with a message that
 * says what was wrong. A plain `Error` would be reported as "Internal server error".
 */
const client = createRouterClient(appRouter, {
	context: {
		session: { user: { id: UID, role: "admin" } },
		controlDb: controlDb(),
		unlockToken: null,
		via: undefined,
		batchId: undefined,
	} as unknown as Context,
});

beforeAll(async () => {
	await migrateLiveControlDb({ followDataDir: true });
	await provisionUserApp(UID);
});

async function rejection(p: Promise<unknown>) {
	try {
		await p;
	} catch (e) {
		return e as InstanceType<typeof ORPCError>;
	}
	throw new Error("expected the call to fail");
}

describe("caller mistakes are BAD_REQUEST with a useful message", () => {
	test("currency.setDisplay with a currency that is not enabled", async () => {
		const e = await rejection(client.currency.setDisplay({ code: "XYZ" }));
		expect(e).toBeInstanceOf(ORPCError);
		expect(e.code).toBe("BAD_REQUEST");
		expect(e.message).toContain("XYZ");
		expect(e.message).toContain("not enabled");
	});

	test("currency.setRate for INR", async () => {
		const e = await rejection(
			client.currency.setRate({ code: "INR", rateToInr: 2 }),
		);
		expect(e).toBeInstanceOf(ORPCError);
		expect(e.code).toBe("BAD_REQUEST");
		expect(e.message).toContain("INR");
	});

	for (const fy of ["2025-26", "FY25-26"]) {
		test(`a malformed FY label is refused by every tax procedure that takes one: ${fy}`, async () => {
			for (const call of [
				() => client.tax.suggestIncome({ fy }),
				() => client.tax.get({ fy }),
				() => client.tax.upsert({ fy }),
				() => client.tax.compute({ fy }),
				() => client.tax.finalize({ fy, regimeChoice: "new" }),
			]) {
				const e = await rejection(call());
				expect(e).toBeInstanceOf(ORPCError);
				expect(e.code).toBe("BAD_REQUEST");
				const issues = (e.data as { issues?: Array<{ message: string }> })
					?.issues;
				expect(issues?.[0]?.message).toContain('like "FY2025-26"');
			}
		});
	}

	test("tax.compute for a year the app has no tax rules for", async () => {
		const e = await rejection(client.tax.compute({ fy: "FY2019-20" }));
		expect(e).toBeInstanceOf(ORPCError);
		expect(e.code).toBe("BAD_REQUEST");
		expect(e.message).toContain("FY2019-20");
		expect(e.message).toContain("FY2025-26");
	});
});
