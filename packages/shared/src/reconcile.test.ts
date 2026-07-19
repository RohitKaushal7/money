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
				[inv({ type: "fd", payout: "accrue", principal: 659_951, annualRate: 0.071 })],
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
	// SustVest group: 12 tranches summing ₹6,454/mo, paid as many p2p_payout credits
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

	test("summed credits outside the band → 'differs', not dropped", () => {
		const res = reconcile({
			investments: sustvest,
			credits: p2pCredits("2026-07", 300), // 12 × 300 = 3600 vs 6454 → −44%
			month: "2026-07",
			today: "2026-07-20",
		});
		expect(res.events[0]?.status).toBe("differs");
		expect(res.summary.differsCount).toBe(1);
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
				credit({ txnId: "q", amount: 40_000, kind: "active_income", categoryKey: "salary" }),
				credit({ txnId: "s", amount: 20_000, kind: "transfer", categoryKey: "sweep_in" }),
			],
			month: "2026-07",
			today: "2026-07-20",
		});
		expect(res.suggestions).toHaveLength(0);
	});
});
