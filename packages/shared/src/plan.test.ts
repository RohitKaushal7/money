import { describe, expect, test } from "bun:test";
import {
	coverage,
	expectedMonthlyInterest,
	imputedMonthlyDrawdown,
	isActiveInvestment,
	monthlyAmount,
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
	return { id: "e1", name: "test", amount: 0, cadence: "monthly", active: true, ...partial };
}

describe("expectedMonthlyInterest", () => {
	test("explicit override wins over principal×rate", () => {
		expect(
			expectedMonthlyInterest(
				inv({ expectedMonthlyInterest: 500, principal: 100_000, annualRate: 0.11 }),
			),
		).toBe(500);
	});

	test("derives principal × annualRate ÷ 12", () => {
		// ₹1,00,000 @ 11% → ₹11,000/yr → ₹916.67/mo
		expect(expectedMonthlyInterest(inv({ principal: 100_000, annualRate: 0.11 }))).toBeCloseTo(
			916.666,
			2,
		);
	});

	test("growth assets yield 0 interest (they contribute via drawdown)", () => {
		expect(
			expectedMonthlyInterest(inv({ incomeClass: "growth", currentValue: 500_000 })),
		).toBe(0);
	});

	test("inactive / matured / closed yield 0", () => {
		expect(expectedMonthlyInterest(inv({ active: false, expectedMonthlyInterest: 500 }))).toBe(0);
		expect(expectedMonthlyInterest(inv({ status: "matured", expectedMonthlyInterest: 500 }))).toBe(
			0,
		);
		expect(expectedMonthlyInterest(inv({ status: "closed", expectedMonthlyInterest: 500 }))).toBe(0);
	});

	test("missing rate and principal → 0", () => {
		expect(expectedMonthlyInterest(inv({}))).toBe(0);
	});
});

describe("monthlyAmount", () => {
	test("monthly is unchanged", () => {
		expect(monthlyAmount(exp({ amount: 32_000, cadence: "monthly" }))).toBe(32_000);
	});
	test("quarterly ÷ 3", () => {
		expect(monthlyAmount(exp({ amount: 3_000, cadence: "quarterly" }))).toBe(1_000);
	});
	test("yearly ÷ 12", () => {
		expect(monthlyAmount(exp({ amount: 12_000, cadence: "yearly" }))).toBe(1_000);
	});
	test("half_yearly ÷ 6", () => {
		expect(monthlyAmount(exp({ amount: 6_000, cadence: "half_yearly" }))).toBe(1_000);
	});
	test("inactive → 0", () => {
		expect(monthlyAmount(exp({ amount: 32_000, active: false }))).toBe(0);
	});
	test("non-periodic cadence → 0", () => {
		expect(monthlyAmount(exp({ amount: 32_000, cadence: "maturity" }))).toBe(0);
	});
});

describe("imputedMonthlyDrawdown", () => {
	const growth = inv({ incomeClass: "growth", currentValue: 1_200_000 });
	const income = inv({ id: "i2", incomeClass: "income", currentValue: 999_999 });

	test("disabled → 0", () => {
		expect(imputedMonthlyDrawdown([growth], { enabled: false, rate: 0.04 })).toBe(0);
	});
	test("enabled: Σ growth value × rate ÷ 12; ignores income-class value", () => {
		// 12,00,000 @ 4% → 48,000/yr → 4,000/mo
		expect(imputedMonthlyDrawdown([growth, income], { enabled: true, rate: 0.04 })).toBe(4_000);
	});
	test("ignores inactive growth", () => {
		expect(
			imputedMonthlyDrawdown([inv({ incomeClass: "growth", currentValue: 1_200_000, active: false })], {
				enabled: true,
				rate: 0.04,
			}),
		).toBe(0);
	});
});

describe("coverage", () => {
	test("full scenario: interest + drawdown over recurring", () => {
		const investments: Investment[] = [
			inv({ id: "b1", principal: 100_000, annualRate: 0.12 }), // 1,000/mo
			inv({ id: "p1", expectedMonthlyInterest: 2_500 }), // 2,500/mo
			inv({ id: "g1", incomeClass: "growth", currentValue: 3_000_000 }), // drawdown
		];
		const recurring: RecurringExpense[] = [
			exp({ id: "rent", amount: 32_000, cadence: "monthly" }),
			exp({ id: "sub", amount: 12_000, cadence: "yearly" }), // 1,000/mo
		];
		const b = coverage({ investments, recurring, drawdown: { enabled: true, rate: 0.04 } });
		expect(b.interest).toBeCloseTo(3_500, 6);
		expect(b.drawdown).toBeCloseTo(10_000, 6); // 30,00,000 × 4% / 12
		expect(b.passiveIncome).toBeCloseTo(13_500, 6);
		expect(b.expenses).toBeCloseTo(33_000, 6);
		expect(b.ratio).toBeCloseTo(13_500 / 33_000, 6);
	});

	test("drawdown off → numerator is pure interest", () => {
		const b = coverage({
			investments: [inv({ incomeClass: "growth", currentValue: 3_000_000 }), inv({ id: "x", expectedMonthlyInterest: 1_000 })],
			recurring: [exp({ amount: 2_000 })],
			drawdown: { enabled: false, rate: 0.04 },
		});
		expect(b.passiveIncome).toBe(1_000);
		expect(b.ratio).toBe(0.5);
	});

	test("no expenses → ratio null (avoid divide-by-zero)", () => {
		const b = coverage({
			investments: [inv({ expectedMonthlyInterest: 1_000 })],
			recurring: [],
			drawdown: { enabled: false, rate: 0.04 },
		});
		expect(b.ratio).toBeNull();
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
