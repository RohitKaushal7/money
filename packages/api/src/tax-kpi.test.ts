import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "./context";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "money-tax-kpi-"));
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";

const { createRouterClient } = await import("@orpc/server");
const { provisionUserApp } = await import("@money/db/migrate");
const shared = await import("@money/shared");
const { fyLabelFor, marginalRate, TAX_YEARS } = shared;
const { appRouter } = await import("./routers/index");
const { appDbFor, controlDb } = await import("./db");
const { resolveKpiTaxRate } = await import("./routers/tax");
const { mcpMetaOf } = await import("./mcp/meta");

/** A label past every year with rules: what the current FY looks like each 1 April until its rules land. */
const UNRULED = "FY2099-00";
const LATEST_RULED = Object.keys(TAX_YEARS).sort().at(-1) as string;
const DEFAULT = 0.312;

async function user(uid: string) {
	await provisionUserApp(uid);
	const client = createRouterClient(appRouter, {
		context: {
			session: { user: { id: uid } },
			controlDb: controlDb(),
			unlockToken: null,
			via: undefined,
			batchId: undefined,
			entityLockHeld: false,
		} as unknown as Context,
	});
	return { client, appDb: appDbFor(uid) };
}

/** A ₹15L salary on the new regime: a marginal rate well away from the 31.2% default. */
const PROFILE = {
	salaryIncome: 1_500_000,
	otherIncome: 0,
	regimeChoice: "new" as const,
};
const expectedRate = (fy: string) =>
	marginalRate(
		{
			salary: PROFILE.salaryIncome,
			otherIncome: 0,
			capitalGains: {
				equityStcg: 0,
				equityLtcg: 0,
				crypto: 0,
				otherStcg: 0,
				otherLtcg: 0,
			},
			deductions: { s80c: 0, s80d: 0, s80tta: 0, s80dd: 0, hra: 0 },
		},
		"new",
		fy,
	);

describe("the after-tax KPI rate when the current FY has no tax rules yet", () => {
	test("a saved current-FY profile is computed with the latest year that has rules", async () => {
		const { client, appDb } = await user("kpi-current-profile");
		await client.tax.upsert({ fy: UNRULED, ...PROFILE });
		const r = await resolveKpiTaxRate(appDb, "kpi-current-profile", UNRULED);
		expect(r.rate).toBe(expectedRate(LATEST_RULED));
		expect(r.rate).not.toBe(DEFAULT);
		expect(r).toMatchObject({
			source: "profile",
			profileFy: UNRULED,
			rulesFy: LATEST_RULED,
			currentFy: UNRULED,
		});
	});

	test("without a current-FY profile, the most recent saved one is used", async () => {
		const { client, appDb } = await user("kpi-older-profile");
		await client.tax.upsert({ fy: "FY2025-26", salaryIncome: 400_000 });
		await client.tax.upsert({ fy: LATEST_RULED, ...PROFILE });
		const r = await resolveKpiTaxRate(appDb, "kpi-older-profile", UNRULED);
		expect(r.rate).toBe(expectedRate(LATEST_RULED));
		expect(r).toMatchObject({
			source: "profile",
			profileFy: LATEST_RULED,
			rulesFy: LATEST_RULED,
		});
	});

	test("no profile at all → the 31.2% default", async () => {
		const { appDb } = await user("kpi-no-profile");
		expect(await resolveKpiTaxRate(appDb, "kpi-no-profile", UNRULED)).toEqual({
			rate: DEFAULT,
			source: "default",
			profileFy: null,
			rulesFy: null,
			currentFy: UNRULED,
		});
	});

	test("an explicit override still wins", async () => {
		const { client, appDb } = await user("kpi-override");
		await client.tax.upsert({ fy: UNRULED, ...PROFILE });
		await client.tax.setKpiConfig({ rateOverride: 0.2 });
		expect(await resolveKpiTaxRate(appDb, "kpi-override", UNRULED)).toEqual({
			rate: 0.2,
			source: "override",
			profileFy: null,
			rulesFy: null,
			currentFy: UNRULED,
		});
	});

	test("getKpiConfig says which year's rules and profile the rate came from", async () => {
		const { client, appDb } = await user("kpi-config");
		// The server's own current FY, so this holds whether or not its rules have been added yet.
		const now = new Date();
		const today = fyLabelFor(now.getFullYear(), now.getMonth() + 1);
		const rules = today in TAX_YEARS ? today : LATEST_RULED;
		await client.tax.upsert({ fy: today, ...PROFILE });
		const cfg = await client.tax.getKpiConfig();
		expect(cfg).toEqual({
			enabled: true,
			rate: expectedRate(rules),
			source: "profile",
			profileFy: today,
			rulesFy: rules,
			currentFy: today,
		});
		expect(cfg).toEqual({
			enabled: true,
			...(await resolveKpiTaxRate(appDb, "kpi-config")),
		});
	});

	test("a profile that can't be computed falls back to 31.2%, says so, and logs why", async () => {
		const { client, appDb } = await user("kpi-compute-fails");
		await client.tax.upsert({ fy: UNRULED, ...PROFILE });
		const boom = spyOn(shared, "marginalRate").mockImplementation(() => {
			throw new Error("DuckDB read failed");
		});
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(
				await resolveKpiTaxRate(appDb, "kpi-compute-fails", UNRULED),
			).toEqual({
				rate: DEFAULT,
				source: "fallback",
				profileFy: UNRULED,
				rulesFy: null,
				currentFy: UNRULED,
			});
			expect(logged).toHaveBeenCalledWith(
				"[tax] computing the after-tax KPI rate failed; using 31.2%:",
				expect.objectContaining({ message: "DuckDB read failed" }),
			);
		} finally {
			boom.mockRestore();
			logged.mockRestore();
		}
	});

	test("the getKpiConfig description explains the fallback source", () => {
		const d = mcpMetaOf(appRouter.tax.getKpiConfig)?.description ?? "";
		expect(d).toContain("fallback");
		expect(d).toMatch(/couldn't be computed/);
	});
});
