import { CATEGORY_BY_KEY } from "./categories";

/**
 * **Money flow** — the income-allocation lens behind the Spending "Flow" tab (a Sankey). Pure compute over
 * the categorised actuals (DuckDB `v_category_monthly`, all kinds), framework-agnostic like
 * {@link spendingTrends}. The API router is a thin shell; the web component turns this into nodes + links.
 *
 * The story it tells is the north-star one: of everything that came in this period, how much was **spent**,
 * how much became **investments** (future passive income), and how much stayed liquid as **savings** — with
 * income split by active vs passive so the KPI (passive ÷ expenses) is visible on the left.
 *
 * Two modelling choices, both decided against real data:
 * - **Transfers are excluded**, *except* matured investment principal (`investment_redemption`), which is
 *   **netted against gross investments** so "Bonds" shows *net new capital*, not principal recycled from a
 *   maturity into the next bond. Without this, an investment-churn-heavy account reads as a false drawdown.
 * - The residual (income − expenses − net investments) becomes a **Savings** sink when positive, or a
 *   **reserves drawdown** inflow when negative (spend + net-invest genuinely exceeded income this period).
 *
 * Everything is a **monthly average** over the window: a category's summed amount ÷ the number of window
 * months, so a lumpy annual payment reads as its per-month share, comparable to a budget.
 */

/** A raw row from `v_category_monthly` — every kind; `amount` is signed (credit +, debit −). */
export interface MoneyFlowRow {
	month: string;
	categoryKey: string;
	kind: string;
	amount: number;
	n: number;
}

/** One node on the income or allocation side — a monthly-average magnitude, always ≥ 0. */
export interface FlowLeaf {
	key: string;
	label: string;
	/** Monthly-average magnitude in INR, ≥ 0. */
	value: number;
}

export interface MoneyFlowInput {
	rows: MoneyFlowRow[];
	/** Explicit window (ascending "YYYY-MM"); the average divides by its length. */
	months: string[];
}

export interface MoneyFlow {
	/** Window months, ascending. */
	months: string[];
	/** Denominator of the average = `months.length`. */
	monthsCount: number;
	/** Active-income sources (salary, freelance), biggest first. */
	incomeActive: FlowLeaf[];
	/** Passive-income sources, biggest first, with sub-₹1k sources folded into "Other passive". */
	incomePassive: FlowLeaf[];
	/** Expense categories, biggest first. */
	expenses: FlowLeaf[];
	/** Investment categories net of matured-principal redemptions, biggest first. */
	investments: FlowLeaf[];
	incomeActiveTotal: number;
	incomePassiveTotal: number;
	incomeTotal: number;
	expenseTotal: number;
	/** Σ net investments (gross minus {@link redemptionNetted}). */
	investTotal: number;
	/** Residual kept liquid (income − expenses − net investments) when positive, else 0. */
	savings: number;
	/** Shortfall drawn from reserves when spend + net-invest exceed income, else 0. */
	reserves: number;
	/** Matured investment principal netted out of gross investments — a footnote, not a node. */
	redemptionNetted: number;
	/** Passive income ÷ expenses × 100 — the north-star ratio. 0 when there are no expenses. */
	passiveCoveragePct: number;
	hasData: boolean;
}

/** Passive sources below this monthly average fold into a single "Other passive" node. */
const PASSIVE_MIN = 1000;
/** The one `transfer`-kind category we keep, to net against investments. */
const REDEMPTION_KEY = "investment_redemption";
/** Synthetic key for the collapsed passive bucket (never collides with a real category key). */
export const OTHER_PASSIVE_KEY = "__other_passive__";
/** Sub-rupee monthly averages are rounding noise, not nodes. */
const EPSILON = 0.5;

const labelOf = (key: string): string => CATEGORY_BY_KEY.get(key)?.label ?? key;
const sumOf = (leaves: FlowLeaf[]): number =>
	leaves.reduce((s, l) => s + l.value, 0);

const EMPTY: MoneyFlow = {
	months: [],
	monthsCount: 0,
	incomeActive: [],
	incomePassive: [],
	expenses: [],
	investments: [],
	incomeActiveTotal: 0,
	incomePassiveTotal: 0,
	incomeTotal: 0,
	expenseTotal: 0,
	investTotal: 0,
	savings: 0,
	reserves: 0,
	redemptionNetted: 0,
	passiveCoveragePct: 0,
	hasData: false,
};

export function moneyFlow(input: MoneyFlowInput): MoneyFlow {
	const monthsCount = input.months.length;
	if (monthsCount === 0) return EMPTY;
	const inWindow = new Set(input.months);

	// Σ signed amount + txn count per category, within the window.
	const sums = new Map<string, { kind: string; amount: number }>();
	for (const r of input.rows) {
		if (!inWindow.has(r.month)) continue;
		const s = sums.get(r.categoryKey) ?? { kind: r.kind, amount: 0 };
		s.amount += r.amount;
		sums.set(r.categoryKey, s);
	}

	const avg = (v: number): number => v / monthsCount;

	const incomeActive: FlowLeaf[] = [];
	const passiveAll: FlowLeaf[] = [];
	const expenses: FlowLeaf[] = [];
	const grossInvest: FlowLeaf[] = [];
	let redemptionAvg = 0;

	for (const [key, s] of sums) {
		if (key === REDEMPTION_KEY) {
			redemptionAvg = Math.max(0, avg(s.amount)); // a credit — money returned
			continue;
		}
		const m = avg(s.amount);
		if (s.kind === "active_income") {
			if (m > EPSILON)
				incomeActive.push({ key, label: labelOf(key), value: m });
		} else if (s.kind === "passive_income") {
			if (m > EPSILON) passiveAll.push({ key, label: labelOf(key), value: m });
		} else if (s.kind === "expense") {
			const mag = -m; // debits are negative
			if (mag > EPSILON)
				expenses.push({ key, label: labelOf(key), value: mag });
		} else if (s.kind === "investment") {
			const mag = -m;
			if (mag > EPSILON)
				grossInvest.push({ key, label: labelOf(key), value: mag });
		}
	}

	// Net matured principal out of gross investments, largest category first (redemptions are almost
	// entirely bond maturities recycled into new bonds — so the biggest investment absorbs them).
	grossInvest.sort((a, b) => b.value - a.value);
	let remaining = redemptionAvg;
	const investments: FlowLeaf[] = [];
	for (const leaf of grossInvest) {
		const cut = Math.min(remaining, leaf.value);
		remaining -= cut;
		const net = leaf.value - cut;
		if (net > EPSILON) investments.push({ ...leaf, value: net });
	}
	const redemptionNetted = redemptionAvg - remaining;

	// Fold sub-₹1k passive sources into one "Other passive" node so the left side stays legible.
	passiveAll.sort((a, b) => b.value - a.value);
	const incomePassive: FlowLeaf[] = [];
	let otherPassive = 0;
	for (const leaf of passiveAll) {
		if (leaf.value >= PASSIVE_MIN) incomePassive.push(leaf);
		else otherPassive += leaf.value;
	}
	if (otherPassive > EPSILON)
		incomePassive.push({
			key: OTHER_PASSIVE_KEY,
			label: "Other passive",
			value: otherPassive,
		});

	incomeActive.sort((a, b) => b.value - a.value);
	expenses.sort((a, b) => b.value - a.value);
	investments.sort((a, b) => b.value - a.value);

	const incomeActiveTotal = sumOf(incomeActive);
	const incomePassiveTotal = sumOf(incomePassive);
	const incomeTotal = incomeActiveTotal + incomePassiveTotal;
	const expenseTotal = sumOf(expenses);
	const investTotal = sumOf(investments);
	const residual = incomeTotal - expenseTotal - investTotal;

	return {
		months: input.months,
		monthsCount,
		incomeActive,
		incomePassive,
		expenses,
		investments,
		incomeActiveTotal,
		incomePassiveTotal,
		incomeTotal,
		expenseTotal,
		investTotal,
		savings: Math.max(0, residual),
		reserves: Math.max(0, -residual),
		redemptionNetted,
		passiveCoveragePct:
			expenseTotal > 0 ? (incomePassiveTotal / expenseTotal) * 100 : 0,
		hasData: incomeTotal > 0 || expenseTotal > 0 || investTotal > 0,
	};
}
