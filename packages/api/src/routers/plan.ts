import { type AppDb, investments, recurringExpenses } from "@money/db";
import {
	CADENCES,
	coverageLadder,
	INVESTMENT_TYPES,
	type Investment,
	netIncomeOfTax,
	type RateMap,
	type RecurringExpense,
	toInr,
	wealthSummary,
} from "@money/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../index";
import { captureCoverageSnapshot, loadCoverageHistory } from "./coverage";
import { loadRates } from "./currency";
import { loadAfterTaxEnabled, loadKpiTaxRate } from "./tax";

/**
 * The **Plan** router (ADR-0011 revised / ADR-0014/0015) — reads and writes the SQLite plan (investments +
 * recurring expenses) and computes the plan-driven coverage ladder. No DuckDB here; this is durable app
 * state, not statement actuals.
 */

type InvestmentRow = typeof investments.$inferSelect;
type RecurringRow = typeof recurringExpenses.$inferSelect;

function toInvestment(r: InvestmentRow): Investment {
	return {
		id: String(r.id),
		name: r.name,
		type: r.type as Investment["type"],
		incomeClass: r.incomeClass as Investment["incomeClass"],
		valuationSource: r.valuationSource as Investment["valuationSource"],
		isPassiveIncomeSource: r.isPassiveIncomeSource,
		active: r.active,
		platform: r.platform ?? undefined,
		group: r.group ?? undefined,
		payout: (r.payout as Investment["payout"]) ?? undefined,
		principal: r.principal ?? undefined,
		annualRate: r.annualRate ?? undefined,
		expectedMonthlyInterest: r.expectedMonthlyInterest ?? undefined,
		interestCadence:
			(r.interestCadence as Investment["interestCadence"]) ?? undefined,
		principalCadence:
			(r.principalCadence as Investment["principalCadence"]) ?? undefined,
		startDate: r.startDate ?? undefined,
		maturityDate: r.maturityDate ?? undefined,
		actionOnMaturity:
			(r.actionOnMaturity as Investment["actionOnMaturity"]) ?? undefined,
		currentValue: r.currentValue ?? undefined,
		currency: r.currency,
		status: (r.status as Investment["status"]) ?? undefined,
	};
}

/** A copy with every monetary field normalised to INR — for the currency-agnostic aggregate compute. */
export function investmentToInr(inv: Investment, rates: RateMap): Investment {
	const cur = inv.currency;
	return {
		...inv,
		currency: "INR",
		principal:
			inv.principal != null ? toInr(inv.principal, cur, rates) : inv.principal,
		currentValue:
			inv.currentValue != null
				? toInr(inv.currentValue, cur, rates)
				: inv.currentValue,
		expectedMonthlyInterest:
			inv.expectedMonthlyInterest != null
				? toInr(inv.expectedMonthlyInterest, cur, rates)
				: inv.expectedMonthlyInterest,
	};
}

/** A copy with `amount` normalised to INR. */
export function recurringToInr(
	exp: RecurringExpense,
	rates: RateMap,
): RecurringExpense {
	return {
		...exp,
		currency: "INR",
		amount: toInr(exp.amount, exp.currency, rates),
	};
}

function toRecurring(r: RecurringRow): RecurringExpense {
	return {
		id: String(r.id),
		name: r.name,
		category: r.category ?? undefined,
		amount: r.amount,
		cadence: r.cadence as RecurringExpense["cadence"],
		active: r.active,
		currency: r.currency,
		startDate: r.startDate ?? undefined,
		endDate: r.endDate ?? undefined,
		source: (r.source as RecurringExpense["source"]) ?? undefined,
	};
}

export async function listInvestments(appDb: AppDb): Promise<Investment[]> {
	const rows = await appDb.select().from(investments);
	return rows.map(toInvestment);
}

export async function listRecurring(appDb: AppDb): Promise<RecurringExpense[]> {
	const rows = await appDb.select().from(recurringExpenses);
	return rows.map(toRecurring);
}

// ── input schemas ──────────────────────────────────────────────────────────────────────────────────
const investmentInput = z.object({
	name: z.string().min(1),
	type: z.enum(INVESTMENT_TYPES),
	incomeClass: z.enum(["income", "growth"]),
	platform: z.string().optional(),
	group: z.string().optional(),
	payout: z.enum(["cash", "accrue"]).optional(),
	principal: z.number().nonnegative().optional(),
	annualRate: z.number().optional(),
	expectedMonthlyInterest: z.number().optional(),
	interestCadence: z.enum(CADENCES).optional(),
	principalCadence: z.enum(CADENCES).optional(),
	startDate: z.string().optional(),
	maturityDate: z.string().optional(),
	actionOnMaturity: z.enum(["reinvest", "withdraw", "auto_renew"]).optional(),
	currentValue: z.number().optional(),
	currency: z.string().optional(),
	status: z.enum(["active", "matured", "closed"]).optional(),
	isPassiveIncomeSource: z.boolean().optional(),
	active: z.boolean().optional(),
});

const recurringInput = z.object({
	name: z.string().min(1),
	category: z.string().optional(),
	amount: z.number(),
	currency: z.string().optional(),
	cadence: z
		.enum(["monthly", "quarterly", "half_yearly", "yearly"])
		.default("monthly"),
	active: z.boolean().optional(),
	startDate: z.string().optional(),
	endDate: z.string().optional(),
	source: z.enum(["manual", "seeded"]).optional(),
});

const idInput = z.object({ id: z.coerce.number().int().positive() });

/** Today as YYYY-MM-DD (server clock) — drives auto-expiry of matured holdings. */
/** Today on the server clock, `YYYY-MM-DD` — the reference date every plan/expiry compute is drawn against. */
export function todayISO(): string {
	return new Date().toISOString().slice(0, 10);
}

export const planRouter = {
	/** Three nested coverage tiers: cash-in-hand ⊆ fixed-income ⊆ total return (ADR-0015). INR aggregates. */
	ladder: protectedProcedure.handler(async ({ context }) => {
		const [invs, recs, rates, afterTax, taxRate] = await Promise.all([
			listInvestments(context.appDb),
			listRecurring(context.appDb),
			loadRates(context.controlDb),
			loadAfterTaxEnabled(context.appDb),
			loadKpiTaxRate(context.appDb, context.uid),
		]);
		const inrInvestments = invs.map((i) => investmentToInr(i, rates));
		const inrRecurring = recs.map((r) => recurringToInr(r, rates));

		// Record this month's plan so the KPI's "trending up" half has something to draw. Stored pre-tax so
		// the after-tax toggle stays a read-time concern. Opportunistic: a snapshot failure must never take
		// down the headline KPI, so it is logged and swallowed rather than propagated.
		try {
			await captureCoverageSnapshot(context.appDb, {
				investments: inrInvestments,
				recurring: inrRecurring,
			});
		} catch (e) {
			console.error("[coverage] snapshot failed:", e);
		}

		return coverageLadder({
			investments: afterTax
				? inrInvestments.map((i) => netIncomeOfTax(i, taxRate))
				: inrInvestments,
			recurring: inrRecurring,
			today: todayISO(),
		});
	}),

	/**
	 * The KPI over time — every captured month replayed through the current ladder. Empty until the first
	 * snapshot lands; there is no backfill, because the plan never stored history to reconstruct from.
	 */
	coverageHistory: protectedProcedure.handler(async ({ context }) => {
		const [afterTax, taxRate] = await Promise.all([
			loadAfterTaxEnabled(context.appDb),
			loadKpiTaxRate(context.appDb, context.uid),
		]);
		return loadCoverageHistory(context.appDb, {
			afterTax,
			taxRate,
			today: todayISO(),
		});
	}),

	/** Portfolio rollup: total wealth, grouped holdings + weighted rate, avg/required ROI, years-left. */
	wealth: protectedProcedure.handler(async ({ context }) => {
		const [invs, recs, rates, afterTax, taxRate] = await Promise.all([
			listInvestments(context.appDb),
			listRecurring(context.appDb),
			loadRates(context.controlDb),
			loadAfterTaxEnabled(context.appDb),
			loadKpiTaxRate(context.appDb, context.uid),
		]);
		const mapInv = (i: Investment) => {
			const inr = investmentToInr(i, rates);
			return afterTax ? netIncomeOfTax(inr, taxRate) : inr;
		};
		return wealthSummary({
			investments: invs.map(mapInv),
			recurring: recs.map((r) => recurringToInr(r, rates)),
			today: todayISO(),
		});
	}),

	investments: protectedProcedure.handler(({ context }) =>
		listInvestments(context.appDb),
	),
	recurring: protectedProcedure.handler(({ context }) =>
		listRecurring(context.appDb),
	),

	addInvestment: protectedProcedure
		.input(investmentInput)
		.handler(async ({ context, input }) => {
			const [row] = await context.appDb
				.insert(investments)
				.values(input)
				.returning();
			if (!row) throw new Error("insert failed");
			return toInvestment(row);
		}),
	updateInvestment: protectedProcedure
		.input(investmentInput.partial().merge(idInput))
		.handler(async ({ context, input }) => {
			const { id, ...rest } = input;
			const [row] = await context.appDb
				.update(investments)
				.set(rest)
				.where(eq(investments.id, id))
				.returning();
			return row ? toInvestment(row) : null;
		}),
	deleteInvestment: protectedProcedure
		.input(idInput)
		.handler(async ({ context, input }) => {
			await context.appDb
				.delete(investments)
				.where(eq(investments.id, input.id));
			return { ok: true };
		}),

	addRecurring: protectedProcedure
		.input(recurringInput)
		.handler(async ({ context, input }) => {
			const [row] = await context.appDb
				.insert(recurringExpenses)
				.values(input)
				.returning();
			if (!row) throw new Error("insert failed");
			return toRecurring(row);
		}),
	updateRecurring: protectedProcedure
		.input(recurringInput.partial().merge(idInput))
		.handler(async ({ context, input }) => {
			const { id, ...rest } = input;
			const [row] = await context.appDb
				.update(recurringExpenses)
				.set(rest)
				.where(eq(recurringExpenses.id, id))
				.returning();
			return row ? toRecurring(row) : null;
		}),
	deleteRecurring: protectedProcedure
		.input(idInput)
		.handler(async ({ context, input }) => {
			await context.appDb
				.delete(recurringExpenses)
				.where(eq(recurringExpenses.id, input.id));
			return { ok: true };
		}),
};
