import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "../context";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "money-update-holdings-"));
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";

const { createRouterClient } = await import("@orpc/server");
const { provisionUserApp } = await import("@money/db/migrate");
const { changeLog, investments } = await import("@money/db");
const { eq } = await import("drizzle-orm");
const { appRouter } = await import("../routers/index");
const { appDbFor, controlDb } = await import("../db");
const { extraTools } = await import("./tools");
const { planHoldingUpdates, UPDATE_HOLDINGS, updateHoldings } = await import(
	"./update-holdings"
);
const { ORPCError } = await import("@orpc/server");
await import("./extra-tools");

type Row = typeof investments.$inferSelect;
type Plan = ReturnType<typeof planHoldingUpdates>;

let nextId = 1;
function row(over: Partial<Row>): Row {
	const at = new Date(1_700_000_000_000);
	return {
		id: nextId++,
		name: "Holding",
		type: "bond",
		incomeClass: "income",
		valuationSource: "manual",
		isPassiveIncomeSource: false,
		platform: null,
		group: null,
		isin: null,
		principal: null,
		annualRate: 0.1,
		expectedMonthlyInterest: null,
		interestCadence: null,
		payout: "accrue",
		principalCadence: null,
		startDate: null,
		maturityDate: null,
		actionOnMaturity: null,
		currentValue: 1000,
		currency: "INR",
		status: "active",
		terms: null,
		active: true,
		notes: null,
		createdAt: at,
		updatedAt: at,
		...over,
	};
}

describe("planHoldingUpdates", () => {
	const a = row({ name: "Aarav Bonds", platform: "Wint", currentValue: 1000 });
	const k1 = row({
		name: "Keertana Finserv",
		platform: "Wint",
		currentValue: 2000,
	});
	const k2 = row({
		name: "Keertana Finserv",
		platform: "Grip",
		currentValue: 3000,
	});
	const old = row({ name: "Old Bond", active: false, currentValue: 500 });
	const usd = row({ name: "US Fund", currency: "USD", currentValue: 50 });
	const all = [a, k1, k2, old, usd];

	test("matches by id, and by name case-insensitively after trimming", () => {
		const plan = planHoldingUpdates(all, {
			changes: [
				{ id: a.id, set: { annualRate: 0.12 } },
				{ match: { name: "  keertana FINSERV ", platform: "grip " }, set: {} },
			],
		});
		expect(plan.errors).toEqual([]);
		expect(plan.unmatched).toEqual([]);
		expect(plan.ambiguous).toEqual([]);
		expect(plan.rows.map((r) => r.id)).toEqual([a.id, k2.id]);
		expect(plan.rows[0]?.before).toEqual({ annualRate: 0.1 });
		expect(plan.rows[0]?.after).toEqual({ annualRate: 0.12 });
	});

	test("two holdings with one name are ambiguous unless an id is given", () => {
		const byName = planHoldingUpdates(all, {
			changes: [{ match: { name: "Keertana Finserv" }, set: {} }],
		});
		expect(byName.ambiguous).toEqual([
			{ match: "Keertana Finserv", ids: [k1.id, k2.id] },
		]);
		expect(byName.rows).toEqual([]);

		const byId = planHoldingUpdates(all, {
			changes: [{ id: k1.id, set: { currentValue: 2100 } }],
		});
		expect(byId.ambiguous).toEqual([]);
		expect(byId.rows.map((r) => r.id)).toEqual([k1.id]);
	});

	test("an unknown name or id is unmatched; inactive holdings only match by id", () => {
		const plan = planHoldingUpdates(all, {
			changes: [
				{ match: { name: "Nope" }, set: {} },
				{ id: 9999, set: {} },
				{ match: { name: "Old Bond" }, set: {} },
			],
		});
		expect(plan.unmatched).toHaveLength(3);
		expect(plan.unmatched[0]).toContain("Nope");
		expect(plan.unmatched[1]).toContain("9999");
		expect(plan.unmatched[2]).toContain("Old Bond");

		const byId = planHoldingUpdates(all, {
			changes: [{ id: old.id, set: { active: true } }],
		});
		expect(byId.unmatched).toEqual([]);
		expect(byId.rows[0]?.after).toEqual({ active: true });
	});

	test("one holding targeted twice is an error", () => {
		const plan = planHoldingUpdates(all, {
			changes: [
				{ id: a.id, set: { currentValue: 1 } },
				{ match: { name: "aarav bonds" }, set: { currentValue: 2 } },
			],
		});
		expect(plan.errors.join("\n")).toContain("Aarav Bonds");
	});

	test("the total passes within ±N (N = holdings in the request) and fails at N+1", () => {
		const changes = [
			{ id: a.id, set: { currentValue: 1100 } },
			{ id: k1.id, set: {} },
			{ id: k2.id, set: {} },
		];
		// after: 1100 + 2000 + 3000 = 6100; N = 3
		const within = (expected: number): Plan =>
			planHoldingUpdates(all, { changes, expectedTotalValue: expected });
		for (const expected of [6097, 6100, 6103]) {
			expect(within(expected).total).toEqual({
				expected,
				actual: 6100,
				tolerance: 3,
				ok: true,
				currency: "INR",
			});
		}
		expect(within(6104).total?.ok).toBe(false);
		expect(within(6096).total?.ok).toBe(false);
	});

	test("mixed currencies with an expected total is an error", () => {
		const plan = planHoldingUpdates(all, {
			changes: [
				{ id: a.id, set: {} },
				{ id: usd.id, set: {} },
			],
			expectedTotalValue: 1050,
		});
		expect(plan.errors.join("\n")).toContain("currenc");
		expect(plan.total).toBeUndefined();

		// Without a total, mixed currencies are fine.
		const noTotal = planHoldingUpdates(all, {
			changes: [
				{ id: a.id, set: {} },
				{ id: usd.id, set: {} },
			],
		});
		expect(noTotal.errors).toEqual([]);
	});

	test("a rate above 1 is refused as a percent, not a fraction", () => {
		const plan = planHoldingUpdates(all, {
			changes: [{ id: a.id, set: { annualRate: 11.75 } }],
		});
		expect(plan.errors.join("\n")).toContain("0.1175");
	});
});

describe("update_holdings tool", () => {
	const uid = "holdings-u";
	const via = {
		kind: "token" as const,
		tokenId: 7,
		name: "laptop",
		scope: "read_write" as const,
	};
	const ctx = {
		uid,
		user: { id: uid, email: "h@x.test", name: "h", role: "user" },
		via,
	};
	const app = createRouterClient(appRouter, {
		context: {
			session: { user: { id: uid } },
			controlDb: controlDb(),
			unlockToken: null,
			via: undefined,
			batchId: undefined,
		} as unknown as Context,
	});
	const tool = () => {
		const t = extraTools().find((x) => x.name === UPDATE_HOLDINGS);
		if (!t) throw new Error("update_holdings is not registered");
		return t;
	};
	const run = (args: unknown) =>
		tool().run(ctx, args) as Promise<Record<string, unknown>>;
	const ids: Record<string, number> = {};

	beforeAll(async () => {
		await provisionUserApp(uid);
		for (const [name, value] of [
			["Alpha Bond", 1000],
			["Beta Bond", 2000],
			["Gamma Bond", 3000],
		] as const) {
			const inv = await app.plan.addInvestment({
				name,
				type: "bond",
				incomeClass: "income",
				annualRate: 0.08,
				currentValue: value,
			});
			ids[name] = Number(inv.id);
		}
	});

	const fix = {
		changes: [
			{ match: { name: "alpha bond" }, set: { annualRate: 0.11 } },
			{ match: { name: "Beta Bond" }, set: { currentValue: 2100 } },
			{
				match: { name: "Gamma Bond" },
				set: { annualRate: 0.12, maturityDate: "2030-01-31" },
			},
		],
		expectedTotalValue: 6100,
	};

	test("is a write tool that explains the two-call flow", () => {
		expect(tool().kind).toBe("write");
		expect(tool().inputSchema.type).toBe("object");
		expect(tool().description).toContain("previewId");
		expect(tool().description).toContain("expectedTotalValue");
		// How to undo an apply: find the batch's changes in changes_list by batchId, undo each one.
		expect(tool().description).toContain("changes_list");
		expect(tool().description).toContain("changes_undo");
	});

	test("apply without a preview is refused", async () => {
		await expect(run({ ...fix, apply: true })).rejects.toThrow(/preview/i);
		await expect(
			run({ ...fix, apply: true, previewId: crypto.randomUUID() }),
		).rejects.toThrow(/preview/i);
	});

	test("apply after a holding was edited in the app is refused, naming it", async () => {
		const preview = await run(fix);
		expect(typeof preview.previewId).toBe("string");
		await Bun.sleep(5);
		await app.plan.updateInvestment({
			id: ids["Beta Bond"] ?? 0,
			principal: 1234,
		});
		await expect(
			run({ ...fix, apply: true, previewId: preview.previewId }),
		).rejects.toThrow(/Beta Bond/);
		const rows = await appDbFor(uid).select().from(investments);
		expect(rows.find((r) => r.name === "Alpha Bond")?.annualRate).toBe(0.08);
	});

	test("apply with a different payload than the preview is refused", async () => {
		const preview = await run(fix);
		await expect(
			run({
				...fix,
				expectedTotalValue: 6101,
				apply: true,
				previewId: preview.previewId,
			}),
		).rejects.toThrow(/preview/i);
	});

	test("a clean preview then apply updates the rows under one batch", async () => {
		const before = (await appDbFor(uid).select().from(changeLog)).length;
		const preview = await run(fix);
		expect(preview.summary).toContain("3 holdings");
		expect(preview.summary).toContain("matches");
		expect(preview.total).toMatchObject({ ok: true, actual: 6100 });

		const applied = await run({
			...fix,
			apply: true,
			previewId: preview.previewId,
		});
		expect(typeof applied.batchId).toBe("string");
		// There is no batch undo: the summary must point at changes_undo, one change at a time.
		expect(applied.summary).toContain(
			`undo each change in batch ${applied.batchId} with changes_undo`,
		);
		expect(applied.summary).not.toContain("Undo with change log batch");

		const rows = await appDbFor(uid).select().from(investments);
		const by = (n: string) => rows.find((r) => r.name === n);
		expect(by("Alpha Bond")?.annualRate).toBe(0.11);
		expect(by("Beta Bond")?.currentValue).toBe(2100);
		expect(by("Gamma Bond")?.annualRate).toBe(0.12);
		expect(by("Gamma Bond")?.maturityDate).toBe("2030-01-31");

		const log = (await appDbFor(uid).select().from(changeLog)).slice(before);
		expect(log).toHaveLength(3);
		for (const entry of log) {
			expect(entry.batchId).toBe(applied.batchId as string);
			expect(entry.source).toBe("mcp");
			expect(entry.procedure).toBe("plan.updateInvestment");
		}

		// The preview is single-use.
		await expect(
			run({ ...fix, apply: true, previewId: preview.previewId }),
		).rejects.toThrow(/preview/i);
	});

	test("unchanged holdings are checked but not written; null clears the monthly override", async () => {
		await app.plan.updateInvestment({
			id: ids["Alpha Bond"] ?? 0,
			expectedMonthlyInterest: 90,
		});
		const before = (await appDbFor(uid).select().from(changeLog)).length;
		const args = {
			changes: [
				{ id: ids["Alpha Bond"], set: { expectedMonthlyInterest: null } },
				{ id: ids["Beta Bond"], set: { currentValue: 2100 } },
				{ id: ids["Gamma Bond"], set: {} },
			],
			expectedTotalValue: 6100,
		};
		const preview = await run(args);
		expect(preview.summary).toContain("1 changed");
		await run({ ...args, apply: true, previewId: preview.previewId });
		const log = (await appDbFor(uid).select().from(changeLog)).slice(before);
		expect(log).toHaveLength(1);
		const [alpha] = await appDbFor(uid)
			.select()
			.from(investments)
			.where(eq(investments.id, ids["Alpha Bond"] ?? 0));
		expect(alpha?.expectedMonthlyInterest).toBeNull();
	});

	test("a preview with problems gets no previewId", async () => {
		const preview = await run({
			changes: [{ match: { name: "Nobody" }, set: {} }],
		});
		expect(preview.previewId).toBeNull();
		expect(preview.unmatched).toHaveLength(1);
	});

	// State here: Alpha 1000 @ 0.11, Beta 2100 @ 0.08, Gamma 3000 @ 0.12.
	const rowsNow = () => appDbFor(uid).select().from(investments);
	const logNow = async () =>
		(await appDbFor(uid).select().from(changeLog)).length;

	test("an app edit to the value of an unchanged holding is named, even though it breaks the total", async () => {
		const args = {
			changes: [
				{ id: ids["Alpha Bond"], set: { annualRate: 0.115 } },
				{ id: ids["Beta Bond"], set: {} },
				{ id: ids["Gamma Bond"], set: {} },
			],
			expectedTotalValue: 6100,
		};
		const preview = await run(args);
		expect(preview.previewId).toBeString();
		await Bun.sleep(5);
		await app.plan.updateInvestment({
			id: ids["Gamma Bond"] ?? 0,
			currentValue: 3500,
		});
		const before = await logNow();
		await expect(
			run({ ...args, apply: true, previewId: preview.previewId }),
		).rejects.toThrow(/Gamma Bond/);
		expect(await logNow()).toBe(before);
		await app.plan.updateInvestment({
			id: ids["Gamma Bond"] ?? 0,
			currentValue: 3000,
		});
	});

	test("a write failing partway reports what was written, what failed and what was not attempted", async () => {
		const args = {
			changes: [
				{ id: ids["Alpha Bond"], set: { annualRate: 0.09 } },
				{ id: ids["Beta Bond"], set: { annualRate: 0.091 } },
				{ id: ids["Gamma Bond"], set: { annualRate: 0.092 } },
			],
			expectedTotalValue: 6100,
		};
		const preview = await run(args);
		expect(preview.previewId).toBeString();
		const before = await logNow();
		let calls = 0;
		const err = await updateHoldings(
			ctx,
			{ ...args, apply: true, previewId: preview.previewId },
			async (client, input) => {
				calls++;
				if (calls === 2)
					throw new ORPCError("BAD_REQUEST", { message: "boom" });
				return client.plan.updateInvestment(input);
			},
		).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ORPCError);
		const e = err as InstanceType<typeof ORPCError>;
		expect(e.message).toContain("Beta Bond");
		expect(e.message).toContain("1 of 3");
		expect(e.message).toContain("with changes_undo");
		expect(e.message).not.toContain("undo them with change log batch");
		const data = e.data as {
			batchId: string;
			written: Array<{ id: number; name: string }>;
			failedAt: { id: number; name: string };
			error: string;
			notAttempted: Array<{ id: number; name: string }>;
		};
		expect(data.written).toEqual([
			{ id: ids["Alpha Bond"] ?? 0, name: "Alpha Bond" },
		]);
		expect(data.failedAt).toEqual({
			id: ids["Beta Bond"] ?? 0,
			name: "Beta Bond",
		});
		expect(data.error).toContain("boom");
		expect(data.notAttempted).toEqual([
			{ id: ids["Gamma Bond"] ?? 0, name: "Gamma Bond" },
		]);
		const log = (await appDbFor(uid).select().from(changeLog)).slice(before);
		expect(log).toHaveLength(1);
		expect(log[0]?.batchId).toBe(data.batchId);
		const rows = await rowsNow();
		expect(rows.find((r) => r.name === "Alpha Bond")?.annualRate).toBe(0.09);
		expect(rows.find((r) => r.name === "Beta Bond")?.annualRate).toBe(0.08);
	});

	test("a holding that vanishes mid-batch is reported as missing, not counted as written", async () => {
		const args = {
			changes: [
				{ id: ids["Alpha Bond"], set: { annualRate: 0.1 } },
				{ id: ids["Beta Bond"], set: { annualRate: 0.093 } },
				{ id: ids["Gamma Bond"], set: { annualRate: 0.094 } },
			],
			expectedTotalValue: 6100,
		};
		const preview = await run(args);
		expect(preview.previewId).toBeString();
		const out = (await updateHoldings(
			ctx,
			{ ...args, apply: true, previewId: preview.previewId },
			async (client, input) => {
				if (input.id === ids["Beta Bond"]) {
					await appDbFor(uid)
						.delete(investments)
						.where(eq(investments.id, input.id));
				}
				return client.plan.updateInvestment(input);
			},
		)) as {
			updated: number;
			written: Array<{ name: string }>;
			missing: Array<{ name: string }>;
			summary: string;
		};
		expect(out.updated).toBe(2);
		expect(out.written.map((w) => w.name)).toEqual([
			"Alpha Bond",
			"Gamma Bond",
		]);
		expect(out.missing.map((m) => m.name)).toEqual(["Beta Bond"]);
		expect(out.summary).toContain("Beta Bond");
	});
});
