import { describe, expect, test } from "bun:test";
import {
	coverageLadder,
	expectedMonthlyInterest,
	isActiveInvestment,
	isMatured,
	monthlyAmount,
	monthlyReturn,
	netIncomeOfTax,
	toISODate,
	wealthSummary,
} from "./plan";
import type { Investment, RecurringExpense } from "./types";

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

describe("expectedMonthlyInterest", () => {
	test("explicit override wins over principal×rate", () => {
		expect(
			expectedMonthlyInterest(
				inv({
					expectedMonthlyInterest: 500,
					principal: 100_000,
					annualRate: 0.11,
				}),
			),
		).toBe(500);
	});

	test("derives principal × annualRate ÷ 12", () => {
		// ₹1,00,000 @ 11% → ₹11,000/yr → ₹916.67/mo
		expect(
			expectedMonthlyInterest(inv({ principal: 100_000, annualRate: 0.11 })),
		).toBeCloseTo(916.666, 2);
	});

	test("growth assets yield 0 interest (they contribute via drawdown)", () => {
		expect(
			expectedMonthlyInterest(
				inv({ incomeClass: "growth", currentValue: 500_000 }),
			),
		).toBe(0);
	});

	test("inactive / matured / closed yield 0", () => {
		expect(
			expectedMonthlyInterest(
				inv({ active: false, expectedMonthlyInterest: 500 }),
			),
		).toBe(0);
		expect(
			expectedMonthlyInterest(
				inv({ status: "matured", expectedMonthlyInterest: 500 }),
			),
		).toBe(0);
		expect(
			expectedMonthlyInterest(
				inv({ status: "closed", expectedMonthlyInterest: 500 }),
			),
		).toBe(0);
	});

	test("missing rate and principal → 0", () => {
		expect(expectedMonthlyInterest(inv({}))).toBe(0);
	});
});

describe("monthlyAmount", () => {
	test("monthly is unchanged", () => {
		expect(monthlyAmount(exp({ amount: 32_000, cadence: "monthly" }))).toBe(
			32_000,
		);
	});
	test("quarterly ÷ 3", () => {
		expect(monthlyAmount(exp({ amount: 3_000, cadence: "quarterly" }))).toBe(
			1_000,
		);
	});
	test("yearly ÷ 12", () => {
		expect(monthlyAmount(exp({ amount: 12_000, cadence: "yearly" }))).toBe(
			1_000,
		);
	});
	test("half_yearly ÷ 6", () => {
		expect(monthlyAmount(exp({ amount: 6_000, cadence: "half_yearly" }))).toBe(
			1_000,
		);
	});
	test("inactive → 0", () => {
		expect(monthlyAmount(exp({ amount: 32_000, active: false }))).toBe(0);
	});
	test("non-periodic cadence → 0", () => {
		expect(monthlyAmount(exp({ amount: 32_000, cadence: "maturity" }))).toBe(0);
	});
});

describe("isActiveInvestment", () => {
	test("active + no status → true", () => {
		expect(isActiveInvestment(inv({}))).toBe(true);
	});
	test("matured/closed/inactive → false", () => {
		expect(isActiveInvestment(inv({ status: "matured" }))).toBe(false);
		expect(isActiveInvestment(inv({ status: "closed" }))).toBe(false);
		expect(isActiveInvestment(inv({ active: false }))).toBe(false);
	});
});

describe("monthlyReturn", () => {
	test("explicit expectedMonthlyInterest wins", () => {
		expect(
			monthlyReturn(
				inv({
					expectedMonthlyInterest: 500,
					currentValue: 1_000_000,
					annualRate: 0.12,
				}),
			),
		).toBe(500);
	});
	test("falls back to currentValue × rate ÷ 12", () => {
		expect(
			monthlyReturn(
				inv({
					incomeClass: "growth",
					currentValue: 1_200_000,
					annualRate: 0.12,
				}),
			),
		).toBe(12_000);
	});
});

describe("isMatured", () => {
	test("past maturityDate vs today → matured", () => {
		expect(isMatured(inv({ maturityDate: "2026-07-13" }), "2026-07-19")).toBe(
			true,
		);
	});
	test("maturity today or future → not matured", () => {
		expect(isMatured(inv({ maturityDate: "2026-07-19" }), "2026-07-19")).toBe(
			false,
		);
		expect(isMatured(inv({ maturityDate: "2026-08-15" }), "2026-07-19")).toBe(
			false,
		);
	});
	test("no today → never auto-expires", () => {
		expect(isMatured(inv({ maturityDate: "2020-01-01" }))).toBe(false);
	});
	test("day-first DD/MM/YYYY maturity is parsed (not silently ignored)", () => {
		// 16 Sep 2026 is in the future vs 19 Jul 2026 → not matured, but must be *seen*
		expect(isMatured(inv({ maturityDate: "16/09/2026" }), "2026-07-19")).toBe(
			false,
		);
		// 05 Jul 2026 is past → matured
		expect(isMatured(inv({ maturityDate: "05/07/2026" }), "2026-07-19")).toBe(
			true,
		);
	});
});

describe("toISODate", () => {
	test("passes through ISO", () => {
		expect(toISODate("2026-08-15")).toBe("2026-08-15");
	});
	test("normalises day-first DD/MM/YYYY and DD-MM-YYYY", () => {
		expect(toISODate("16/09/2026")).toBe("2026-09-16");
		expect(toISODate("7/6/2027")).toBe("2027-06-07");
		expect(toISODate("25-02-2027")).toBe("2027-02-25");
	});
	test("null on absent/garbage", () => {
		expect(toISODate(undefined)).toBeNull();
		expect(toISODate("not a date")).toBeNull();
	});
});

describe("coverageLadder", () => {
	const investments = [
		inv({
			id: "s",
			incomeClass: "income",
			payout: "cash",
			expectedMonthlyInterest: 6_454,
		}), // cash
		inv({
			id: "w",
			incomeClass: "income",
			payout: "cash",
			expectedMonthlyInterest: 600,
			maturityDate: "2026-07-13",
		}), // expired
		inv({
			id: "p",
			incomeClass: "income",
			payout: "accrue",
			expectedMonthlyInterest: 3_905,
		}), // fixed, not cash
		inv({
			id: "g",
			incomeClass: "growth",
			currentValue: 1_000_000,
			annualRate: 0.12,
		}), // growth 10,000/mo
	];
	const recurring = [exp({ amount: 50_226 })];

	test("cash ⊆ fixed ⊆ total, and expired holding excluded", () => {
		const l = coverageLadder({ investments, recurring, today: "2026-07-19" });
		expect(Math.round(l.cash.income)).toBe(6_454); // w excluded (expired)
		expect(Math.round(l.fixed.income)).toBe(10_359); // 6454 + 3905
		expect(Math.round(l.total.income)).toBe(20_359); // + 10,000 growth
		expect(l.total.ratio).toBeCloseTo(20_359 / 50_226, 4);
	});
});

describe("wealthSummary", () => {
	const investments = [
		inv({
			id: "a",
			group: "SustVest",
			currentValue: 100_000,
			annualRate: 0.11,
			expectedMonthlyInterest: 916.67,
		}),
		inv({
			id: "b",
			group: "SustVest",
			currentValue: 60_000,
			annualRate: 0.106,
			expectedMonthlyInterest: 530,
		}),
		inv({
			id: "c",
			incomeClass: "growth",
			currentValue: 1_000_000,
			annualRate: 0.12,
		}),
		inv({
			id: "x",
			currentValue: 90_000,
			annualRate: 0.08,
			expectedMonthlyInterest: 600,
			maturityDate: "2026-07-13",
		}), // expired
	];
	const recurring = [exp({ amount: 50_000 })];

	test("groups roll up with value-weighted rate; matured excluded from live wealth", () => {
		const w = wealthSummary({ investments, recurring, today: "2026-07-19" });
		expect(w.totalValue).toBe(1_160_000); // 160k SustVest + 1M growth, x excluded
		expect(w.maturedValue).toBe(90_000);
		const sv = w.rollups.find((r) => r.group === "SustVest");
		expect(sv?.value).toBe(160_000);
		expect(sv?.members.length).toBe(2);
		// weighted rate = (916.67+530)*12 / 160000
		expect(sv?.rate).toBeCloseTo(((916.67 + 530) * 12) / 160_000, 4);
	});

	test("required ROI = annual expenses / wealth; years-left = wealth / annual expenses", () => {
		const w = wealthSummary({ investments, recurring, today: "2026-07-19" });
		expect(w.requiredRoi).toBeCloseTo((50_000 * 12) / 1_160_000, 4);
		expect(w.yearsLeft).toBeCloseTo(1_160_000 / (50_000 * 12), 4);
	});
});

describe("netIncomeOfTax", () => {
	test("scales an income holding's rate by (1 − marginal); value untouched", () => {
		const n = netIncomeOfTax(
			inv({ incomeClass: "income", currentValue: 1_000_000, annualRate: 0.07 }),
			0.312,
		);
		expect(n.annualRate).toBeCloseTo(0.07 * 0.688, 6);
		expect(n.currentValue).toBe(1_000_000);
	});

	test("leaves growth holdings alone", () => {
		const g = inv({
			incomeClass: "growth",
			currentValue: 1_000_000,
			annualRate: 0.12,
		});
		expect(netIncomeOfTax(g, 0.312)).toEqual(g);
	});

	test("scales an explicit expectedMonthlyInterest too", () => {
		const n = netIncomeOfTax(
			inv({ incomeClass: "income", expectedMonthlyInterest: 6000 }),
			0.5,
		);
		expect(n.expectedMonthlyInterest).toBe(3000);
	});

	test("a zero/negative rate is a no-op", () => {
		const i = inv({ incomeClass: "income", annualRate: 0.07 });
		expect(netIncomeOfTax(i, 0)).toEqual(i);
	});
});
