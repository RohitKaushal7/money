/**
 * Plan-driven coverage KPI (ADR-0011 revised, ADR-0014). Pure functions over the SQLite **Plan** —
 * no DB, no framework. The KPI never reads the bank statement; it is the portfolio's steady-state
 * earning power (expected interest + optional growth drawdown) over expected recurring expenses.
 *
 *     coverage =  Σ expectedMonthlyInterest(income inv)  +  imputedMonthlyDrawdown(growth inv)
 *                 ─────────────────────────────────────────────────────────────────────────────
 *                                Σ monthlyAmount(recurring expenses)
 */

import type {
	Cadence,
	CoverageBreakdown,
	DrawdownSettings,
	IncomeClass,
	Investment,
	RecurringExpense,
} from "./types";

/** Occurrences per year for the periodic cadences. Non-periodic cadences are absent (treated as 0). */
export const PERIODS_PER_YEAR: Partial<Record<Cadence, number>> = {
	daily: 365,
	weekly: 52,
	monthly: 12,
	quarterly: 4,
	half_yearly: 2,
	yearly: 1,
};

/** An investment counts toward the plan while it's active and not matured/closed. */
export function isActiveInvestment(inv: Investment): boolean {
	if (inv.active === false) return false;
	return inv.status !== "matured" && inv.status !== "closed";
}

/**
 * Expected steady-state monthly interest an income investment throws off (INR). Resolution order:
 * explicit `expectedMonthlyInterest` → `principal × annualRate ÷ 12` → 0. Growth/inactive ⇒ 0.
 */
export function expectedMonthlyInterest(inv: Investment): number {
	if (!isActiveInvestment(inv) || inv.incomeClass !== "income") return 0;
	if (inv.expectedMonthlyInterest != null) return inv.expectedMonthlyInterest;
	if (inv.principal != null && inv.annualRate != null) {
		return (inv.principal * inv.annualRate) / 12;
	}
	return 0;
}

/** Monthly-normalised amount of a recurring expense (INR): `amount × periods_per_year(cadence) ÷ 12`. */
export function monthlyAmount(exp: RecurringExpense): number {
	if (exp.active === false) return 0;
	const ppy = PERIODS_PER_YEAR[exp.cadence];
	if (!ppy) return 0; // maturity/none/unknown → not a recurring monthly cost
	return (exp.amount * ppy) / 12;
}

/** Imputed monthly drawdown from growth investments (ADR-0011): `Σ currentValue × rate ÷ 12`. 0 when disabled. */
export function imputedMonthlyDrawdown(
	investments: Investment[],
	settings: DrawdownSettings,
): number {
	if (!settings.enabled) return 0;
	const growthValue = investments
		.filter((i) => isActiveInvestment(i) && i.incomeClass === "growth")
		.reduce((sum, i) => sum + (i.currentValue ?? 0), 0);
	return (growthValue * settings.rate) / 12;
}

/** The plan-driven coverage KPI, broken into its terms. `ratio` is null when there are no expenses. */
export function coverage(input: {
	investments: Investment[];
	recurring: RecurringExpense[];
	drawdown: DrawdownSettings;
}): CoverageBreakdown {
	const interest = input.investments.reduce(
		(sum, i) => sum + expectedMonthlyInterest(i),
		0,
	);
	const drawdown = imputedMonthlyDrawdown(input.investments, input.drawdown);
	const passiveIncome = interest + drawdown;
	const expenses = input.recurring.reduce(
		(sum, e) => sum + monthlyAmount(e),
		0,
	);
	const ratio = expenses > 0 ? passiveIncome / expenses : null;
	return { interest, drawdown, passiveIncome, expenses, ratio };
}

// ── coverage ladder + wealth rollup (the total-return view; ADR-0011 revised again 2026-07-19) ────────

/** YYYY-MM-DD → sortable integer (YYYYMMDD); null if absent/unparseable. */
function dateNum(iso: string | undefined): number | null {
	if (!iso) return null;
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
	return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : null;
}

/** Matured once flagged, or once `maturityDate` is strictly before `today` (YYYY-MM-DD). */
export function isMatured(inv: Investment, today?: string): boolean {
	if (inv.status === "matured" || inv.status === "closed") return true;
	const m = dateNum(inv.maturityDate);
	const t = dateNum(today);
	return m != null && t != null && m < t;
}

/** Live for plan math: flagged active and not matured (auto-expires past `maturityDate` when `today` is given). */
export function isLive(inv: Investment, today?: string): boolean {
	return inv.active !== false && !isMatured(inv, today);
}

/** The holding's total expected monthly return (INR), whether or not it's paid as cash. */
export function monthlyReturn(inv: Investment): number {
	if (inv.expectedMonthlyInterest != null) return inv.expectedMonthlyInterest;
	const base = inv.currentValue ?? inv.principal;
	return base != null && inv.annualRate != null
		? (base * inv.annualRate) / 12
		: 0;
}

export interface LadderTier {
	/** monthly INR feeding this tier */
	income: number;
	/** income / expenses; null when there are no expenses */
	ratio: number | null;
}

/** Three nested coverage tiers (ADR-0011 revised): cash-in-hand ⊆ fixed-income ⊆ total return. */
export interface CoverageLadder {
	expenses: number;
	/** interest actually deposited to the account (income holdings with payout = cash) */
	cash: LadderTier;
	/** every income-class holding's expected return (cash + accruing) */
	fixed: LadderTier;
	/** every holding's expected return, including growth/equity */
	total: LadderTier;
}

export function coverageLadder(input: {
	investments: Investment[];
	recurring: RecurringExpense[];
	today?: string;
}): CoverageLadder {
	const expenses = input.recurring.reduce((s, e) => s + monthlyAmount(e), 0);
	let cash = 0;
	let fixed = 0;
	let total = 0;
	for (const inv of input.investments) {
		if (!isLive(inv, input.today)) continue;
		const r = monthlyReturn(inv);
		total += r;
		if (inv.incomeClass === "income") {
			fixed += r;
			if (inv.payout === "cash") cash += r;
		}
	}
	const ratio = (n: number) => (expenses > 0 ? n / expenses : null);
	return {
		expenses,
		cash: { income: cash, ratio: ratio(cash) },
		fixed: { income: fixed, ratio: ratio(fixed) },
		total: { income: total, ratio: ratio(total) },
	};
}

/** A holding or a group of holdings, rolled up with a value-weighted annual rate. */
export interface HoldingRollup {
	/** group name when grouped, else null (a standalone holding) */
	group: string | null;
	name: string;
	value: number;
	/** value-weighted annual return across members; null if no value */
	rate: number | null;
	monthly: number;
	/** fraction of total live wealth */
	share: number;
	incomeClass: IncomeClass;
	/** 1 member for standalone; N for a group */
	members: Investment[];
	maturityDate?: string;
}

export interface WealthSummary {
	totalValue: number;
	annualReturn: number;
	/** value-weighted portfolio return = annualReturn / totalValue */
	avgRoi: number | null;
	/** return you'd need to fully cover expenses = annual expenses / totalValue */
	requiredRoi: number | null;
	/** naive runway = totalValue / annual expenses (ignores growth) */
	yearsLeft: number | null;
	monthlyExpenses: number;
	/** grouped + standalone, sorted by value desc */
	rollups: HoldingRollup[];
	/** principal sitting in matured holdings, awaiting redeploy */
	maturedValue: number;
}

export function wealthSummary(input: {
	investments: Investment[];
	recurring: RecurringExpense[];
	today?: string;
}): WealthSummary {
	const live = input.investments.filter((i) => isLive(i, input.today));
	const totalValue = live.reduce((s, i) => s + (i.currentValue ?? 0), 0);
	const annualReturn = live.reduce((s, i) => s + monthlyReturn(i) * 12, 0);
	const monthlyExpenses = input.recurring.reduce(
		(s, e) => s + monthlyAmount(e),
		0,
	);
	const annualExpenses = monthlyExpenses * 12;

	const byGroup = new Map<string, Investment[]>();
	const singles: Investment[] = [];
	for (const inv of live) {
		if (inv.group) {
			const arr = byGroup.get(inv.group) ?? [];
			arr.push(inv);
			byGroup.set(inv.group, arr);
		} else {
			singles.push(inv);
		}
	}

	const rollups: HoldingRollup[] = [];
	for (const [group, members] of byGroup) {
		const value = members.reduce((s, i) => s + (i.currentValue ?? 0), 0);
		const monthly = members.reduce((s, i) => s + monthlyReturn(i), 0);
		rollups.push({
			group,
			name: group,
			value,
			rate: value > 0 ? (monthly * 12) / value : null,
			monthly,
			share: totalValue > 0 ? value / totalValue : 0,
			incomeClass: members[0]?.incomeClass ?? "income",
			members,
		});
	}
	for (const inv of singles) {
		const value = inv.currentValue ?? 0;
		rollups.push({
			group: null,
			name: inv.name,
			value,
			rate: inv.annualRate ?? null,
			monthly: monthlyReturn(inv),
			share: totalValue > 0 ? value / totalValue : 0,
			incomeClass: inv.incomeClass,
			members: [inv],
			maturityDate: inv.maturityDate,
		});
	}
	rollups.sort((a, b) => b.value - a.value);

	return {
		totalValue,
		annualReturn,
		avgRoi: totalValue > 0 ? annualReturn / totalValue : null,
		requiredRoi: totalValue > 0 ? annualExpenses / totalValue : null,
		yearsLeft: annualExpenses > 0 ? totalValue / annualExpenses : null,
		monthlyExpenses,
		rollups,
		maturedValue: input.investments
			.filter((i) => i.active !== false && isMatured(i, input.today))
			.reduce((s, i) => s + (i.currentValue ?? 0), 0),
	};
}
