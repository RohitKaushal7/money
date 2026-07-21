import { monthOf } from "./coverage-history";
import type { SpendingTrends } from "./spending";

/**
 * **Spending insights** — the window summarised, for the metrics the movers table can't say.
 *
 * `spendingTrends` answers "which category is creeping up". This answers the questions one level above it:
 * what does a typical month cost, is the level trending, is the current month even finished, and how does
 * any of it compare to the plan the north-star KPI is measured against. Pure, like everything in this
 * package — the page renders it, the router doesn't touch it.
 */

/** Months in the trailing-average window. Three is short enough to turn, long enough to ignore one spike. */
export const ROLLING_MONTHS = 3;

/**
 * A category that appears in this fraction of window months or less is treated as lumpy rather than
 * recurring — an annual tax payment lands in one month out of twenty-four and would otherwise be reported
 * as a monthly budget overrun.
 */
const LUMPY_MAX_FREQUENCY = 0.25;

/** Below this many months the frequency test is meaningless: everything looks rare in a short window. */
const LUMPY_MIN_MONTHS = 6;

/** Months in each side of the year-over-year comparison. */
const YOY_MONTHS = 12;
/** The prior period may be short (a 24-month window holds 23 complete months) but not this short. */
const YOY_MIN_PRIOR = 6;

/**
 * Recent year vs the one before, as **per-month averages**.
 *
 * Averages rather than sums because the two sides are often unequal: the default "last 24 months" window
 * contains 23 complete months once the in-progress one is excluded, so a sums comparison would either
 * refuse to render or silently compare 12 months against 11.
 */
export interface YoyComparison {
	/** Mean monthly spend over the most recent complete months. */
	recent: number;
	/** Mean monthly spend over the period before that. */
	prior: number;
	recentMonths: number;
	priorMonths: number;
	/** `(recent − prior) / prior`; null when the prior period had no spend. */
	pct: number | null;
}

export interface SpendingInsights {
	/** Mean monthly spend across the window, **excluding an in-progress month**. */
	average: number;
	/**
	 * Trailing {@link ROLLING_MONTHS}-month mean, aligned to `trends.months`. `null` until the window has
	 * filled, and `null` for an in-progress month — a part-finished month would bend the curve downward and
	 * read as a spending drop.
	 */
	rolling: (number | null)[];
	/** True when the last window month is the one we are currently living through. */
	latestIsPartial: boolean;
	/** Fraction of the latest month elapsed, 0–1. Exactly 1 when the month is complete. */
	monthElapsed: number;
	/** Days elapsed / total, for the label. Both 0 when the month is complete. */
	daysElapsed: number;
	daysInMonth: number;
	/** The latest month's spend, split by whether the category recurs or arrives in lumps. */
	latestRecurring: number;
	latestOneOff: number;
	/** Labels of the lumpy categories present in the latest month, for naming them in the copy. */
	oneOffLabels: string[];
	/** Last 12 complete months vs the 12 before; null unless the window holds 24 of them. */
	yoy: YoyComparison | null;
	/** `(average − totalBudget) / totalBudget`; null when nothing is budgeted. */
	vsBudgetPct: number | null;
}

/** Days in a "YYYY-MM". Day 0 of the next month is the last day of this one. */
function daysIn(month: string): number {
	const [y, m] = month.split("-").map(Number);
	if (!y || !m) return 30;
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function spendingInsights(
	trends: SpendingTrends,
	opts: { today?: Date } = {},
): SpendingInsights {
	const today = opts.today ?? new Date();
	const months = trends.months;
	const totals = trends.totalByMonth;
	const latest = months.at(-1);

	const latestIsPartial = latest != null && latest === monthOf(today);
	const daysInMonth = latest ? daysIn(latest) : 0;
	const daysElapsed = latestIsPartial ? today.getUTCDate() : 0;
	const monthElapsed =
		latestIsPartial && daysInMonth > 0 ? daysElapsed / daysInMonth : 1;

	// Every derived level excludes an in-progress month. Including it does not make the average slightly
	// wrong, it makes it wrong in a direction that flatters — which is the failure mode that matters.
	const complete = latestIsPartial ? totals.slice(0, -1) : totals;
	const average =
		complete.length > 0
			? complete.reduce((s, v) => s + v, 0) / complete.length
			: 0;

	const rolling: (number | null)[] = months.map((_, i) => {
		if (latestIsPartial && i === months.length - 1) return null;
		if (i < ROLLING_MONTHS - 1) return null;
		let sum = 0;
		for (let k = i - ROLLING_MONTHS + 1; k <= i; k += 1) sum += totals[k] ?? 0;
		return sum / ROLLING_MONTHS;
	});

	// Lumpy vs recurring, by how many window months a category shows up in at all.
	const lumpy = new Set<string>();
	if (months.length >= LUMPY_MIN_MONTHS) {
		for (const c of trends.categories) {
			const seen = c.byMonth.filter((v) => v > 0).length;
			if (seen / months.length <= LUMPY_MAX_FREQUENCY) lumpy.add(c.key);
		}
	}
	let latestRecurring = 0;
	let latestOneOff = 0;
	const oneOffLabels: string[] = [];
	for (const c of trends.categories) {
		const v = c.byMonth.at(-1) ?? 0;
		if (v <= 0) continue;
		if (lumpy.has(c.key)) {
			latestOneOff += v;
			oneOffLabels.push(c.label);
		} else {
			latestRecurring += v;
		}
	}

	let yoy: YoyComparison | null = null;
	const priorWindow = complete.slice(-YOY_MONTHS * 2, -YOY_MONTHS);
	if (complete.length > YOY_MONTHS && priorWindow.length >= YOY_MIN_PRIOR) {
		const recentWindow = complete.slice(-YOY_MONTHS);
		const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
		const recent = mean(recentWindow);
		const prior = mean(priorWindow);
		yoy = {
			recent,
			prior,
			recentMonths: recentWindow.length,
			priorMonths: priorWindow.length,
			pct: prior > 0 ? (recent - prior) / prior : null,
		};
	}

	return {
		average,
		rolling,
		latestIsPartial,
		monthElapsed,
		daysElapsed,
		daysInMonth,
		latestRecurring,
		latestOneOff,
		oneOffLabels,
		yoy,
		vsBudgetPct:
			trends.totalBudget > 0
				? (average - trends.totalBudget) / trends.totalBudget
				: null,
	};
}
