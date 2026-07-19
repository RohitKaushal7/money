import { describe, expect, test } from "bun:test";
import {
	expectedInterestEvents,
	reconcile,
	type StatementCredit,
} from "./reconcile";
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
		payout: "cash",
		interestCadence: "monthly",
		...partial,
	};
}

function credit(partial: Partial<StatementCredit>): StatementCredit {
	return {
		txnId: "t1",
		date: "2026-07-15",
		narration: "credit",
		amount: 0,
		month: "2026-07",
		kind: "passive_income",
		...partial,
	};
}

describe("expectedInterestEvents", () => {
	test("monthly cash-income holding fires every month at 1× monthly", () => {
		const events = expectedInterestEvents(
			[inv({ platform: "SustVest", principal: 1_000_000, annualRate: 0.18 })],
			"2026-07",
		);
		expect(events).toHaveLength(1);
		// ₹10L @ 18% → ₹1.8L/yr → ₹15,000/mo
		expect(events[0]?.expectedAmount).toBeCloseTo(15_000, 2);
	});

	test("accrue holdings never emit a cash event (PPF, cumulative FD)", () => {
		const events = expectedInterestEvents(
			[inv({ payout: "accrue", principal: 659_951, annualRate: 0.071 })],
			"2026-07",
		);
		expect(events).toHaveLength(0);
	});

	test("growth holdings never emit (they aren't interest)", () => {
		expect(
			expectedInterestEvents(
				[inv({ incomeClass: "growth", payout: "cash", currentValue: 500_000 })],
				"2026-07",
			),
		).toHaveLength(0);
	});

	test("quarterly fires only on anchored months, at 3× monthly (the lump)", () => {
		const bond = inv({
			platform: "Wint",
			interestCadence: "quarterly",
			startDate: "2026-01-10",
			principal: 100_000,
			annualRate: 0.12,
		});
		// anchor Jan → fires Jan, Apr, Jul, Oct
		expect(expectedInterestEvents([bond], "2026-07")).toHaveLength(1);
		expect(expectedInterestEvents([bond], "2026-08")).toHaveLength(0);
		// ₹1L @ 12% → ₹12k/yr → ₹1k/mo → ₹3k quarterly lump
		expect(
			expectedInterestEvents([bond], "2026-07")[0]?.expectedAmount,
		).toBeCloseTo(3_000, 2);
	});

	test("anchored cadence without a startDate is skipped (can't place the lump)", () => {
		expect(
			expectedInterestEvents(
				[
					inv({
						interestCadence: "quarterly",
						principal: 100_000,
						annualRate: 0.12,
					}),
				],
				"2026-07",
			),
		).toHaveLength(0);
	});

	test("does not fire before startDate or after maturity", () => {
		const bond = inv({
			principal: 100_000,
			annualRate: 0.12,
			startDate: "2026-06-01",
			maturityDate: "2026-08-31",
		});
		expect(expectedInterestEvents([bond], "2026-05")).toHaveLength(0); // pre-start
		expect(expectedInterestEvents([bond], "2026-07")).toHaveLength(1); // live
		expect(expectedInterestEvents([bond], "2026-09")).toHaveLength(0); // post-maturity
	});

	test("a now-matured holding still reports coupons for months it was live", () => {
		// status matured today, but was live and paying in June
		const bond = inv({
			status: "matured",
			principal: 100_000,
			annualRate: 0.12,
			startDate: "2026-01-01",
			maturityDate: "2026-07-13",
		});
		expect(expectedInterestEvents([bond], "2026-06")).toHaveLength(1);
	});
});

describe("reconcile", () => {
	const sustvest = inv({
		id: "sv",
		name: "SustVest",
		platform: "SustVest",
		principal: 1_000_000,
		annualRate: 0.18,
	}); // → ₹15,000/mo expected

	test("a same-platform credit within ±20% is received, with delta", () => {
		const res = reconcile({
			investments: [sustvest],
			credits: [credit({ narration: "UPI/SUSTVEST TECH", amount: 13_500 })], // −10% TDS
			month: "2026-07",
			today: "2026-07-20",
		});
		const ev = res.events[0];
		expect(ev?.status).toBe("received");
		expect(ev?.delta).toBeCloseTo(-1_500, 2);
		expect(res.summary.receivedCount).toBe(1);
	});

	test("a same-platform credit outside the band is 'differs', not dropped", () => {
		const res = reconcile({
			investments: [sustvest],
			credits: [credit({ narration: "SUSTVEST", amount: 5_000 })],
			month: "2026-07",
			today: "2026-07-20",
		});
		expect(res.events[0]?.status).toBe("differs");
		expect(res.summary.differsCount).toBe(1);
	});

	test("no credit in an elapsed month is missed", () => {
		const res = reconcile({
			investments: [sustvest],
			credits: [],
			month: "2026-06",
			today: "2026-07-20",
		});
		expect(res.events[0]?.status).toBe("missed");
	});

	test("no credit yet in the current month is pending", () => {
		const res = reconcile({
			investments: [sustvest],
			credits: [],
			month: "2026-07",
			today: "2026-07-20",
		});
		expect(res.events[0]?.status).toBe("pending");
	});

	test("one credit matches at most one event", () => {
		const two = [
			inv({
				id: "a",
				name: "A",
				platform: "Wint",
				principal: 100_000,
				annualRate: 0.12,
			}),
			inv({
				id: "b",
				name: "B",
				platform: "Wint",
				principal: 100_000,
				annualRate: 0.12,
			}),
		]; // each ₹1,000/mo
		const res = reconcile({
			investments: two,
			credits: [credit({ narration: "WINT WEALTH", amount: 1_000 })],
			month: "2026-07",
			today: "2026-08-01", // July elapsed → the unclaimed event is missed, not pending
		});
		expect(res.summary.receivedCount).toBe(1);
		expect(res.summary.missedCount).toBe(1);
	});

	test("unmatched income-looking credit becomes a suggestion with a platform guess", () => {
		const res = reconcile({
			investments: [sustvest],
			credits: [
				credit({ txnId: "sv", narration: "SUSTVEST", amount: 15_000 }),
				credit({
					txnId: "new",
					narration: "ACH CR INDMONEY BONDS",
					amount: 5_000,
				}),
			],
			month: "2026-07",
			today: "2026-07-20",
		});
		expect(res.events[0]?.status).toBe("received");
		expect(res.suggestions).toHaveLength(1);
		expect(res.suggestions[0]?.txnId).toBe("new");
		expect(res.suggestions[0]?.platformGuess).toBe("Indmoney");
	});

	test("salary-sized uncategorised credits are not suggested", () => {
		const res = reconcile({
			investments: [],
			credits: [
				credit({
					txnId: "sal",
					narration: "IMPS SALARY",
					amount: 169_512,
					kind: "uncategorized",
				}),
			],
			month: "2026-07",
			today: "2026-07-20",
		});
		expect(res.suggestions).toHaveLength(0);
	});

	test("credits already classed as active_income/transfer/expense are not suggested", () => {
		const res = reconcile({
			investments: [],
			credits: [
				credit({
					txnId: "x",
					narration: "EMPLOYER",
					amount: 40_000,
					kind: "active_income",
				}),
			],
			month: "2026-07",
			today: "2026-07-20",
		});
		expect(res.suggestions).toHaveLength(0);
	});
});
