import { CATEGORY_BY_KEY } from "./categories";
import { monthlyAmount } from "./plan";
import type { RecurringExpense } from "./types";

/**
 * **Spending trends** (issue 009) — the "where's it going, and is it creeping up" lens. Pure compute over
 * the categorised statement actuals (DuckDB `v_category_monthly`, expense rows) plus the plan's recurring
 * budget (SQLite), framework-agnostic like {@link reconcile}. The API router is a thin shell around this.
 *
 * The output is a **movers table**: one row per expense category with a month-by-month series, the latest
 * month's spend, a delta versus its own trailing average (the creep signal), and the plan budget overlaid
 * as a reference. Rows are sorted biggest-riser-first so growing categories surface at the top.
 */

/** How much a category moved vs its recent norm. `up` = spending more (bad), `down` = less (good). */
export type SpendingTrend = "up" | "down" | "flat";

/** A raw expense row as it comes from `v_category_monthly` (debit sums are negative). */
export interface SpendingRow {
	month: string;
	categoryKey: string;
	kind: string;
	/** DuckDB `SUM(amount)` — negative for expense debits. */
	amount: number;
	n: number;
}

/** One category's trend across the window — the movers-table row. */
export interface SpendingCategory {
	key: string;
	label: string;
	/** Spend magnitude per window month, aligned to `SpendingTrends.months` (0 where none). */
	byMonth: number[];
	/** Σ spend over the window. */
	total: number;
	/** Spend in the most recent window month. */
	latest: number;
	/** Mean spend over every window month except the last (the "norm" the latest is judged against). */
	trailingAvg: number;
	/** `(latest − trailingAvg) / trailingAvg`; null when there's no baseline (single month, or norm = 0). */
	deltaPct: number | null;
	/** Bucketed direction of `deltaPct` (±10% dead-band); a first-time spend with no baseline reads `up`. */
	trend: SpendingTrend;
	/** Monthly-normalised plan budget for this category (0 when unbudgeted). */
	budget: number;
	/** `(latest − budget) / budget`; null when unbudgeted. Positive = over budget. */
	overBudgetPct: number | null;
	/** Txn count over the window. */
	n: number;
}

/** A budgeted category the statement has no categorised spend for yet — shown as a footnote, not a row. */
export interface BudgetedNoActual {
	key: string;
	label: string;
	budget: number;
}

export interface SpendingTrends {
	/** Window months, ascending — the sparkline columns. */
	months: string[];
	/** Movers, biggest-riser-first. */
	categories: SpendingCategory[];
	/** Total spend per window month (all expense categories). */
	totalByMonth: number[];
	/** Σ spend over the whole window. */
	grandTotal: number;
	/** Spend in the latest window month. */
	latestTotal: number;
	/** Σ monthly plan budget across every budgeted expense category. */
	totalBudget: number;
	/** Budgeted categories with no categorised actuals yet (the "improve your rules" nudge). */
	budgetedNoActual: BudgetedNoActual[];
}

export interface SpendingInput {
	rows: SpendingRow[];
	recurring: RecurringExpense[];
	/** Explicit window (ascending). Defaults to every month present in `rows`. */
	months?: string[];
}

/** ±10% dead-band so ordinary wobble reads as "flat", not a move. */
const MOVE_BAND = 0.1;

/** Monthly plan budget per expense category = Σ monthlyAmount over recurring expenses in that category. */
function budgetByCategory(recurring: RecurringExpense[]): Map<string, number> {
	const out = new Map<string, number>();
	for (const exp of recurring) {
		if (!exp.category) continue;
		if (CATEGORY_BY_KEY.get(exp.category)?.kind !== "expense") continue;
		const m = monthlyAmount(exp);
		if (m <= 0) continue;
		out.set(exp.category, (out.get(exp.category) ?? 0) + m);
	}
	return out;
}

function classify(
	latest: number,
	trailingAvg: number,
): {
	deltaPct: number | null;
	trend: SpendingTrend;
} {
	if (trailingAvg > 0) {
		const deltaPct = (latest - trailingAvg) / trailingAvg;
		const trend =
			deltaPct > MOVE_BAND ? "up" : deltaPct < -MOVE_BAND ? "down" : "flat";
		return { deltaPct, trend };
	}
	// No baseline: a first appearance of spend reads as a rise; genuine zero is flat.
	return { deltaPct: null, trend: latest > 0 ? "up" : "flat" };
}

/** Internal sort key: risers (or new spend) first, fallers last. */
function moverScore(c: SpendingCategory): number {
	if (c.deltaPct != null) return c.deltaPct;
	return c.trend === "up" ? Number.POSITIVE_INFINITY : 0;
}

export function spendingTrends(input: SpendingInput): SpendingTrends {
	const expenses = input.rows.filter((r) => r.kind === "expense");
	const months =
		input.months ?? [...new Set(expenses.map((r) => r.month))].sort();
	const monthIndex = new Map(months.map((m, i) => [m, i]));
	const budgets = budgetByCategory(input.recurring);

	// Pivot: category → per-month spend magnitude (+ txn count).
	const pivots = new Map<string, { byMonth: number[]; n: number }>();
	for (const r of expenses) {
		const i = monthIndex.get(r.month);
		if (i === undefined) continue; // outside the explicit window
		const p = pivots.get(r.categoryKey) ?? {
			byMonth: new Array(months.length).fill(0),
			n: 0,
		};
		p.byMonth[i] += -r.amount; // debit magnitude
		p.n += r.n;
		pivots.set(r.categoryKey, p);
	}

	const categories: SpendingCategory[] = [];
	for (const [key, p] of pivots) {
		const total = p.byMonth.reduce((s, v) => s + v, 0);
		if (total <= 0) continue;
		const latest = p.byMonth[months.length - 1] ?? 0;
		const priorMonths = p.byMonth.slice(0, -1);
		const hasBaseline = priorMonths.length > 0;
		const trailingAvg = hasBaseline
			? priorMonths.reduce((s, v) => s + v, 0) / priorMonths.length
			: 0;
		// A single-month window has no baseline at all → flat; a category new to a multi-month
		// window has a zero baseline → `classify` reads that first spend as a rise.
		const { deltaPct, trend } = hasBaseline
			? classify(latest, trailingAvg)
			: { deltaPct: null as number | null, trend: "flat" as SpendingTrend };
		const budget = budgets.get(key) ?? 0;
		categories.push({
			key,
			label: CATEGORY_BY_KEY.get(key)?.label ?? key,
			byMonth: p.byMonth,
			total,
			latest,
			trailingAvg,
			deltaPct,
			trend,
			budget,
			overBudgetPct: budget > 0 ? (latest - budget) / budget : null,
			n: p.n,
		});
	}
	categories.sort((a, b) => moverScore(b) - moverScore(a));

	const totalByMonth = months.map((_, i) =>
		categories.reduce((s, c) => s + (c.byMonth[i] ?? 0), 0),
	);

	// Budgeted categories with no categorised spend — surfaced as a footnote, not a phantom ₹0 row.
	const spentKeys = new Set(categories.map((c) => c.key));
	const budgetedNoActual: BudgetedNoActual[] = [];
	for (const [key, budget] of budgets) {
		if (spentKeys.has(key)) continue;
		budgetedNoActual.push({
			key,
			label: CATEGORY_BY_KEY.get(key)?.label ?? key,
			budget,
		});
	}
	budgetedNoActual.sort((a, b) => b.budget - a.budget);

	return {
		months,
		categories,
		totalByMonth,
		grandTotal: totalByMonth.reduce((s, v) => s + v, 0),
		latestTotal: totalByMonth[months.length - 1] ?? 0,
		totalBudget: [...budgets.values()].reduce((s, v) => s + v, 0),
		budgetedNoActual,
	};
}

/** recharts dataKey for the rolled-up "Other" series (category keys never collide with this sentinel). */
export const OTHER_KEY = "__other__";

/** A stack series in {@link SpendHistory}: a top-N category, or the synthetic "Other" rollup. */
export interface SpendHistorySeries {
	/** recharts dataKey — a category key, or {@link OTHER_KEY}. */
	key: string;
	/** Legend/tooltip label. */
	label: string;
	/** True for the "Other" rollup series. */
	isOther: boolean;
}

/** {@link SpendingTrends} reshaped for a monthly stacked bar chart: top-N categories + an "Other" bucket. */
export interface SpendHistory {
	/** Window months ascending ("YYYY-MM"). */
	months: string[];
	/** Stack series bottom→top: top-N categories by window total (desc), then "Other" (if any) last. */
	series: SpendHistorySeries[];
	/** `series.key` → per-month spend, aligned to {@link months}. */
	amounts: Record<string, number[]>;
	/** Total spend per month (every category), aligned to {@link months}. */
	totalByMonth: number[];
	/** Monthly plan budget; 0 means the caller draws no budget line. */
	budget: number;
}

/**
 * Reshape {@link SpendingTrends} into stacked-bar series: the `topN` biggest-by-total categories keep their
 * own series; every remaining category folds into one "Other" bucket summed per month. Bars built from
 * `amounts` sum to `totalByMonth` exactly. Pure — does not mutate `trends`.
 */
export function spendHistory(trends: SpendingTrends, topN = 5): SpendHistory {
	const sorted = [...trends.categories].sort((a, b) => b.total - a.total);
	const named = sorted.slice(0, topN);
	const rest = sorted.slice(topN);

	const series: SpendHistorySeries[] = named.map((c) => ({
		key: c.key,
		label: c.label,
		isOther: false,
	}));
	const amounts: Record<string, number[]> = {};
	for (const c of named) amounts[c.key] = c.byMonth;

	if (rest.length > 0) {
		amounts[OTHER_KEY] = trends.months.map((_, i) =>
			rest.reduce((s, c) => s + (c.byMonth[i] ?? 0), 0),
		);
		series.push({ key: OTHER_KEY, label: "Other", isOther: true });
	}

	return {
		months: trends.months,
		series,
		amounts,
		totalByMonth: trends.totalByMonth,
		budget: trends.totalBudget,
	};
}
