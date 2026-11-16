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

describe("plan investment amounts", () => {
	const base = { name: "Bond", type: "bond", incomeClass: "income" } as const;

	test("a negative currentValue or expectedMonthlyInterest is refused, on add and on edit", async () => {
		await expect(
			client.plan.addInvestment({ ...base, currentValue: -1 }),
		).rejects.toThrow(/Input validation failed/);
		await expect(
			client.plan.addInvestment({ ...base, expectedMonthlyInterest: -5 }),
		).rejects.toThrow(/Input validation failed/);
		const added = await client.plan.addInvestment({ ...base, currentValue: 0 });
		await expect(
			client.plan.updateInvestment({ id: Number(added.id), currentValue: -10 }),
		).rejects.toThrow(/Input validation failed/);
		await expect(
			client.plan.updateInvestment({
				id: Number(added.id),
				expectedMonthlyInterest: -0.5,
			}),
		).rejects.toThrow(/Input validation failed/);
	});

	test("null still clears expectedMonthlyInterest", async () => {
		const added = await client.plan.addInvestment({
			...base,
			expectedMonthlyInterest: 90,
		});
		const cleared = await client.plan.updateInvestment({
			id: Number(added.id),
			expectedMonthlyInterest: null,
		});
		expect(cleared?.expectedMonthlyInterest).toBeUndefined();
	});

	test("the list description gives the same fallback as the edit tools", async () => {
		const { mcpMetaOf } = await import("./mcp/meta");
		const list = mcpMetaOf(appRouter.plan.investments)?.description ?? "";
		expect(list).toContain(
			"coverage and wealth use annualRate × (currentValue, or principal if there is no currentValue) ÷ 12; the Reconcile view's expected interest uses principal × annualRate ÷ 12",
		);
	});
});

describe("plan dates", () => {
	const base = { name: "FD", type: "fd", incomeClass: "income" } as const;

	test("only a real YYYY-MM-DD day is stored; any other form is refused", async () => {
		for (const maturityDate of [
			"27-11-2027",
			"31/07/2027",
			"27-11-27",
			"2027-02-30",
		]) {
			await expect(
				client.plan.addInvestment({ ...base, maturityDate }),
			).rejects.toThrow(/Input validation failed/);
		}
		const added = await client.plan.addInvestment({
			...base,
			maturityDate: "2027-11-27",
		});
		expect(added.maturityDate).toBe("2027-11-27");
		await expect(
			client.plan.addRecurring({
				name: "Rent",
				amount: 1,
				endDate: "1/1/2027",
			}),
		).rejects.toThrow(/Input validation failed/);
	});

	test("an empty string clears a stored date", async () => {
		const added = await client.plan.addInvestment({
			...base,
			maturityDate: "2027-11-27",
		});
		const cleared = await client.plan.updateInvestment({
			id: Number(added.id),
			maturityDate: "",
		});
		expect(cleared?.maturityDate).toBeUndefined();

		const exp = await client.plan.addRecurring({
			name: "Gym",
			amount: 1,
			startDate: "2026-01-01",
			endDate: "",
		});
		expect(exp.startDate).toBe("2026-01-01");
		expect(exp.endDate).toBeUndefined();
	});
});

describe("recurring paidWith", () => {
	test("free text, trimmed; a partial edit leaves it; empty or null clears it", async () => {
		const exp = await client.plan.addRecurring({
			name: "Streaming",
			amount: 199,
			paidWith: "  HDFC Swiggy ",
		});
		expect(exp.paidWith).toBe("HDFC Swiggy");

		const priced = await client.plan.updateRecurring({
			id: Number(exp.id),
			amount: 249,
		});
		expect(priced?.paidWith).toBe("HDFC Swiggy");

		const emptied = await client.plan.updateRecurring({
			id: Number(exp.id),
			paidWith: "   ",
		});
		expect(emptied?.paidWith).toBeUndefined();

		await client.plan.updateRecurring({ id: Number(exp.id), paidWith: "UPI" });
		const nulled = await client.plan.updateRecurring({
			id: Number(exp.id),
			paidWith: null,
		});
		expect(nulled?.paidWith).toBeUndefined();
	});
});
