import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "./context";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "money-tax-upsert-"));
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";

const { createRouterClient } = await import("@orpc/server");
const { provisionUserApp } = await import("@money/db/migrate");
const { appRouter } = await import("./routers/index");
const { controlDb } = await import("./db");

const uid = "tax-upsert-u";
const app = createRouterClient(appRouter, {
	context: {
		session: { user: { id: uid } },
		controlDb: controlDb(),
		unlockToken: null,
		via: undefined,
		batchId: undefined,
		entityLockHeld: false,
	} as unknown as Context,
});

beforeAll(async () => {
	await provisionUserApp(uid);
});

// What the tax.upsert description promises about null and the two objects.
describe("tax.upsert", () => {
	const fy = "FY2025-26";

	test("null clears a scalar field; an omitted one keeps its value", async () => {
		await app.tax.upsert({ fy, salaryIncome: 100, rentPaid: 50 });
		const saved = await app.tax.upsert({ fy, salaryIncome: null });
		expect(saved?.salaryIncome).toBeNull();
		expect(saved?.rentPaid).toBe(50);
	});

	test("capitalGains and deductions replace the whole object, unspecified keys becoming 0", async () => {
		await app.tax.upsert({
			fy,
			capitalGains: {
				equityStcg: 1,
				equityLtcg: 2,
				crypto: 3,
				otherStcg: 4,
				otherLtcg: 5,
			},
		});
		const saved = await app.tax.upsert({ fy, capitalGains: { crypto: 9 } });
		expect(saved?.capitalGains).toEqual({
			equityStcg: 0,
			equityLtcg: 0,
			crypto: 9,
			otherStcg: 0,
			otherLtcg: 0,
		});
	});

	test("capitalGains and deductions can't be null", async () => {
		for (const field of ["capitalGains", "deductions"]) {
			await expect(
				app.tax.upsert({ fy, [field]: null } as never),
			).rejects.toThrow(/Input validation failed/);
		}
	});
});
