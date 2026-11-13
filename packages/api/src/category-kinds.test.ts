import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "./context";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "money-category-kinds-"));
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";

const { createRouterClient } = await import("@orpc/server");
const { provisionUserApp } = await import("@money/db/migrate");
const { changeLog } = await import("@money/db");
const { appRouter } = await import("./routers/index");
const { appDbFor, controlDb } = await import("./db");
const { mcpMetaOf } = await import("./mcp/meta");

const uid = "category-kinds-u";
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
const logSize = async () =>
	(await appDbFor(uid).select().from(changeLog)).length;

let custom = "";
beforeAll(async () => {
	await provisionUserApp(uid);
	const row = await app.categories.create({
		label: "Side Hustle",
		kind: "active_income",
	});
	custom = row?.key ?? "";
	expect(custom).toBe("side_hustle");
});

describe("overrides.set takes the kind from the owner's categories", () => {
	test("a custom category gets its own kind", async () => {
		await app.overrides.set({ txnId: "T-custom", categoryKey: custom });
		const row = (await app.overrides.list()).find(
			(o) => o.txnId === "T-custom",
		);
		expect(row?.overrideKind).toBe("active_income");
	});

	test("a built-in category keeps its built-in kind", async () => {
		await app.overrides.set({ txnId: "T-builtin", categoryKey: "rent" });
		const row = (await app.overrides.list()).find(
			(o) => o.txnId === "T-builtin",
		);
		expect(row?.overrideKind).toBe("expense");
	});

	test("an unknown key is refused, naming it, and writes nothing", async () => {
		await app.overrides.set({ txnId: "T-keep", categoryKey: "rent" });
		const before = await logSize();
		await expect(
			app.overrides.set({ txnId: "T-keep", categoryKey: "no_such_key" }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: expect.stringContaining('"no_such_key"'),
		});
		await expect(
			app.overrides.set({ txnId: "T-new", categoryKey: "no_such_key" }),
		).rejects.toThrow(/no_such_key/);
		const rows = await app.overrides.list();
		expect(rows.find((o) => o.txnId === "T-keep")?.overrideCategoryKey).toBe(
			"rent",
		);
		expect(rows.find((o) => o.txnId === "T-new")).toBeUndefined();
		expect(await logSize()).toBe(before);
	});
});

describe("splits.set takes each line's kind from the owner's categories", () => {
	test("a custom category's line gets its own kind, not transfer", async () => {
		await app.splits.set({
			txnId: "S-custom",
			lines: [
				{ amount: 60, categoryKey: custom },
				{ amount: 40, categoryKey: "rent" },
			],
		});
		const lines = await app.splits.get({ txnId: "S-custom" });
		expect(lines.map((l) => [l.categoryKey, l.kind])).toEqual([
			[custom, "active_income"],
			["rent", "expense"],
		]);
	});

	test("an unknown key on any line is refused, naming it, and the old lines stay", async () => {
		await app.splits.set({
			txnId: "S-keep",
			lines: [{ amount: 10, categoryKey: "rent" }],
		});
		const before = await logSize();
		await expect(
			app.splits.set({
				txnId: "S-keep",
				lines: [
					{ amount: 4, categoryKey: "rent" },
					{ amount: 6, categoryKey: "made_up" },
				],
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: expect.stringContaining('"made_up"'),
		});
		const lines = await app.splits.get({ txnId: "S-keep" });
		expect(lines.map((l) => [l.amount, l.categoryKey])).toEqual([[10, "rent"]]);
		expect(await logSize()).toBe(before);
	});
});

describe("descriptions", () => {
	test("say kinds come from the owner's categories, with no built-in-only warning", () => {
		for (const proc of [appRouter.overrides.set, appRouter.splits.set]) {
			const d = mcpMetaOf(proc)?.description ?? "";
			expect(d).toContain("owner's categories");
			expect(d).not.toMatch(/built-in category taxonomy only/);
			expect(d).not.toMatch(/prefer built-in|use built-in keys/);
		}
	});
});
