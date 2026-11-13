import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "../context";
import { migrateLiveControlDb } from "../testing/control-db";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "money-mcp-coverage-"));
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";

const { createRouterClient } = await import("@orpc/server");
const { provisionUserApp } = await import("@money/db/migrate");
const { appRouter } = await import("../routers/index");
const { controlDb } = await import("../db");
const {
	MCP_EXCLUDED_PROCEDURES,
	MCP_EXCLUDED_ROUTERS,
	mcpMetaOf,
	walkProcedures,
} = await import("./meta");

const PLAN_WRITES: Record<string, { entity: string; operation: string }> = {
	"plan.addInvestment": { entity: "investments", operation: "insert" },
	"plan.updateInvestment": { entity: "investments", operation: "update" },
	"plan.deleteInvestment": { entity: "investments", operation: "delete" },
	"plan.addRecurring": { entity: "recurring_expenses", operation: "insert" },
	"plan.updateRecurring": { entity: "recurring_expenses", operation: "update" },
	"plan.deleteRecurring": { entity: "recurring_expenses", operation: "delete" },
};

const all = walkProcedures(appRouter);
const isExcluded = (path: string[]) =>
	(MCP_EXCLUDED_ROUTERS as readonly string[]).includes(path[0] ?? "") ||
	(MCP_EXCLUDED_PROCEDURES as readonly string[]).includes(path.join("."));
const inScope = all.filter(({ path }) => !isExcluded(path));
const excluded = all.filter(({ path }) => isExcluded(path));

describe("MCP descriptions", () => {
	test("the walk finds procedures in every router", () => {
		expect(inScope.length).toBeGreaterThan(50);
		expect(excluded.length).toBeGreaterThan(0);
	});

	for (const { path, procedure } of inScope) {
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

	for (const { path, procedure } of excluded) {
		test(`${path.join(".")} is excluded and carries no mcp meta`, () => {
			expect(mcpMetaOf(procedure)).toBeUndefined();
		});
	}
});

describe("shared currency rates are admin-only", () => {
	beforeAll(async () => {
		await migrateLiveControlDb({ followDataDir: true });
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

	test("an admin can set a rate", async () => {
		// XTS is ISO 4217's code for testing; disabled, so no display list in another test file sees it.
		const admin = as("admin");
		await admin.currency.upsert({ code: "XTS", symbol: "T", enabled: false });
		const after = await admin.currency.setRate({
			code: "XTS",
			rateToInr: 91.25,
		});
		expect(after.currencies.find((c) => c.code === "XTS")?.rateToInr).toBe(
			91.25,
		);
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
