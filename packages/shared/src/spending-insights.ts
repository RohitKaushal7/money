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
 * Months in the **recent window** — the level the page judges you at.
 *
 * The window average spans whatever range is selected (24 months by default), which on real data is held
 * down by cheaper older months: a 24-month mean well under what the last year actually spent. The gap
 * against plan, and the coverage ratio measured against it, both read the recent level instead.
 */
export const RECENT_MONTHS = 12;

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

/**
 * How far the recent level runs above (or below) the plan budget, and **how consistently**.
 *
 * The size of the gap says how wrong the plan is; `monthsOver` says whether the plan is wrong at all. Over
 * in ten months of twelve is a budget that needs raising; over in three is three months that got away. The
 * page cannot give that advice from the rupee figure alone, which is why the tally is part of the type.
 */
export interface BudgetGap {
	/** `recentMean − totalBudget`. Positive = over. */
	gap: number;
	/** `gap / totalBudget`. */
	gapPct: number;
	/** Whether each recent-window month ran over budget, oldest first. */
	overByMonth: boolean[];
	/** Count of `true` in {@link overByMonth}. */
	monthsOver: number;
}

/**
 * How much of the picture the category breakdown can actually explain.
 *
 * Both sides of the comparison are named by category, but the two vocabularies need not overlap — spend can
 * land in categories the plan never budgets (a consolidated card bill), and the plan can budget categories
 * the statement never produces (what that card bill is *made of*). Where both are large, a per-category
 * verdict would be fiction, and the page says so rather than inventing one.
 */
export interface Attribution {
	/** Recent-window monthly spend in categories carrying no plan budget. */
	unattributableSpend: number;
	/** Budget for categories the statement produced no spend for at all. */
	unmatchedBudget: number;
}

export interface SpendingInsights {
	/** Mean monthly spend across the window, **excluding an in-progress month**. */
	average: number;
	/**
	 * Mean monthly spend over the last {@link RECENT_MONTHS} complete months — the level you are at *now*,
	 * as opposed to {@link average} over the whole selected range. Falls back to however many complete
	 * months exist; 0 when there are none.
	 */
	recentMean: number;
	/** Months actually in the recent window — `min(RECENT_MONTHS, complete months)`. */
	recentMonths: number;
	/** The recent level against the plan budget; null when nothing is budgeted. */
	gap: BudgetGap | null;
	/** What the category breakdown can and cannot account for. */
	attribution: Attribution;
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

	// The recent window, as an index range into `months` — so the per-category slices below line up with the
	// per-month totals without either side re-deriving where the window starts.
	const completeCount = complete.length;
	const recentFrom = Math.max(0, completeCount - RECENT_MONTHS);
	const recentTotals = complete.slice(recentFrom);
	const mean = (xs: number[]) =>
		xs.length > 0 ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
	const recentMean = mean(recentTotals);

	let yoy: YoyComparison | null = null;
	const priorWindow = complete.slice(-YOY_MONTHS * 2, -YOY_MONTHS);
	if (complete.length > YOY_MONTHS && priorWindow.length >= YOY_MIN_PRIOR) {
		// YOY_MONTHS and RECENT_MONTHS are the same span, so the recent side *is* `recentMean`. Sharing it
		// means the strip cannot show one number as the level and a different one as this year.
		const prior = mean(priorWindow);
		yoy = {
			recent: recentMean,
			prior,
			recentMonths: recentTotals.length,
			priorMonths: priorWindow.length,
			pct: prior > 0 ? (recentMean - prior) / prior : null,
		};
	}

	const gap: BudgetGap | null =
		trends.totalBudget > 0
			? {
					gap: recentMean - trends.totalBudget,
					gapPct: (recentMean - trends.totalBudget) / trends.totalBudget,
					// Spending exactly the budget is not over it.
					overByMonth: recentTotals.map((v) => v > trends.totalBudget),
					monthsOver: recentTotals.filter((v) => v > trends.totalBudget).length,
				}
			: null;

	const attribution: Attribution = {
		unattributableSpend: trends.categories
			.filter((c) => c.budget <= 0)
			.reduce(
				(s, c) => s + mean(c.byMonth.slice(recentFrom, completeCount)),
				0,
			),
		unmatchedBudget: trends.budgetedNoActual.reduce((s, b) => s + b.budget, 0),
	};

	return {
		average,
		recentMean,
		recentMonths: recentTotals.length,
		gap,
		attribution,
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
