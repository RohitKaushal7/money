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
const { changeLog, transactionOverrides } = await import("@money/db");
const { sql } = await import("drizzle-orm");
const { applyOverrides } = await import("./routers/reconcile");
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

describe("changing a category's kind", () => {
	const db = () => appDbFor(uid);
	const overrideKind = async (txnId: string) =>
		(await app.overrides.list()).find((o) => o.txnId === txnId)?.overrideKind;
	const splitKinds = async (txnId: string) =>
		(await app.splits.get({ txnId })).map((l) => [l.categoryKey, l.kind]);

	/** A custom category with an override and a split line on it, plus an unrelated custom category's. */
	async function setup(label: string) {
		const cat = await app.categories.create({ label, kind: "expense" });
		const other = await app.categories.create({
			label: `${label} other`,
			kind: "expense",
		});
		if (!cat || !other) throw new Error("create failed");
		const tag = cat.key;
		await app.overrides.set({ txnId: `O-${tag}`, categoryKey: cat.key });
		await app.overrides.set({ txnId: `O2-${tag}`, categoryKey: other.key });
		await app.splits.set({
			txnId: `S-${tag}`,
			lines: [
				{ amount: 3, categoryKey: cat.key },
				{ amount: 7, categoryKey: other.key },
			],
		});
		return { cat, other, tag };
	}

	test("re-stamps the overrides and split lines that use it, and nothing else", async () => {
		const { cat, other, tag } = await setup("Gig Work");
		await app.categories.update({ id: cat.id, kind: "active_income" });
		expect(await overrideKind(`O-${tag}`)).toBe("active_income");
		expect(await overrideKind(`O2-${tag}`)).toBe("expense");
		expect(await splitKinds(`S-${tag}`)).toEqual([
			[cat.key, "active_income"],
			[other.key, "expense"],
		]);
	});

	test("is all-or-nothing: a failing re-stamp leaves the category, overrides and splits as they were", async () => {
		const { cat, tag } = await setup("Tutoring");
		await db().run(
			sql.raw(
				"create trigger test_boom before update on transaction_manual_splits begin select raise(abort, 'boom'); end",
			),
		);
		try {
			await expect(
				app.categories.update({ id: cat.id, kind: "passive_income" }),
			).rejects.toThrow();
		} finally {
			await db().run(sql.raw("drop trigger test_boom"));
		}
		const [row] = (await app.categories.list()).filter((c) => c.id === cat.id);
		expect(row?.kind).toBe("expense");
		expect(await overrideKind(`O-${tag}`)).toBe("expense");
		expect((await splitKinds(`S-${tag}`))[0]).toEqual([cat.key, "expense"]);
	});

	test("the description says a kind change updates overrides and split lines", () => {
		const d = mcpMetaOf(appRouter.categories.update)?.description ?? "";
		expect(d).not.toContain("re-applied to spending data");
		expect(d).not.toContain("keep the kind they were saved with");
		expect(d).toContain("overrides and manual split lines");
		expect(d).toContain("re-tag");
	});
});

describe("reconcile's override overlay", () => {
	test("a legacy override saved without a kind takes its category's kind, not the rule's", async () => {
		const cat = await app.categories.create({
			label: "Legacy Interest",
			kind: "passive_income",
		});
		if (!cat) throw new Error("create failed");
		await appDbFor(uid).insert(transactionOverrides).values({
			txnId: "R-legacy",
			overrideCategoryKey: cat.key,
			overrideKind: null,
		});
		const [credit] = await applyOverrides(
			[
				{
					txnId: "R-legacy",
					date: "2026-10-01",
					narration: "NEFT CR",
					amount: 500,
					month: "2026-10",
					kind: "transfer",
					categoryKey: "uncategorized",
				},
			],
			appDbFor(uid),
		);
		expect(credit?.categoryKey).toBe(cat.key);
		expect(credit?.kind).toBe("passive_income");
	});
});
