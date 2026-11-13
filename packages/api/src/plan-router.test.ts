import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "./context";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "money-plan-router-"));
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";

const { createRouterClient } = await import("@orpc/server");
const { provisionUserApp } = await import("@money/db/migrate");
const { appRouter } = await import("./routers/index");
const { controlDb } = await import("./db");

const client = createRouterClient(appRouter, {
	context: {
		session: { user: { id: "plan-u" } },
		controlDb: controlDb(),
		unlockToken: null,
		via: undefined,
		batchId: undefined,
	} as unknown as Context,
});

beforeAll(async () => {
	await provisionUserApp("plan-u");
});

describe("plan.updateRecurring", () => {
	test("a partial edit leaves the stored cadence alone", async () => {
		const added = await client.plan.addRecurring({
			name: "Insurance",
			amount: 12000,
			cadence: "quarterly",
		});
		expect(added.cadence).toBe("quarterly");

		const updated = await client.plan.updateRecurring({
			id: Number(added.id),
			amount: 15000,
		});
		expect(updated?.amount).toBe(15000);
		expect(updated?.cadence).toBe("quarterly");
	});

	test("addRecurring still defaults cadence to monthly", async () => {
		const added = await client.plan.addRecurring({ name: "Rent", amount: 1 });
		expect(added.cadence).toBe("monthly");
	});
});
