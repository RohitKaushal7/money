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
	cadence: z.enum(["monthly", "quarterly", "half_yearly", "yearly"]),
	active: z.boolean().optional(),
	startDate: z.string().optional(),
	endDate: z.string().optional(),
	source: z.enum(["manual", "seeded"]).optional(),
});

// The monthly default belongs to *adding* an expense only. Zod applies `.default()` even under
// `.partial()`, so keeping it on the shared schema made a partial edit silently reset the cadence.
const newRecurringInput = recurringInput.extend({
	cadence: recurringInput.shape.cadence.default("monthly"),
});

const idInput = z.object({ id: z.coerce.number().int().positive() });

// ── MCP tool descriptions ──────────────────────────────────────────────────────────────────────────
const INVESTMENT_FIELDS = [
	"Fields:",
	"`name` (text, what the owner calls the holding);",
	"`type` (bond | p2p | fd | ncd | savings | equity | mutual_fund | gold | other);",
	"`incomeClass` (income = pays out interest or coupons, growth = only appreciates);",
	"`platform` (where it is held, e.g. a broker or bank) and `group` (a heading holdings are rolled up under);",
	"`payout` (cash = interest lands in the bank account, accrue = it compounds or is paid at maturity);",
	"`principal` (amount originally invested);",
	"`currentValue` (what the holding is worth today — not the amount invested);",
	"`annualRate` (expected annual return as a pre-tax fraction: 0.1175 = 11.75%);",
	"`expectedMonthlyInterest` (interest expected per month; when given it overrides the computed principal × annualRate ÷ 12);",
	"`interestCadence` / `principalCadence` (how often interest / principal is paid: daily | weekly | monthly | quarterly | half_yearly | yearly | maturity | none);",
	"`startDate` / `maturityDate` (YYYY-MM-DD);",
	"`actionOnMaturity` (reinvest | withdraw | auto_renew);",
	"`currency` (ISO 4217 code, default INR; principal, currentValue and expectedMonthlyInterest are amounts in this currency);",
	"`status` (active | matured | closed);",
	"`isPassiveIncomeSource` (true if its income counts toward covering monthly expenses);",
	"`active` (false hides it from the plan without deleting it).",
].join(" ");

const RECURRING_FIELDS = [
	"Fields:",
	"`name` (text, what the expense is);",
	"`category` (free-text spending category);",
	"`amount` (amount paid each period, in the expense's `currency`);",
	"`currency` (ISO 4217 code, default INR);",
	"`cadence` (how often it is paid: monthly | quarterly | half_yearly | yearly; default monthly);",
	"`startDate` / `endDate` (YYYY-MM-DD; the expense only counts between them);",
	"`active` (false stops it counting without deleting it);",
	"`source` (manual | seeded).",
].join(" ");

/** Today as YYYY-MM-DD (server clock) — drives auto-expiry of matured holdings. */
/** Today on the server clock, `YYYY-MM-DD` — the reference date every plan/expiry compute is drawn against. */
export function todayISO(): string {
	return new Date().toISOString().slice(0, 10);
}

export const planRouter = {
	/** Three nested coverage tiers: cash-in-hand ⊆ fixed-income ⊆ total return (ADR-0015). INR aggregates. */
	ladder: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"The owner's headline KPI: how much of their monthly expenses is covered by passive income, in three nested tiers computed from the plan (holdings and recurring expenses, not bank statements). Takes no input. Returns `expenses` (total monthly recurring expenses, INR) and three tiers `cash`, `fixed`, `total`, each `{ income, ratio }`: `income` is monthly INR and `ratio` is income ÷ expenses (1 = fully covered, null when there are no expenses). `cash` = interest actually deposited to the bank (income holdings with payout cash); `fixed` = every income-class holding's expected return (cash + accruing); `total` = every holding's expected return including growth holdings. Foreign-currency amounts are converted to INR. When the owner's after-tax switch is on, income-holding returns are netted by their marginal tax rate. Side effect: it also saves this month's snapshot for the coverage history.",
			},
		})
		.handler(async ({ context }) => {
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
	coverageHistory: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"The KPI over time: one entry per month for which a plan snapshot was captured, each replayed through the current coverage ladder (same cash / fixed / total tiers as the ladder tool, ratios are income ÷ expenses). Takes no input. Empty until the first snapshot exists; there is no backfill, so history only starts from when the app first recorded a month. Honours the owner's after-tax switch.",
			},
		})
		.handler(async ({ context }) => {
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
	wealth: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"Portfolio rollup of the owner's plan in INR: total wealth (sum of each holding's `currentValue`, today's value, not the amount invested), holdings rolled up by `group` (standalone holdings alone), each with value, share of wealth, a value-weighted pre-tax `rate`, expected `monthly` return and its member holdings, sorted by value; `annualReturn` (INR per year); `avgRoi` (portfolio return as a fraction of total value); `requiredRoi` (the return needed to cover all expenses, as a fraction); `monthlyExpenses` (INR); and `maturedValue` (principal sitting in matured holdings awaiting redeployment). Takes no input. Every rate returned is a pre-tax fraction (0.1175 = 11.75%) exactly as the owner entered it; only the rupee return figures are netted by tax when the owner's after-tax switch is on. Foreign-currency holdings are converted to INR.",
			},
		})
		.handler(async ({ context }) => {
			const [invs, recs, rates, afterTax, taxRate] = await Promise.all([
				listInvestments(context.appDb),
				listRecurring(context.appDb),
				loadRates(context.controlDb),
				loadAfterTaxEnabled(context.appDb),
				loadKpiTaxRate(context.appDb, context.uid),
			]);
			// Holdings go in gross; the summary nets only the ₹ returns, so every rate it hands back is the
			// pre-tax one the owner entered — never a netted figure an editor could save back as pre-tax.
			return wealthSummary({
				investments: invs.map((i) => investmentToInr(i, rates)),
				recurring: recs.map((r) => recurringToInr(r, rates)),
				today: todayISO(),
				taxRate: afterTax ? taxRate : 0,
			});
		}),

	investments: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"List every holding (investment) in the owner's plan, including inactive and matured ones. Takes no input. Each holding has: `id` (string; pass it as a number to the edit and delete tools), `name`, `type`, `incomeClass` (income | growth), `valuationSource`, `isPassiveIncomeSource`, `active`, `platform`, `group`, `payout` (cash | accrue), `principal` (amount originally invested), `currentValue` (worth today, not the amount invested), `annualRate` (pre-tax fraction, 0.1175 = 11.75%), `expectedMonthlyInterest` (when set it overrides principal/currentValue × annualRate ÷ 12), `interestCadence`, `principalCadence`, `startDate`, `maturityDate` (YYYY-MM-DD), `actionOnMaturity`, `status` (active | matured | closed) and `currency`; money amounts are in that `currency` (INR unless stated). Absent fields are omitted.",
			},
		})
		.handler(({ context }) => listInvestments(context.appDb)),
	recurring: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"List every recurring expense in the owner's plan — the committed outflows passive income has to cover — including inactive ones. Takes no input. Each has `id` (string; pass it as a number to the edit and delete tools), `name`, `category`, `amount` (paid each period, in the expense's `currency`, INR unless stated), `cadence` (monthly | quarterly | half_yearly | yearly), `active`, `currency`, `startDate` / `endDate` (YYYY-MM-DD) and `source` (manual | seeded). To compare expenses, divide by the cadence: a quarterly amount is a third of its monthly cost.",
			},
		})
		.handler(({ context }) => listRecurring(context.appDb)),

	addInvestment: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				entity: "investments",
				operation: "insert",
				description: `Add a holding (investment) to the owner's plan. Returns the new holding with its id. ${INVESTMENT_FIELDS} Required: name, type, incomeClass.`,
			},
		})
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
		.meta({
			mcp: {
				kind: "write",
				entity: "investments",
				operation: "update",
				description: `Edit one holding (investment) in the owner's plan; only the fields given change. Input: \`id\` (the holding's id) plus any of the fields below. ${INVESTMENT_FIELDS} Returns the updated holding, or null if no holding has that id. Undoable via the change log.`,
			},
		})
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
		.meta({
			mcp: {
				kind: "write",
				entity: "investments",
				operation: "delete",
				description:
					"Delete one holding (investment) from the owner's plan. Input: `id` — the holding's id (whole number). To keep it but stop counting it, set `active` to false with the edit tool instead. Undoable via the change log.",
			},
		})
		.input(idInput)
		.handler(async ({ context, input }) => {
			await context.appDb
				.delete(investments)
				.where(eq(investments.id, input.id));
			return { ok: true };
		}),

	addRecurring: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				entity: "recurring_expenses",
				operation: "insert",
				description: `Add a recurring expense — a committed outflow the passive income has to cover — to the owner's plan. Returns the new expense with its id. ${RECURRING_FIELDS} Required: name, amount.`,
			},
		})
		.input(newRecurringInput)
		.handler(async ({ context, input }) => {
			const [row] = await context.appDb
				.insert(recurringExpenses)
				.values(input)
				.returning();
			if (!row) throw new Error("insert failed");
			return toRecurring(row);
		}),
	updateRecurring: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				entity: "recurring_expenses",
				operation: "update",
				description: `Edit one recurring expense in the owner's plan; only the fields given change. Input: \`id\` (the expense's id) plus any of the fields below. ${RECURRING_FIELDS} Returns the updated expense, or null if no expense has that id. Undoable via the change log.`,
			},
		})
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
		.meta({
			mcp: {
				kind: "write",
				entity: "recurring_expenses",
				operation: "delete",
				description:
					"Delete one recurring expense from the owner's plan. Input: `id` — the expense's id (whole number). To keep it but stop counting it, set `active` to false with the edit tool instead. Undoable via the change log.",
			},
		})
		.input(idInput)
		.handler(async ({ context, input }) => {
			await context.appDb
				.delete(recurringExpenses)
				.where(eq(recurringExpenses.id, input.id));
			return { ok: true };
		}),
};
