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
	const expenses = input.recurring.reduce((sum, e) => sum + monthlyAmount(e), 0);
	const ratio = expenses > 0 ? passiveIncome / expenses : null;
	return { interest, drawdown, passiveIncome, expenses, ratio };
}
