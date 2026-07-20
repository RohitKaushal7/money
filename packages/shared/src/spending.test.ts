import { describe, expect, test } from "bun:test";
import { type SpendingRow, spendHistory, spendingTrends } from "./spending";
import type { RecurringExpense } from "./types";

/** An expense row as `v_category_monthly` yields it (debit sums are negative). */
function row(
	month: string,
	categoryKey: string,
	spent: number,
	n = 1,
): SpendingRow {
	return { month, categoryKey, kind: "expense", amount: -spent, n };
}

function exp(partial: Partial<RecurringExpense>): RecurringExpense {
	return {
		id: "e1",
		name: "budget",
		amount: 0,
		cadence: "monthly",
		active: true,
		...partial,
	};
}

describe("spendingTrends — window & pivot", () => {
	test("derives ascending month window from the rows", () => {
		const t = spendingTrends({
			rows: [
				row("2026-06", "transport", 100),
				row("2026-04", "transport", 100),
				row("2026-05", "transport", 100),
			],
			recurring: [],
		});
		expect(t.months).toEqual(["2026-04", "2026-05", "2026-06"]);
	});

	test("pivots spend into byMonth aligned to the window, magnitudes positive", () => {
		const t = spendingTrends({
			rows: [
				row("2026-04", "transport", 1500),
				row("2026-06", "transport", 8000),
			],
			recurring: [],
			months: ["2026-04", "2026-05", "2026-06"],
		});
		const c = t.categories[0];
		expect(c?.byMonth).toEqual([1500, 0, 8000]);
		expect(c?.total).toBe(9500);
		expect(c?.latest).toBe(8000);
	});

	test("sums duplicate category rows within a month and counts txns", () => {
		const t = spendingTrends({
			rows: [
				row("2026-04", "food_dining", 300, 2),
				row("2026-04", "food_dining", 200, 1),
			],
			recurring: [],
		});
		expect(t.categories[0]?.byMonth).toEqual([500]);
		expect(t.categories[0]?.n).toBe(3);
	});

	test("ignores non-expense rows", () => {
		const t = spendingTrends({
			rows: [
				{
					month: "2026-04",
					categoryKey: "p2p_payout",
					kind: "passive_income",
					amount: 5000,
					n: 1,
				},
				row("2026-04", "groceries", 900),
			],
			recurring: [],
		});
		expect(t.categories).toHaveLength(1);
		expect(t.categories[0]?.key).toBe("groceries");
	});
});

describe("spendingTrends — the creep signal", () => {
	test("latest well above trailing average reads as 'up' with a positive delta", () => {
		const t = spendingTrends({
			rows: [
				row("2026-04", "transport", 1500),
				row("2026-05", "transport", 1500),
				row("2026-06", "transport", 6000),
			],
			recurring: [],
		});
		const c = t.categories[0];
		expect(c?.trailingAvg).toBe(1500);
		expect(c?.trend).toBe("up");
		expect(c?.deltaPct).toBeCloseTo(3, 5); // (6000-1500)/1500
	});

	test("latest below trailing average reads as 'down'", () => {
		const t = spendingTrends({
			rows: [
				row("2026-04", "shopping", 10000),
				row("2026-05", "shopping", 3000),
			],
			recurring: [],
		});
		expect(t.categories[0]?.trend).toBe("down");
	});

	test("wobble inside the ±10% band reads as 'flat'", () => {
		const t = spendingTrends({
			rows: [
				row("2026-04", "groceries", 5000),
				row("2026-05", "groceries", 5200),
			],
			recurring: [],
		});
		expect(t.categories[0]?.trend).toBe("flat");
	});

	test("single-month window has no baseline: null delta, flat", () => {
		const t = spendingTrends({
			rows: [row("2026-04", "health", 3000)],
			recurring: [],
		});
		expect(t.categories[0]?.deltaPct).toBeNull();
		expect(t.categories[0]?.trend).toBe("flat");
	});

	test("first-time spend against a zero baseline reads as 'up' (null delta)", () => {
		const t = spendingTrends({
			rows: [row("2026-05", "subscription", 200)], // absent in 2026-04
			recurring: [],
			months: ["2026-04", "2026-05"],
		});
		const c = t.categories[0];
		expect(c?.trailingAvg).toBe(0);
		expect(c?.deltaPct).toBeNull();
		expect(c?.trend).toBe("up");
	});

	test("sorts biggest riser first, faller last, new-spend to the top", () => {
		const t = spendingTrends({
			rows: [
				// faller
				row("2026-04", "shopping", 10000),
				row("2026-05", "shopping", 2000),
				// riser
				row("2026-04", "transport", 1000),
				row("2026-05", "transport", 4000),
				// brand-new spend (no baseline)
				row("2026-05", "health", 500),
			],
			recurring: [],
		});
		expect(t.categories.map((c) => c.key)).toEqual([
			"health",
			"transport",
			"shopping",
		]);
	});
});

describe("spendingTrends — plan budget overlay", () => {
	test("monthly-normalises budgets and computes over/under per category", () => {
		const t = spendingTrends({
			rows: [row("2026-04", "transport", 3000)],
			recurring: [
				exp({ category: "transport", amount: 1500, cadence: "monthly" }),
			],
		});
		const c = t.categories[0];
		expect(c?.budget).toBe(1500);
		expect(c?.overBudgetPct).toBeCloseTo(1, 5); // (3000-1500)/1500 → 100% over
	});

	test("normalises a yearly budget to a monthly figure", () => {
		const t = spendingTrends({
			rows: [row("2026-04", "utilities", 1000)],
			recurring: [
				exp({ category: "utilities", amount: 1200, cadence: "yearly" }),
			],
		});
		expect(t.categories[0]?.budget).toBe(100); // 1200/12
	});

	test("sums multiple recurring expenses sharing a category", () => {
		const t = spendingTrends({
			rows: [row("2026-04", "utilities", 5000)],
			recurring: [
				exp({ id: "a", category: "utilities", amount: 1000 }),
				exp({ id: "b", category: "utilities", amount: 825 }),
			],
		});
		expect(t.categories[0]?.budget).toBe(1825);
	});

	test("unbudgeted category has budget 0 and null over-budget", () => {
		const t = spendingTrends({
			rows: [row("2026-04", "misc_expense", 400)],
			recurring: [],
		});
		expect(t.categories[0]?.budget).toBe(0);
		expect(t.categories[0]?.overBudgetPct).toBeNull();
	});

	test("inactive recurring expenses contribute no budget", () => {
		const t = spendingTrends({
			rows: [row("2026-04", "transport", 1000)],
			recurring: [exp({ category: "transport", amount: 1500, active: false })],
		});
		expect(t.categories[0]?.budget).toBe(0);
	});

	test("a non-expense category on a recurring row is ignored for budgets", () => {
		const t = spendingTrends({
			rows: [row("2026-04", "groceries", 500)],
			recurring: [exp({ category: "p2p_payout", amount: 9999 })],
		});
		expect(t.totalBudget).toBe(0);
	});

	test("budgeted category with no categorised spend is a footnote, not a row", () => {
		const t = spendingTrends({
			rows: [row("2026-04", "groceries", 500)],
			recurring: [
				exp({ id: "g", category: "groceries", amount: 5000 }),
				exp({ id: "t", category: "transport", amount: 1500 }),
			],
		});
		expect(t.categories.map((c) => c.key)).toEqual(["groceries"]);
		expect(t.budgetedNoActual).toEqual([
			{ key: "transport", label: "Transport & fuel", budget: 1500 },
		]);
	});
});

describe("spendingTrends — totals", () => {
	test("totalByMonth sums every category per column; grand + latest totals follow", () => {
		const t = spendingTrends({
			rows: [
				row("2026-04", "groceries", 1000),
				row("2026-04", "transport", 500),
				row("2026-05", "groceries", 2000),
			],
			recurring: [],
			months: ["2026-04", "2026-05"],
		});
		expect(t.totalByMonth).toEqual([1500, 2000]);
		expect(t.grandTotal).toBe(3500);
		expect(t.latestTotal).toBe(2000);
	});

	test("empty input yields empty, zeroed trends", () => {
		const t = spendingTrends({ rows: [], recurring: [] });
		expect(t.months).toEqual([]);
		expect(t.categories).toEqual([]);
		expect(t.grandTotal).toBe(0);
		expect(t.latestTotal).toBe(0);
	});
});

describe("spendHistory — stacked series", () => {
	test("keeps the top-N categories by total and rolls the rest into Other", () => {
		const t = spendingTrends({
			rows: [
				row("2026-04", "a", 100),
				row("2026-04", "b", 90),
				row("2026-04", "c", 80),
				row("2026-04", "d", 70),
				row("2026-04", "e", 60),
				row("2026-04", "f", 50),
				row("2026-04", "g", 40),
			],
			recurring: [],
		});
		const h = spendHistory(t, 5);
		expect(h.series.filter((s) => !s.isOther).map((s) => s.key)).toEqual([
			"a",
			"b",
			"c",
			"d",
			"e",
		]);
		const other = h.series.find((s) => s.isOther);
		expect(other?.label).toBe("Other");
		expect(h.amounts[other?.key ?? ""]).toEqual([90]); // 50 + 40
	});

	test("sums Other per month, aligned to the window", () => {
		const t = spendingTrends({
			rows: [
				row("2026-04", "a", 500),
				row("2026-05", "a", 500),
				row("2026-04", "b", 400),
				row("2026-05", "b", 400),
				row("2026-04", "c", 300),
				row("2026-05", "c", 300),
				row("2026-04", "d", 200),
				row("2026-05", "d", 200),
				row("2026-04", "e", 100),
				row("2026-05", "e", 100),
				row("2026-04", "f", 30), // Other, Apr only
				row("2026-05", "g", 40), // Other, May only
			],
			recurring: [],
			months: ["2026-04", "2026-05"],
		});
		const h = spendHistory(t, 5);
		const other = h.series.find((s) => s.isOther);
		expect(h.amounts[other?.key ?? ""]).toEqual([30, 40]);
	});

	test("draws no Other series when categories do not exceed N", () => {
		const t = spendingTrends({
			rows: [row("2026-04", "a", 100), row("2026-04", "b", 50)],
			recurring: [],
		});
		const h = spendHistory(t, 5);
		expect(h.series.some((s) => s.isOther)).toBe(false);
		expect(h.series).toHaveLength(2);
	});

	test("passes through months, totals and the monthly budget", () => {
		const t = spendingTrends({
			rows: [row("2026-04", "transport", 3000)],
			recurring: [
				exp({ category: "transport", amount: 1500, cadence: "monthly" }),
			],
		});
		const h = spendHistory(t, 5);
		expect(h.months).toEqual(["2026-04"]);
		expect(h.totalByMonth).toEqual([3000]);
		expect(h.budget).toBe(1500);
	});

	test("empty trends yield empty series and zero budget", () => {
		const t = spendingTrends({ rows: [], recurring: [] });
		const h = spendHistory(t, 5);
		expect(h.months).toEqual([]);
		expect(h.series).toEqual([]);
		expect(h.amounts).toEqual({});
		expect(h.budget).toBe(0);
	});
});
