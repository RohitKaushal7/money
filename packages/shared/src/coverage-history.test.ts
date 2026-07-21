import { describe, expect, test } from "bun:test";
import { asOfFor, monthEnd, monthOf } from "./coverage-history";
import { coverageLadder } from "./plan";
import type { Investment } from "./types";

function inv(partial: Partial<Investment>): Investment {
	return {
		id: "i1",
		name: "test",
		type: "bond",
		incomeClass: "income",
		valuationSource: "manual",
		isPassiveIncomeSource: true,
		active: true,
		...partial,
	};
}

describe("monthEnd", () => {
	test("31-, 30- and 28-day months", () => {
		expect(monthEnd("2026-01")).toBe("2026-01-31");
		expect(monthEnd("2026-04")).toBe("2026-04-30");
		expect(monthEnd("2025-02")).toBe("2025-02-28");
	});

	test("leap February", () => {
		expect(monthEnd("2024-02")).toBe("2024-02-29");
	});

	test("December does not roll into the next year", () => {
		expect(monthEnd("2026-12")).toBe("2026-12-31");
	});

	test("malformed input is rejected rather than guessed", () => {
		expect(monthEnd("2026-13")).toBeNull();
		expect(monthEnd("2026-00")).toBeNull();
		expect(monthEnd("nonsense")).toBeNull();
	});
});

describe("asOfFor", () => {
	test("a past month is evaluated at its own month-end", () => {
		expect(asOfFor("2026-03", "2026-07-21")).toBe("2026-03-31");
	});

	test("the current month is evaluated at today, not a future month-end", () => {
		expect(asOfFor("2026-07", "2026-07-21")).toBe("2026-07-21");
	});

	test("today on the last day of the month is still today", () => {
		expect(asOfFor("2026-07", "2026-07-31")).toBe("2026-07-31");
	});

	test("malformed month falls back to today rather than throwing", () => {
		expect(asOfFor("garbage", "2026-07-21")).toBe("2026-07-21");
	});
});

describe("monthOf", () => {
	test("formats as YYYY-MM", () => {
		expect(monthOf(new Date("2026-07-21T10:00:00Z"))).toBe("2026-07");
	});
});

/**
 * The reason `asOfFor` exists. `coverageLadder` drops matured holdings, so replaying history with today's
 * date would retroactively erase everything that has since matured — making the past look poorer than it
 * was and inventing an upward trend out of nothing. This is the regression that guards the KPI's honesty.
 */
describe("replaying a month that contained a since-matured holding", () => {
	const holding = inv({
		principal: 100_000,
		annualRate: 0.12,
		payout: "cash",
		maturityDate: "2026-05-31",
	});
	const today = "2026-07-21";

	test("the holding still counts in a month when it was live", () => {
		const ladder = coverageLadder({
			investments: [holding],
			recurring: [],
			today: asOfFor("2026-03", today),
		});
		expect(ladder.total.income).toBeGreaterThan(0);
	});

	test("and correctly stops counting after it matured", () => {
		const ladder = coverageLadder({
			investments: [holding],
			recurring: [],
			today: asOfFor("2026-06", today),
		});
		expect(ladder.total.income).toBe(0);
	});

	test("naively replaying with today would have erased the live month", () => {
		const naive = coverageLadder({
			investments: [holding],
			recurring: [],
			today,
		});
		expect(naive.total.income).toBe(0); // the bug asOfFor prevents
	});
});
