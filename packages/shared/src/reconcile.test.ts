import { describe, expect, test } from "bun:test";
import {
	expectedInterestEvents,
	reconcile,
	reconcileByFy,
	type StatementCredit,
} from "./reconcile";
import type { Investment } from "./types";

function inv(partial: Partial<Investment>): Investment {
	return {
		id: "i1",
		name: "test",
		type: "p2p",
		incomeClass: "income",
		valuationSource: "manual",
		isPassiveIncomeSource: true,
		active: true,
		payout: "cash",
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
		categoryKey: "p2p_payout",
		...partial,
	};
}

describe("expectedInterestEvents", () => {
	test("unset cadence defaults to monthly, fires every month at 1× monthly", () => {
		const events = expectedInterestEvents(
			[inv({ platform: "SustVest", expectedMonthlyInterest: 6454 })],
			"2026-07",
		);
		expect(events).toHaveLength(1);
		expect(events[0]?.expectedAmount).toBeCloseTo(6454, 2);
		expect(events[0]?.expectedCategory).toBe("p2p_payout");
	});

	test("grouped holdings roll into ONE event summing members", () => {
		const tranches = Array.from({ length: 12 }, (_, i) =>
			inv({ id: `sv${i}`, group: "SustVest", expectedMonthlyInterest: 500 }),
		);
		const events = expectedInterestEvents(tranches, "2026-07");
		expect(events).toHaveLength(1);
		expect(events[0]?.name).toBe("SustVest");
		expect(events[0]?.memberCount).toBe(12);
		expect(events[0]?.expectedAmount).toBeCloseTo(6000, 2);
	});

	test("asset type maps to the statement category (bond → bond_coupon)", () => {
		const events = expectedInterestEvents(
			[inv({ type: "bond", group: "Wint", expectedMonthlyInterest: 1000 })],
			"2026-07",
		);
		expect(events[0]?.expectedCategory).toBe("bond_coupon");
	});

	test("accrue holdings never emit a cash event (PPF, cumulative FD)", () => {
		expect(
			expectedInterestEvents(
				[
					inv({
						type: "fd",
						payout: "accrue",
						principal: 659_951,
						annualRate: 0.071,
					}),
				],
				"2026-07",
			),
		).toHaveLength(0);
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
			type: "bond",
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
	// A P2P group: 12 tranches summing ₹6,454/mo, paid as many p2p_payout credits
	const sustvest = Array.from({ length: 12 }, (_, i) =>
		inv({
			id: `sv${i}`,
			name: `SustVest T${i}`,
			group: "SustVest",
			platform: "SustVest",
			expectedMonthlyInterest: 6454 / 12,
		}),
	);
	const p2pCredits = (month: string, per: number) =>
		Array.from({ length: 12 }, (_, i) =>
			credit({
				txnId: `${month}-sv${i}`,
				month,
				date: `${month}-15`,
				amount: per,
				categoryKey: "p2p_payout",
			}),
		);

	test("a group's summed credits within ±20% of expected → received", () => {
		const res = reconcile({
			investments: sustvest,
			credits: p2pCredits("2026-07", 6454 / 12), // 12 credits summing 6454
			month: "2026-07",
			today: "2026-07-20",
		});
		expect(res.events).toHaveLength(1);
		expect(res.events[0]?.status).toBe("received");
		expect(res.events[0]?.actualAmount).toBeCloseTo(6454, 0);
		expect(res.events[0]?.matches).toHaveLength(12);
		expect(res.summary.receivedCount).toBe(1);
	});

	test("summed credits short of the band in an elapsed month → 'differs', not dropped", () => {
		const res = reconcile({
			investments: sustvest,
			credits: p2pCredits("2026-07", 300), // 12 × 300 = 3600 vs 6454 → −44%
			month: "2026-07",
			today: "2026-08-02",
		});
		expect(res.events[0]?.status).toBe("differs");
		expect(res.summary.differsCount).toBe(1);
	});

	/**
	 * The false alarm this status exists to kill. Bond coupons cluster late in the month — over six real
	 * months, 56% of them landed on day 22 or later — so on the 21st a group is routinely short of its
	 * month-end expectation. Reporting that as "amount differs" raises a warning every single month for
	 * money that simply isn't due yet.
	 */
	test("short mid-month is 'partial' — not due yet is not a discrepancy", () => {
		const res = reconcile({
			investments: sustvest,
			credits: p2pCredits("2026-07", 300),
			month: "2026-07",
			today: "2026-07-21",
		});
		expect(res.events[0]?.status).toBe("partial");
		expect(res.summary.partialCount).toBe(1);
		expect(res.summary.differsCount).toBe(0);
		expect(res.summary.inProgress).toBe(true);
	});

	/**
	 * Above expectation is never provisional: more money than planned has already arrived, and no amount of
	 * remaining month makes that go away. This is the real P2P case — 12 of 12 credits landed on the
	 * 15th at 35% above plan, which means the plan entry is stale, not that a payout is late.
	 */
	test("above expectation mid-month stays 'differs' — waiting won't unmake it", () => {
		const res = reconcile({
			investments: sustvest,
			credits: p2pCredits("2026-07", 735), // 12 × 735 = 8820 vs 6454 → +37%
			month: "2026-07",
			today: "2026-07-21",
		});
		expect(res.events[0]?.status).toBe("differs");
		expect(res.summary.partialCount).toBe(0);
	});

	test("an elapsed month is never in progress", () => {
		const res = reconcile({
			investments: sustvest,
			credits: p2pCredits("2026-07", 6454 / 12),
			month: "2026-07",
			today: "2026-08-01",
		});
		expect(res.summary.inProgress).toBe(false);
	});

	test("distinct asset classes match distinct categories independently", () => {
		const wint = inv({
			id: "w",
			name: "Wint",
			group: "Wint",
			type: "bond",
			expectedMonthlyInterest: 2000,
		});
		const res = reconcile({
			investments: [...sustvest, wint],
			credits: [
				...p2pCredits("2026-07", 6454 / 12),
				credit({ txnId: "k", categoryKey: "bond_coupon", amount: 2000 }),
			],
			month: "2026-07",
			today: "2026-07-20",
		});
		expect(res.summary.receivedCount).toBe(2); // SustVest (p2p) + Wint (bond)
	});

	test("no credit in an elapsed month is missed", () => {
		const res = reconcile({
			investments: sustvest,
			credits: [],
			month: "2026-06",
			today: "2026-07-20",
		});
		expect(res.events[0]?.status).toBe("missed");
	});

	test("no credit yet in the current month is pending", () => {
		const res = reconcile({
			investments: sustvest,
			credits: [],
			month: "2026-07",
			today: "2026-07-20",
		});
		expect(res.events[0]?.status).toBe("pending");
	});

	test("unmatched income-looking credit becomes a suggestion with a platform guess", () => {
		const res = reconcile({
			investments: sustvest,
			credits: [
				...p2pCredits("2026-07", 6454 / 12),
				// a different P2P not in the plan, left uncategorised by the rules
				credit({
					txnId: "new",
					narration: "DEP TFR NEFT*BANK0000123*BANK1234*EXAMPLE FIN",
					amount: 5_000,
					kind: "transfer",
					categoryKey: "uncategorized",
				}),
			],
			month: "2026-07",
			today: "2026-07-20",
		});
		expect(res.events[0]?.status).toBe("received");
		expect(res.suggestions).toHaveLength(1);
		expect(res.suggestions[0]?.txnId).toBe("new");
		expect(res.suggestions[0]?.platformGuess).toBe("Example");
	});

	test("salary-sized uncategorised credits are not suggested", () => {
		const res = reconcile({
			investments: [],
			credits: [
				credit({
					txnId: "sal",
					narration: "IMPS SALARY",
					amount: 169_512,
					kind: "transfer",
					categoryKey: "uncategorized",
				}),
			],
			month: "2026-07",
			today: "2026-07-20",
		});
		expect(res.suggestions).toHaveLength(0);
	});

	test("classified non-income credits (salary/sweep) are not suggested", () => {
		const res = reconcile({
			investments: [],
			credits: [
				credit({
					txnId: "q",
					amount: 40_000,
					kind: "active_income",
					categoryKey: "salary",
				}),
				credit({
					txnId: "s",
					amount: 20_000,
					kind: "transfer",
					categoryKey: "sweep_in",
				}),
			],
			month: "2026-07",
			today: "2026-07-20",
		});
		expect(res.suggestions).toHaveLength(0);
	});
});

describe("reconcileByFy", () => {
	const s = (
		month: string,
		expectedAmount: number,
		actualAmount: number,
		inProgress = false,
	) => ({
		month,
		inProgress,
		expectedCount: 1,
		receivedCount: 1,
		partialCount: 0,
		differsCount: 0,
		pendingCount: 0,
		missedCount: 0,
		expectedAmount,
		actualAmount,
	});

	/** Apr 2025 – Mar 2026 is FY2025-26; Apr 2026 onward is FY2026-27. */
	const closed = [
		"2025-04",
		"2025-05",
		"2025-06",
		"2025-07",
		"2025-08",
		"2025-09",
		"2025-10",
		"2025-11",
		"2025-12",
		"2026-01",
		"2026-02",
		"2026-03",
	].map((m) => s(m, 1000, 800));
	const current = [s("2026-04", 1000, 1100), s("2026-05", 1000, 900)];

	test("splits on the Indian April boundary, newest first", () => {
		const fys = reconcileByFy([...closed, ...current]);
		expect(fys.map((f) => f.label)).toEqual(["FY2026-27", "FY2025-26"]);
		expect(fys[1]?.months).toHaveLength(12);
		expect(fys[1]?.months[0]).toBe("2025-04");
	});

	test("sums each year and reports the landed ratio", () => {
		const fys = reconcileByFy([...closed, ...current]);
		expect(fys[0]?.expectedAmount).toBe(2000);
		expect(fys[0]?.actualAmount).toBe(2000);
		expect(fys[0]?.ratio).toBe(1);
		expect(fys[1]?.expectedAmount).toBe(12_000);
		expect(fys[1]?.ratio).toBeCloseTo(0.8, 6);
	});

	/**
	 * The same trap as judging a part-finished month against a full month's budget: a month still running
	 * contributes some of its credits against all of its expectation, dragging the whole year down.
	 */
	test("a month still in progress is excluded, not counted short", () => {
		const fys = reconcileByFy([...current, s("2026-06", 1000, 120, true)]);
		expect(fys[0]?.months).toEqual(["2026-04", "2026-05"]);
		expect(fys[0]?.expectedAmount).toBe(2000);
	});

	test("only the newest year is in progress, and only while it is short of 12 months", () => {
		const fys = reconcileByFy([...closed, ...current]);
		expect(fys[0]?.inProgress).toBe(true);
		expect(fys[1]?.inProgress).toBe(false);
	});

	test("a complete newest year is not marked in progress", () => {
		const fys = reconcileByFy(closed);
		expect(fys[0]?.label).toBe("FY2025-26");
		expect(fys[0]?.inProgress).toBe(false);
	});

	test("a year with no complete months is omitted rather than shown as zero", () => {
		const fys = reconcileByFy([...closed, s("2026-04", 1000, 50, true)]);
		expect(fys.map((f) => f.label)).toEqual(["FY2025-26"]);
	});

	test("limit keeps the most recent years", () => {
		const older = ["2024-04", "2024-05"].map((m) => s(m, 500, 500));
		const fys = reconcileByFy([...older, ...closed, ...current], { limit: 2 });
		expect(fys.map((f) => f.label)).toEqual(["FY2026-27", "FY2025-26"]);
	});

	test("nothing expected yields a null ratio rather than a divide by zero", () => {
		const fys = reconcileByFy([s("2026-04", 0, 0)]);
		expect(fys[0]?.ratio).toBeNull();
	});

	test("an empty input is an empty rollup, not a crash", () => {
		expect(reconcileByFy([])).toEqual([]);
	});
});
