import { db, investments, recurringExpenses } from "@money/db";
import {
	CADENCES,
	coverageLadder,
	INVESTMENT_TYPES,
	type Investment,
	type RateMap,
	type RecurringExpense,
	toInr,
	wealthSummary,
} from "@money/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { publicProcedure } from "../index";
import { loadRates } from "./currency";

/**
 * The **Plan** router (ADR-0011 revised / ADR-0014/0015) — reads and writes the SQLite plan (investments +
 * recurring expenses) and computes the plan-driven coverage ladder. No DuckDB here; this is durable app
 * state, not statement actuals.
 *
 * TODO(auth): `publicProcedure` for the localhost/tailnet dashboard. MUST become `protectedProcedure`
 * before any non-tailnet exposure — this writes financial plan data (ADR-0006/0010).
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

export async function listInvestments(): Promise<Investment[]> {
	const rows = await db.select().from(investments);
	return rows.map(toInvestment);
}

export async function listRecurring(): Promise<RecurringExpense[]> {
	const rows = await db.select().from(recurringExpenses);
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
function todayISO(): string {
	return new Date().toISOString().slice(0, 10);
}

export const planRouter = {
	/** Three nested coverage tiers: cash-in-hand ⊆ fixed-income ⊆ total return (ADR-0015). INR aggregates. */
	ladder: publicProcedure.handler(async () => {
		const [invs, recs, rates] = await Promise.all([
			listInvestments(),
			listRecurring(),
			loadRates(),
		]);
		return coverageLadder({
			investments: invs.map((i) => investmentToInr(i, rates)),
			recurring: recs.map((r) => recurringToInr(r, rates)),
			today: todayISO(),
		});
	}),

	/** Portfolio rollup: total wealth, grouped holdings + weighted rate, avg/required ROI, years-left. */
	wealth: publicProcedure.handler(async () => {
		const [invs, recs, rates] = await Promise.all([
			listInvestments(),
			listRecurring(),
			loadRates(),
		]);
		return wealthSummary({
			investments: invs.map((i) => investmentToInr(i, rates)),
			recurring: recs.map((r) => recurringToInr(r, rates)),
			today: todayISO(),
		});
	}),

	investments: publicProcedure.handler(() => listInvestments()),
	recurring: publicProcedure.handler(() => listRecurring()),

	addInvestment: publicProcedure
		.input(investmentInput)
		.handler(async ({ input }) => {
			const [row] = await db.insert(investments).values(input).returning();
			if (!row) throw new Error("insert failed");
			return toInvestment(row);
		}),
	updateInvestment: publicProcedure
		.input(investmentInput.partial().merge(idInput))
		.handler(async ({ input }) => {
			const { id, ...rest } = input;
			const [row] = await db
				.update(investments)
				.set(rest)
				.where(eq(investments.id, id))
				.returning();
			return row ? toInvestment(row) : null;
		}),
	deleteInvestment: publicProcedure
		.input(idInput)
		.handler(async ({ input }) => {
			await db.delete(investments).where(eq(investments.id, input.id));
			return { ok: true };
		}),

	addRecurring: publicProcedure
		.input(recurringInput)
		.handler(async ({ input }) => {
			const [row] = await db
				.insert(recurringExpenses)
				.values(input)
				.returning();
			if (!row) throw new Error("insert failed");
			return toRecurring(row);
		}),
	updateRecurring: publicProcedure
		.input(recurringInput.partial().merge(idInput))
		.handler(async ({ input }) => {
			const { id, ...rest } = input;
			const [row] = await db
				.update(recurringExpenses)
				.set(rest)
				.where(eq(recurringExpenses.id, id))
				.returning();
			return row ? toRecurring(row) : null;
		}),
	deleteRecurring: publicProcedure.input(idInput).handler(async ({ input }) => {
		await db
			.delete(recurringExpenses)
			.where(eq(recurringExpenses.id, input.id));
		return { ok: true };
	}),
};
