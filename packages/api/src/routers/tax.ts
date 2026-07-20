import { type AppDb, settings, taxProfiles } from "@money/db";
import {
	breakevenDeduction,
	type CapitalGains,
	compareRegimes,
	type Deductions,
	fyBounds,
	fyLabelFor,
	hraExemption,
	ltcgHeadroom,
	marginalRate,
	TAX_YEARS,
	type TaxInputs,
} from "@money/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { analyticsReady, withReader } from "../analytics";
import { protectedProcedure } from "../index";

/**
 * The **tax** router (Q11 / issue 005). Per-FY old-vs-new comparison over a manually-confirmed profile, with
 * income auto-suggested from the ledger (DuckDB, read-only). Also owns the after-tax KPI knobs
 * (`after_tax_kpi` on/off + `marginal_rate_override`) which the plan router reads.
 */

const AFTER_TAX_KEY = "after_tax_kpi";
const RATE_OVERRIDE_KEY = "marginal_rate_override";
const DEFAULT_MARGINAL_RATE = 0.312;

const ZERO_CG: CapitalGains = {
	equityStcg: 0,
	equityLtcg: 0,
	crypto: 0,
	otherStcg: 0,
	otherLtcg: 0,
};
const ZERO_DED: Deductions = { s80c: 0, s80d: 0, s80tta: 0, s80dd: 0, hra: 0 };

/** Start calendar year of a "FY2025-26" label. */
function fyStartYear(fy: string): number {
	const m = /^FY(\d{4})-\d{2}$/.exec(fy);
	if (!m) throw new Error(`bad FY label: ${fy}`);
	return Number(m[1]);
}

/** The FY label for today (server clock). */
function currentFy(): string {
	const now = new Date();
	return fyLabelFor(now.getFullYear(), now.getMonth() + 1);
}

type ProfileRow = typeof taxProfiles.$inferSelect;

/** Assemble compute inputs from a stored profile + ledger rent (for HRA). */
function toInputs(row: ProfileRow | undefined, ledgerRent: number): TaxInputs {
	const cg = {
		...ZERO_CG,
		...((row?.capitalGains as Partial<CapitalGains>) ?? {}),
	};
	const storedDed = (row?.deductions as Partial<Deductions>) ?? {};
	const hra = hraExemption({
		basic: row?.basicSalary ?? 0,
		hraReceived: row?.hraReceived ?? 0,
		// manual override wins; fall back to the ledger-derived rent when unset
		rentPaid: row?.rentPaid ?? ledgerRent,
		metro: row?.metro ?? false,
	});
	return {
		salary: row?.salaryIncome ?? 0,
		otherIncome: row?.otherIncome ?? 0,
		capitalGains: cg,
		deductions: { ...ZERO_DED, ...storedDed, hra },
	};
}

/** Σ taxable passive income + Σ salary/rent over an FY's Apr–Mar window (DuckDB, read-only). */
async function ledgerIncome(
	fy: string,
	uid: string,
): Promise<{ passive: number; salary: number; rent: number }> {
	if (!analyticsReady(uid)) return { passive: 0, salary: 0, rent: 0 };
	const { start, endExclusive } = fyBounds(fyStartYear(fy));
	return withReader(uid, async (reader) => {
		// taxable-passive is attribute-driven: kind = passive_income AND the category is flagged taxable,
		// so a user-added income category counts automatically (spec 2026-07-21 §6). salary/rent stay system keys.
		const [row] = await reader.query<{
			passive: number;
			salary: number;
			rent: number;
		}>(
			`SELECT
				CAST(COALESCE(SUM(CASE WHEN s.kind = 'passive_income' AND c.taxable THEN s.amount ELSE 0 END), 0) AS DOUBLE) AS passive,
				CAST(COALESCE(SUM(CASE WHEN s.category_key = 'salary' THEN s.amount ELSE 0 END), 0) AS DOUBLE) AS salary,
				CAST(COALESCE(SUM(CASE WHEN s.category_key = 'rent' THEN s.amount ELSE 0 END), 0) AS DOUBLE) AS rent
			FROM transaction_splits s
			JOIN transactions t ON t.txn_id = s.txn_id
			LEFT JOIN categories c ON c.key = s.category_key
			WHERE t.txn_date >= ? AND t.txn_date < ?`,
			[start, endExclusive],
		);
		return {
			passive: Math.abs(row?.passive ?? 0),
			salary: Math.abs(row?.salary ?? 0),
			rent: Math.abs(row?.rent ?? 0),
		};
	});
}

async function loadProfile(
	fy: string,
	appDb: AppDb,
): Promise<ProfileRow | undefined> {
	const [row] = await appDb
		.select()
		.from(taxProfiles)
		.where(eq(taxProfiles.fy, fy));
	return row;
}

/** The marginal rate the after-tax KPI uses: override → active-FY profile → default 31.2%. */
export async function loadKpiTaxRate(
	appDb: AppDb,
	uid: string,
): Promise<number> {
	const [override] = await appDb
		.select()
		.from(settings)
		.where(eq(settings.key, RATE_OVERRIDE_KEY));
	if (typeof override?.value === "number" && override.value > 0) {
		return override.value;
	}
	const fy = currentFy();
	try {
		const row = await loadProfile(fy, appDb);
		if (!row) return DEFAULT_MARGINAL_RATE;
		const { rent } = await ledgerIncome(fy, uid);
		const inputs = toInputs(row, rent);
		if (row.otherIncome == null) {
			inputs.otherIncome = (await ledgerIncome(fy, uid)).passive;
		}
		const regime =
			(row.regimeChoice as "old" | "new" | null) ??
			compareRegimes(inputs, fy).recommended;
		return marginalRate(inputs, regime, fy);
	} catch {
		return DEFAULT_MARGINAL_RATE;
	}
}

/** Whether the after-tax KPI switch is on (default true). */
export async function loadAfterTaxEnabled(appDb: AppDb): Promise<boolean> {
	const [row] = await appDb
		.select()
		.from(settings)
		.where(eq(settings.key, AFTER_TAX_KEY));
	return typeof row?.value === "boolean" ? row.value : true;
}

const cgInput = z.object({
	equityStcg: z.number().default(0),
	equityLtcg: z.number().default(0),
	crypto: z.number().default(0),
	otherStcg: z.number().default(0),
	otherLtcg: z.number().default(0),
});
const dedInput = z.object({
	s80c: z.number().default(0),
	s80d: z.number().default(0),
	s80tta: z.number().default(0),
	s80dd: z.number().default(0),
});

/** Drop undefined keys so a partial upsert never nulls an untouched column. */
function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
	const out: Partial<T> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v !== undefined) out[k as keyof T] = v as T[keyof T];
	}
	return out;
}

export const taxRouter = {
	/** Ledger-derived income suggestions for a FY (passive auto-summed; salary is a hint only). */
	suggestIncome: protectedProcedure
		.input(z.object({ fy: z.string() }))
		.handler(async ({ context, input }) => {
			const { passive, salary, rent } = await ledgerIncome(
				input.fy,
				context.uid,
			);
			return {
				fy: input.fy,
				passive,
				salaryHint: salary,
				rent,
				isCurrent: input.fy === currentFy(),
			};
		}),

	/** The stored profile for a FY (or null). */
	get: protectedProcedure
		.input(z.object({ fy: z.string() }))
		.handler(
			async ({ context, input }) =>
				(await loadProfile(input.fy, context.appDb)) ?? null,
		),

	/** Upsert the confirmed profile. */
	upsert: protectedProcedure
		.input(
			z.object({
				fy: z.string(),
				regimeChoice: z.enum(["old", "new"]).nullish(),
				salaryIncome: z.number().nullish(),
				otherIncome: z.number().nullish(),
				basicSalary: z.number().nullish(),
				hraReceived: z.number().nullish(),
				rentPaid: z.number().nullish(),
				metro: z.boolean().nullish(),
				capitalGains: cgInput.optional(),
				deductions: dedInput.optional(),
				notes: z.string().nullish(),
			}),
		)
		.handler(async ({ context, input }) => {
			const values = defined(input);
			await context.appDb
				.insert(taxProfiles)
				.values({ ...values, fy: input.fy })
				.onConflictDoUpdate({ target: taxProfiles.fy, set: values });
			return (await loadProfile(input.fy, context.appDb)) ?? null;
		}),

	/** Old-vs-new comparison + breakeven + LTCG headroom for a FY. */
	compute: protectedProcedure
		.input(z.object({ fy: z.string() }))
		.handler(async ({ context, input }) => {
			const [row, ledger] = await Promise.all([
				loadProfile(input.fy, context.appDb),
				ledgerIncome(input.fy, context.uid),
			]);
			const inputs = toInputs(row, ledger.rent);
			// fall back to the ledger's taxable passive sum when the profile hasn't stored otherIncome yet
			if (row?.otherIncome == null) inputs.otherIncome = ledger.passive;
			const cmp = compareRegimes(inputs, input.fy);
			return {
				fy: input.fy,
				...cmp,
				breakeven: breakevenDeduction(inputs, input.fy),
				ltcgHeadroom: ltcgHeadroom(inputs.capitalGains.equityLtcg, input.fy),
				hraExemption: inputs.deductions.hra,
				availableFys: Object.keys(TAX_YEARS),
			};
		}),

	/** Pin the regime so a closed FY stays locked. */
	finalize: protectedProcedure
		.input(z.object({ fy: z.string(), regimeChoice: z.enum(["old", "new"]) }))
		.handler(async ({ context, input }) => {
			await context.appDb
				.update(taxProfiles)
				.set({ regimeChoice: input.regimeChoice })
				.where(eq(taxProfiles.fy, input.fy));
			return (await loadProfile(input.fy, context.appDb)) ?? null;
		}),

	/** The after-tax KPI knobs (switch + effective rate). */
	getKpiConfig: protectedProcedure.handler(async ({ context }) => ({
		enabled: await loadAfterTaxEnabled(context.appDb),
		rate: await loadKpiTaxRate(context.appDb, context.uid),
	})),

	/** Toggle the switch and/or set a manual rate override (null clears it). */
	setKpiConfig: protectedProcedure
		.input(
			z.object({
				enabled: z.boolean().optional(),
				rateOverride: z.number().positive().nullish(),
			}),
		)
		.handler(async ({ context, input }) => {
			if (input.enabled != null) {
				await context.appDb
					.insert(settings)
					.values({ key: AFTER_TAX_KEY, value: input.enabled })
					.onConflictDoUpdate({
						target: settings.key,
						set: { value: input.enabled },
					});
			}
			if (input.rateOverride !== undefined) {
				if (input.rateOverride === null) {
					await context.appDb
						.delete(settings)
						.where(eq(settings.key, RATE_OVERRIDE_KEY));
				} else {
					await context.appDb
						.insert(settings)
						.values({ key: RATE_OVERRIDE_KEY, value: input.rateOverride })
						.onConflictDoUpdate({
							target: settings.key,
							set: { value: input.rateOverride },
						});
				}
			}
			return {
				enabled: await loadAfterTaxEnabled(context.appDb),
				rate: await loadKpiTaxRate(context.appDb, context.uid),
			};
		}),
};
