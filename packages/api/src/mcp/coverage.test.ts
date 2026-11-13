import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "../context";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "money-mcp-coverage-"));
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";

const { createRouterClient } = await import("@orpc/server");
const { provisionUserApp } = await import("@money/db/migrate");
const { appRouter } = await import("../routers/index");
const { controlDb } = await import("../db");
const { mcpMetaOf, walkProcedures } = await import("./meta");

const WEALTH_ROUTERS = [
	"plan",
	"networth",
	"currency",
	"tax",
	"reconcile",
	"cards",
	"accounts",
];

const PLAN_WRITES: Record<string, { entity: string; operation: string }> = {
	"plan.addInvestment": { entity: "investments", operation: "insert" },
	"plan.updateInvestment": { entity: "investments", operation: "update" },
	"plan.deleteInvestment": { entity: "investments", operation: "delete" },
	"plan.addRecurring": { entity: "recurring_expenses", operation: "insert" },
	"plan.updateRecurring": { entity: "recurring_expenses", operation: "update" },
	"plan.deleteRecurring": { entity: "recurring_expenses", operation: "delete" },
};

const wealth = walkProcedures(appRouter).filter(({ path }) =>
	WEALTH_ROUTERS.includes(path[0] ?? ""),
);

describe("wealth-side MCP descriptions", () => {
	test("the walk finds procedures in every wealth router", () => {
		for (const r of WEALTH_ROUTERS) {
			expect(wealth.some(({ path }) => path[0] === r)).toBe(true);
		}
	});

	for (const { path, procedure } of wealth) {
		const name = path.join(".");
		test(`${name} is described`, () => {
			const meta = mcpMetaOf(procedure);
			expect(meta).toBeDefined();
			expect(meta?.description.length).toBeGreaterThanOrEqual(40);
			expect(["read", "write"]).toContain(meta?.kind as string);
			const undoable = PLAN_WRITES[name];
			if (undoable) {
				expect(meta?.kind).toBe("write");
				expect(meta?.entity).toBe(undoable.entity as never);
				expect(meta?.operation).toBe(undoable.operation as never);
			} else {
				expect(meta?.entity).toBeUndefined();
				expect(meta?.operation).toBeUndefined();
			}
		});
	}
});

describe("shared currency rates are admin-only", () => {
	beforeAll(async () => {
		await provisionUserApp("rate-u");
	});

	const as = (role: string) =>
		createRouterClient(appRouter, {
			context: {
				session: { user: { id: "rate-u", role } },
				controlDb: controlDb(),
				unlockToken: null,
				via: undefined,
				batchId: undefined,
			} as unknown as Context,
		});

	test("a non-admin cannot set a rate", async () => {
		await expect(
			as("user").currency.setRate({ code: "USD", rateToInr: 90 }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	test("a non-admin cannot upsert or refresh", async () => {
		await expect(
			as("user").currency.upsert({ code: "USD", symbol: "$" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(as("user").currency.refresh()).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});
});
