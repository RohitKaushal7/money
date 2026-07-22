import { describe, expect, test } from "bun:test";
import type { SpendingCategory, SpendingTrends } from "./spending";
import {
	RECENT_MONTHS,
	ROLLING_MONTHS,
	spendingInsights,
} from "./spending-insights";

function cat(key: string, label: string, byMonth: number[]): SpendingCategory {
	const total = byMonth.reduce((s, v) => s + v, 0);
	return {
		key,
		label,
		byMonth,
		total,
		latest: byMonth.at(-1) ?? 0,
		trailingAvg: 0,
		deltaPct: null,
		trend: "flat",
		budget: 0,
		overBudgetPct: null,
		n: byMonth.filter((v) => v > 0).length,
	};
}

function trends(
	months: string[],
	categories: SpendingCategory[],
	totalBudget = 0,
	budgetedNoActual: SpendingTrends["budgetedNoActual"] = [],
): SpendingTrends {
	const totalByMonth = months.map((_, i) =>
		categories.reduce((s, c) => s + (c.byMonth[i] ?? 0), 0),
	);
	return {
		months,
		categories,
		totalByMonth,
		grandTotal: totalByMonth.reduce((s, v) => s + v, 0),
		latestTotal: totalByMonth.at(-1) ?? 0,
		totalBudget,
		budgetedNoActual,
	};
}

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

/** A category carrying a plan budget, so it counts as attributable. */
function budgeted(
	key: string,
	byMonth: number[],
	budget: number,
): SpendingCategory {
	return { ...cat(key, key, byMonth), budget };
}

/** 24 months ending in the month `today` sits in, so the last one is genuinely in progress. */
const MONTHS_24 = Array.from({ length: 24 }, (_, i) => {
	const d = new Date(Date.UTC(2024, 7 + i, 1));
	return d.toISOString().slice(0, 7);
});
const TODAY = new Date("2026-07-21T00:00:00Z");

describe("the in-progress month", () => {
	const t = trends(MONTHS_24, [
		cat(
			"rent",
			"Rent",
			MONTHS_24.map(() => 1000),
		),
	]);

	test("is recognised as partial, with the elapsed fraction", () => {
		const i = spendingInsights(t, { today: TODAY });
		expect(i.latestIsPartial).toBe(true);
		expect(i.daysElapsed).toBe(21);
		expect(i.daysInMonth).toBe(31);
		expect(i.monthElapsed).toBeCloseTo(21 / 31, 6);
	});

	test("is excluded from the average, so a half-done month can't flatter it", () => {
		const half = trends(MONTHS_24, [
			cat("rent", "Rent", [...Array(23).fill(1000), 100]),
		]);
		// 23 complete months at 1000 — the trailing 100 must not drag this down.
		expect(spendingInsights(half, { today: TODAY }).average).toBe(1000);
	});

	test("gets no rolling point — a part-month would read as a spending drop", () => {
		expect(spendingInsights(t, { today: TODAY }).rolling.at(-1)).toBeNull();
	});

	test("a window that ended in the past has no partial month at all", () => {
		const past = trends(
			["2025-01", "2025-02", "2025-03"],
			[cat("rent", "Rent", [1000, 2000, 3000])],
		);
		const i = spendingInsights(past, { today: TODAY });
		expect(i.latestIsPartial).toBe(false);
		expect(i.monthElapsed).toBe(1);
		expect(i.average).toBe(2000);
		expect(i.rolling.at(-1)).toBe(2000);
	});
});

describe("rolling average", () => {
	const months = ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05"];
	const i = spendingInsights(
		trends(months, [cat("x", "X", [100, 200, 300, 400, 500])]),
		{ today: TODAY },
	);

	test("is null until the window fills", () => {
		expect(
			i.rolling.slice(0, ROLLING_MONTHS - 1).every((v) => v === null),
		).toBe(true);
	});

	test("is the mean of the trailing window", () => {
		expect(i.rolling[2]).toBe(200); // (100+200+300)/3
		expect(i.rolling[4]).toBe(400); // (300+400+500)/3
	});

	test("smooths a one-month spike instead of following it", () => {
		const spiky = spendingInsights(
			trends(months, [cat("x", "X", [100, 100, 900, 100, 100])]),
			{ today: TODAY },
		);
		expect(spiky.rolling[2]).toBeLessThan(900 / 2);
	});
});

describe("lumpy categories", () => {
	const rent = cat(
		"rent",
		"Rent",
		MONTHS_24.map(() => 5000),
	);
	// One tax payment in the final month — the shape that produced a fake "₹40,240 over budget".
	const tax = cat("tax_paid", "Tax / TDS paid", [...Array(23).fill(0), 39_410]);

	test("a once-in-24-months payment is split out of the recurring total", () => {
		const i = spendingInsights(trends(MONTHS_24, [rent, tax]), {
			today: TODAY,
		});
		expect(i.latestOneOff).toBe(39_410);
		expect(i.latestRecurring).toBe(5000);
		expect(i.oneOffLabels).toEqual(["Tax / TDS paid"]);
	});

	test("a category present every month is never lumpy", () => {
		const i = spendingInsights(trends(MONTHS_24, [rent]), { today: TODAY });
		expect(i.latestOneOff).toBe(0);
		expect(i.oneOffLabels).toEqual([]);
	});

	test("a short window classifies nothing — everything looks rare in three months", () => {
		const short = trends(
			["2026-05", "2026-06", "2026-07"],
			[cat("tax_paid", "Tax", [0, 0, 39_410])],
		);
		expect(spendingInsights(short, { today: TODAY }).latestOneOff).toBe(0);
	});
});

describe("year over year", () => {
	test("compares the last 12 complete months against the 12 before", () => {
		const months = Array.from({ length: 25 }, (_, i) =>
			new Date(Date.UTC(2024, 6 + i, 1)).toISOString().slice(0, 7),
		);
		// 24 complete months: 12 at 1000, then 12 at 1500. The 25th is in progress and ignored.
		const values = [...Array(12).fill(1000), ...Array(12).fill(1500), 99];
		const i = spendingInsights(trends(months, [cat("x", "X", values)]), {
			today: TODAY,
		});
		expect(i.yoy?.prior).toBe(1000);
		expect(i.yoy?.recent).toBe(1500);
		expect(i.yoy?.pct).toBeCloseTo(0.5, 6);
	});

	/**
	 * The regression that matters: the app's default window is "last 24 months", which holds 23 complete
	 * months once the in-progress one is dropped. Requiring 24 made this metric unreachable by default.
	 */
	test("still renders on a 24-month window, comparing 12 months against 11", () => {
		const values = [...Array(11).fill(1000), ...Array(12).fill(2000), 50];
		const i = spendingInsights(trends(MONTHS_24, [cat("x", "X", values)]), {
			today: TODAY,
		});
		expect(i.yoy?.recentMonths).toBe(12);
		expect(i.yoy?.priorMonths).toBe(11);
		expect(i.yoy?.pct).toBeCloseTo(1, 6);
	});

	test("unequal periods compare fairly, because the sides are per-month averages", () => {
		// 12 recent months at 1000 and 6 prior at 1000 is flat — a sums comparison would call it +100%.
		const months = Array.from({ length: 18 }, (_, i) =>
			new Date(Date.UTC(2025, i, 1)).toISOString().slice(0, 7),
		);
		const i = spendingInsights(
			trends(months, [
				cat(
					"x",
					"X",
					months.map(() => 1000),
				),
			]),
			{ today: TODAY },
		);
		expect(i.yoy?.pct).toBe(0);
	});

	test("is withheld when the prior period is too short to mean anything", () => {
		const months = Array.from({ length: 15 }, (_, i) =>
			new Date(Date.UTC(2025, i, 1)).toISOString().slice(0, 7),
		);
		expect(
			spendingInsights(
				trends(months, [
					cat(
						"x",
						"X",
						months.map(() => 1000),
					),
				]),
				{
					today: TODAY,
				},
			).yoy,
		).toBeNull();
	});
});

describe("against the plan budget", () => {
	test("reports how far actual spending runs above what is budgeted", () => {
		const t = trends(
			["2026-01", "2026-02"],
			[cat("x", "X", [90_000, 110_000])],
			50_000,
		);
		expect(spendingInsights(t, { today: TODAY }).vsBudgetPct).toBeCloseTo(1, 6);
	});

	test("is null when nothing is budgeted, rather than dividing by zero", () => {
		const t = trends(["2026-01"], [cat("x", "X", [90_000])]);
		expect(spendingInsights(t, { today: TODAY }).vsBudgetPct).toBeNull();
	});
});

describe("the recent level", () => {
	test("is the mean of the last 12 complete months, not the whole window", () => {
		// 11 cheap months then 12 expensive ones; the 24th is in progress.
		const values = [...Array(11).fill(20_000), ...Array(12).fill(100_000), 500];
		const i = spendingInsights(trends(MONTHS_24, [cat("x", "X", values)]), {
			today: TODAY,
		});
		expect(i.recentMean).toBe(100_000);
		expect(i.recentMonths).toBe(RECENT_MONTHS);
		// the window average is dragged down by the cheap months — that is the number it replaces
		expect(i.average).toBeLessThan(i.recentMean);
	});

	test("falls back to however many complete months exist", () => {
		const months = ["2026-04", "2026-05", "2026-06", "2026-07"];
		const i = spendingInsights(
			trends(months, [cat("x", "X", [1000, 2000, 3000, 99])]),
			{ today: TODAY },
		);
		expect(i.recentMonths).toBe(3); // the in-progress month is not one of them
		expect(i.recentMean).toBe(2000);
	});

	test("agrees with the year-over-year recent side, which spans the same months", () => {
		const values = [...Array(11).fill(1000), ...Array(12).fill(2000), 50];
		const i = spendingInsights(trends(MONTHS_24, [cat("x", "X", values)]), {
			today: TODAY,
		});
		expect(i.yoy?.recent).toBe(i.recentMean);
	});
});

describe("the budget gap", () => {
	/** 12 complete months: 10 over a 50k budget, 2 under. The 13th is in progress. */
	const shape = [
		60_000, 10_000, 20_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000,
		60_000, 60_000, 60_000, 999,
	];
	const months = Array.from({ length: 13 }, (_, i) =>
		new Date(Date.UTC(2025, 6 + i, 1)).toISOString().slice(0, 7),
	);
	const i = spendingInsights(trends(months, [cat("x", "X", shape)], 50_000), {
		today: TODAY,
	});

	test("measures the recent level against the plan budget", () => {
		expect(i.gap?.gap).toBe(i.recentMean - 50_000);
		expect(i.gap?.gapPct).toBeCloseTo((i.recentMean - 50_000) / 50_000, 6);
	});

	test("counts how many months ran over — the raise-or-cut signal", () => {
		expect(i.gap?.monthsOver).toBe(10);
		expect(i.gap?.overByMonth).toHaveLength(12);
		expect(i.gap?.overByMonth[0]).toBe(true);
		expect(i.gap?.overByMonth[1]).toBe(false);
	});

	test("spending exactly the budget is not over it", () => {
		const flat = spendingInsights(
			trends(["2026-01", "2026-02"], [cat("x", "X", [50_000, 50_000])], 50_000),
			{ today: TODAY },
		);
		expect(flat.gap?.monthsOver).toBe(0);
		expect(flat.gap?.gap).toBe(0);
	});

	test("excludes the in-progress month, which would read as a sudden improvement", () => {
		// The 13th month holds ₹999 against a ₹50,000 budget. Counted, it would add a 13th `false` to the
		// tally and pull the mean down by a fifth — three weeks of data reading as a month of restraint.
		expect(i.gap?.overByMonth).toHaveLength(12);
		expect(i.recentMonths).toBe(12);
		expect(i.recentMean).toBe(mean(shape.slice(0, 12)));
	});

	test("is null when nothing is budgeted, but the recent level still resolves", () => {
		const none = spendingInsights(
			trends(["2026-01", "2026-02"], [cat("x", "X", [90_000, 110_000])]),
			{ today: TODAY },
		);
		expect(none.gap).toBeNull();
		expect(none.recentMean).toBe(100_000);
	});
});

describe("attribution", () => {
	test("sums recent spend in categories carrying no budget", () => {
		const t = trends(
			["2026-01", "2026-02"],
			[
				budgeted("rent", [5000, 5000], 5000),
				cat("card_bill", "Card bill", [70_000, 80_000]),
			],
			5000,
		);
		expect(
			spendingInsights(t, { today: TODAY }).attribution.unattributableSpend,
		).toBe(75_000);
	});

	test("sums budget for categories the statement never produced", () => {
		const t = trends(["2026-01"], [budgeted("rent", [5000], 5000)], 19_000, [
			{ key: "groceries", label: "Groceries", budget: 5000 },
			{ key: "shopping", label: "Shopping", budget: 9000 },
		]);
		expect(
			spendingInsights(t, { today: TODAY }).attribution.unmatchedBudget,
		).toBe(14_000);
	});

	test("is zero on both counts when the two vocabularies line up", () => {
		const t = trends(["2026-01"], [budgeted("rent", [5000], 5000)], 5000);
		const a = spendingInsights(t, { today: TODAY }).attribution;
		expect(a.unattributableSpend).toBe(0);
		expect(a.unmatchedBudget).toBe(0);
	});
});

describe("degenerate windows", () => {
	test("an empty window averages zero instead of NaN", () => {
		const i = spendingInsights(trends([], []), { today: TODAY });
		expect(i.average).toBe(0);
		expect(i.recentMean).toBe(0);
		expect(i.recentMonths).toBe(0);
		expect(i.rolling).toEqual([]);
		expect(i.yoy).toBeNull();
	});

	test("a budget with no complete months gives a gap against zero spend, not NaN", () => {
		const i = spendingInsights(
			trends(["2026-07"], [cat("x", "X", [1234])], 50_000),
			{ today: TODAY },
		);
		expect(i.recentMean).toBe(0);
		expect(i.gap?.gap).toBe(-50_000);
		expect(i.gap?.overByMonth).toEqual([]);
	});

	test("a window that is only the in-progress month has no complete months", () => {
		const i = spendingInsights(trends(["2026-07"], [cat("x", "X", [1234])]), {
			today: TODAY,
		});
		expect(i.average).toBe(0);
		expect(i.latestIsPartial).toBe(true);
	});
});
