import { db, investments, recurringExpenses, settings } from "@money/db";
import {
	CADENCES,
	type CoverageBreakdown,
	coverage,
	type DrawdownSettings,
	INVESTMENT_TYPES,
	type Investment,
	type RecurringExpense,
} from "@money/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { publicProcedure } from "../index";

/**
 * The **Plan** router (ADR-0011 revised / ADR-0014) — reads and writes the SQLite plan (investments +
 * recurring expenses + drawdown settings) and computes the plan-driven coverage KPI. No DuckDB here; this
 * is durable app state, not statement actuals.
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
		principal: r.principal ?? undefined,
		annualRate: r.annualRate ?? undefined,
		expectedMonthlyInterest: r.expectedMonthlyInterest ?? undefined,
		interestCadence: (r.interestCadence as Investment["interestCadence"]) ?? undefined,
		principalCadence: (r.principalCadence as Investment["principalCadence"]) ?? undefined,
		startDate: r.startDate ?? undefined,
		maturityDate: r.maturityDate ?? undefined,
		actionOnMaturity: (r.actionOnMaturity as Investment["actionOnMaturity"]) ?? undefined,
		currentValue: r.currentValue ?? undefined,
		status: (r.status as Investment["status"]) ?? undefined,
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
		startDate: r.startDate ?? undefined,
		endDate: r.endDate ?? undefined,
		source: (r.source as RecurringExpense["source"]) ?? undefined,
	};
}

async function listInvestments(): Promise<Investment[]> {
	const rows = await db.select().from(investments);
	return rows.map(toInvestment);
}

async function listRecurring(): Promise<RecurringExpense[]> {
	const rows = await db.select().from(recurringExpenses);
	return rows.map(toRecurring);
}

/** Read the drawdown toggle/rate from the key/value `settings` store, with ADR-0011 defaults. */
async function readDrawdown(): Promise<DrawdownSettings> {
	const rows = await db.select().from(settings);
	const map = new Map(rows.map((r) => [r.key, r.value]));
	const enabled = map.get("drawdown_enabled");
	const rate = map.get("drawdown_rate");
	return {
		enabled: typeof enabled === "boolean" ? enabled : false,
		rate: typeof rate === "number" ? rate : 0.04,
	};
}

async function writeSetting(key: string, value: unknown): Promise<void> {
	await db
		.insert(settings)
		.values({ key, value })
		.onConflictDoUpdate({ target: settings.key, set: { value } });
}

// ── input schemas ──────────────────────────────────────────────────────────────────────────────────
const investmentInput = z.object({
	name: z.string().min(1),
	type: z.enum(INVESTMENT_TYPES),
	incomeClass: z.enum(["income", "growth"]),
	platform: z.string().optional(),
	principal: z.number().nonnegative().optional(),
	annualRate: z.number().optional(),
	expectedMonthlyInterest: z.number().optional(),
	interestCadence: z.enum(CADENCES).optional(),
	principalCadence: z.enum(CADENCES).optional(),
	startDate: z.string().optional(),
	maturityDate: z.string().optional(),
	actionOnMaturity: z.enum(["reinvest", "withdraw", "auto_renew"]).optional(),
	currentValue: z.number().optional(),
	status: z.enum(["active", "matured", "closed"]).optional(),
	isPassiveIncomeSource: z.boolean().optional(),
	active: z.boolean().optional(),
});

const recurringInput = z.object({
	name: z.string().min(1),
	category: z.string().optional(),
	amount: z.number(),
	cadence: z.enum(["monthly", "quarterly", "half_yearly", "yearly"]).default("monthly"),
	active: z.boolean().optional(),
	startDate: z.string().optional(),
	endDate: z.string().optional(),
	source: z.enum(["manual", "seeded"]).optional(),
});

const idInput = z.object({ id: z.coerce.number().int().positive() });

export const planRouter = {
	/** The plan-driven coverage KPI, broken into its terms (ADR-0011 revised). */
	coverage: publicProcedure.handler(async (): Promise<CoverageBreakdown> => {
		const [invs, recs, drawdown] = await Promise.all([
			listInvestments(),
			listRecurring(),
			readDrawdown(),
		]);
		return coverage({ investments: invs, recurring: recs, drawdown });
	}),

	investments: publicProcedure.handler(() => listInvestments()),
	recurring: publicProcedure.handler(() => listRecurring()),
	settings: publicProcedure.handler(() => readDrawdown()),

	addInvestment: publicProcedure.input(investmentInput).handler(async ({ input }) => {
		const [row] = await db.insert(investments).values(input).returning();
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
	deleteInvestment: publicProcedure.input(idInput).handler(async ({ input }) => {
		await db.delete(investments).where(eq(investments.id, input.id));
		return { ok: true };
	}),

	addRecurring: publicProcedure.input(recurringInput).handler(async ({ input }) => {
		const [row] = await db.insert(recurringExpenses).values(input).returning();
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
		await db.delete(recurringExpenses).where(eq(recurringExpenses.id, input.id));
		return { ok: true };
	}),

	/** Flip / retune the imputed-drawdown term (ADR-0011). Returns the resolved settings. */
	setDrawdown: publicProcedure
		.input(z.object({ enabled: z.boolean().optional(), rate: z.number().min(0).max(1).optional() }))
		.handler(async ({ input }) => {
			if (input.enabled !== undefined) await writeSetting("drawdown_enabled", input.enabled);
			if (input.rate !== undefined) await writeSetting("drawdown_rate", input.rate);
			return readDrawdown();
		}),
};
