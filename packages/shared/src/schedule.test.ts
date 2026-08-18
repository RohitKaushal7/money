import { describe, expect, test } from "bun:test";
import { daysUntil, estimatedPaid, nextPayment } from "./schedule";
import type { RecurringExpense } from "./types";

function exp(partial: Partial<RecurringExpense>): RecurringExpense {
	return {
		id: "e1",
		name: "test",
		amount: 0,
		cadence: "monthly",
		active: true,
		...partial,
	};
}

describe("nextPayment", () => {
	test("is null without a start date — the schedule is unknown, not overdue", () => {
		expect(nextPayment(exp({}), "2026-08-18")).toBeNull();
	});

	test("a start date in the future is itself the next payment", () => {
		expect(nextPayment(exp({ startDate: "2026-12-01" }), "2026-08-18")).toBe(
			"2026-12-01",
		);
	});

	test("today is a payment day, not a missed one", () => {
		expect(nextPayment(exp({ startDate: "2026-01-18" }), "2026-08-18")).toBe(
			"2026-08-18",
		);
	});

	test("monthly steps to the next occurrence", () => {
		expect(nextPayment(exp({ startDate: "2026-01-05" }), "2026-08-18")).toBe(
			"2026-09-05",
		);
	});

	test("yearly holds the anniversary", () => {
		expect(
			nextPayment(
				exp({ startDate: "2022-11-15", cadence: "yearly" }),
				"2026-08-18",
			),
		).toBe("2026-11-15");
	});

	test("quarterly and half-yearly step by 3 and 6 months", () => {
		expect(
			nextPayment(
				exp({ startDate: "2026-01-10", cadence: "quarterly" }),
				"2026-08-18",
			),
		).toBe("2026-10-10");
		expect(
			nextPayment(
				exp({ startDate: "2026-01-10", cadence: "half_yearly" }),
				"2026-08-18",
			),
		).toBe("2027-01-10");
	});

	// The whole reason this is anchor arithmetic and not repeated addition: adding a month to 31 Jan gives
	// 3 March in naive Date maths, and every later payment inherits that drift. The 31st must come back.
	test("a month-end anchor clamps into short months without losing the 31st", () => {
		const jan31 = exp({ startDate: "2026-01-31" });
		expect(nextPayment(jan31, "2026-02-01")).toBe("2026-02-28");
		expect(nextPayment(jan31, "2026-03-01")).toBe("2026-03-31");
		expect(nextPayment(jan31, "2026-04-01")).toBe("2026-04-30");
	});

	test("a 29 Feb anchor survives to the next leap year", () => {
		expect(
			nextPayment(
				exp({ startDate: "2024-02-29", cadence: "yearly" }),
				"2028-01-01",
			),
		).toBe("2028-02-29");
		expect(
			nextPayment(
				exp({ startDate: "2024-02-29", cadence: "yearly" }),
				"2026-01-01",
			),
		).toBe("2026-02-28");
	});

	test("nothing is due past the end date", () => {
		expect(
			nextPayment(
				exp({ startDate: "2026-01-05", endDate: "2026-06-30" }),
				"2026-08-18",
			),
		).toBeNull();
	});

	test("the end date does not cancel a payment that falls on or before it", () => {
		expect(
			nextPayment(
				exp({ startDate: "2026-01-05", endDate: "2026-09-30" }),
				"2026-08-18",
			),
		).toBe("2026-09-05");
	});

	test("an inactive expense has no next payment", () => {
		expect(
			nextPayment(
				exp({ startDate: "2026-01-05", active: false }),
				"2026-08-18",
			),
		).toBeNull();
	});

	test("a non-periodic cadence has no schedule", () => {
		expect(
			nextPayment(
				exp({ startDate: "2026-01-05", cadence: "maturity" }),
				"2026-08-18",
			),
		).toBeNull();
	});
});

describe("daysUntil", () => {
	test("counts whole days forward", () => {
		expect(daysUntil("2026-08-25", "2026-08-18")).toBe(7);
	});

	test("is zero on the day itself", () => {
		expect(daysUntil("2026-08-18", "2026-08-18")).toBe(0);
	});

	test("goes negative once past", () => {
		expect(daysUntil("2026-08-11", "2026-08-18")).toBe(-7);
	});

	test("counts across a month boundary", () => {
		expect(daysUntil("2026-09-01", "2026-08-30")).toBe(2);
	});
});

describe("estimatedPaid", () => {
	test("counts the first payment and every anniversary since", () => {
		// 15 Nov 2022 → payments in 2022, 2023, 2024, 2025 = 4 × ₹1,500
		expect(
			estimatedPaid(
				exp({ amount: 1500, cadence: "yearly", startDate: "2022-11-15" }),
				"2026-08-18",
			),
		).toBe(6000);
	});

	test("includes a payment falling exactly today", () => {
		expect(
			estimatedPaid(
				exp({ amount: 1500, cadence: "yearly", startDate: "2022-08-18" }),
				"2026-08-18",
			),
		).toBe(7500);
	});

	test("is one payment on the start date itself", () => {
		expect(
			estimatedPaid(
				exp({ amount: 500, cadence: "monthly", startDate: "2026-08-18" }),
				"2026-08-18",
			),
		).toBe(500);
	});

	test("is zero before the first payment", () => {
		expect(
			estimatedPaid(
				exp({ amount: 500, cadence: "monthly", startDate: "2026-12-01" }),
				"2026-08-18",
			),
		).toBe(0);
	});

	test("stops accruing at the end date", () => {
		// Jan–Jun inclusive = 6 payments, then it ends; today being August changes nothing.
		expect(
			estimatedPaid(
				exp({
					amount: 100,
					cadence: "monthly",
					startDate: "2026-01-10",
					endDate: "2026-06-30",
				}),
				"2026-08-18",
			),
		).toBe(600);
	});

	test("is zero without a start date — there is nothing to count from", () => {
		expect(estimatedPaid(exp({ amount: 500 }), "2026-08-18")).toBe(0);
	});
});
