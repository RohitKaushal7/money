import { describe, expect, test } from "bun:test";
import { type MoneyFlowRow, moneyFlow, OTHER_PASSIVE_KEY } from "./money-flow";

/** Terse row builder — one category's amount in one month. */
const row = (
	month: string,
	categoryKey: string,
	kind: string,
	amount: number,
): MoneyFlowRow => ({ month, categoryKey, kind, amount, n: 1 });

const MONTHS = ["2026-01", "2026-02"];

describe("empty / no window", () => {
	test("no months → no data", () => {
		const f = moneyFlow({
			rows: [row("2026-01", "salary", "active_income", 100)],
			months: [],
		});
		expect(f.hasData).toBe(false);
		expect(f.incomeTotal).toBe(0);
	});

	test("rows outside the window are ignored", () => {
		const f = moneyFlow({
			rows: [row("2025-01", "salary", "active_income", 999999)],
			months: MONTHS,
		});
		expect(f.hasData).toBe(false);
	});
});

describe("monthly averaging", () => {
	test("a lump in one month is divided across the whole window", () => {
		// 120000 salary once across a 2-month window → 60000/mo
		const f = moneyFlow({
			rows: [row("2026-01", "salary", "active_income", 120000)],
			months: MONTHS,
		});
		expect(f.monthsCount).toBe(2);
		expect(f.incomeActiveTotal).toBe(60000);
		expect(f.incomeActive[0]?.value).toBe(60000);
	});
});

describe("the flow balances", () => {
	// income + reserves === expenses + net-investments + savings, always.
	const balances = (f: ReturnType<typeof moneyFlow>) =>
		Math.abs(
			f.incomeTotal + f.reserves - (f.expenseTotal + f.investTotal + f.savings),
		) < 1e-6;

	test("surplus month → savings sink, no reserves", () => {
		const f = moneyFlow({
			rows: [
				row("2026-01", "salary", "active_income", 100000),
				row("2026-01", "rent", "expense", -20000),
				row("2026-01", "sip", "investment", -30000),
			],
			months: ["2026-01"],
		});
		expect(f.savings).toBe(50000);
		expect(f.reserves).toBe(0);
		expect(balances(f)).toBe(true);
	});

	test("over-allocated month → reserves drawdown, no savings", () => {
		const f = moneyFlow({
			rows: [
				row("2026-01", "salary", "active_income", 100000),
				row("2026-01", "rent", "expense", -40000),
				row("2026-01", "bond_investment", "investment", -90000),
			],
			months: ["2026-01"],
		});
		expect(f.savings).toBe(0);
		expect(f.reserves).toBe(30000); // 40k + 90k − 100k
		expect(balances(f)).toBe(true);
	});
});

describe("redemption netting", () => {
	test("matured principal nets out of the largest investment", () => {
		const f = moneyFlow({
			rows: [
				row("2026-01", "salary", "active_income", 200000),
				row("2026-01", "bond_investment", "investment", -90000),
				row("2026-01", "sip", "investment", -30000),
				row("2026-01", "investment_redemption", "transfer", 25000), // credit back
			],
			months: ["2026-01"],
		});
		expect(f.redemptionNetted).toBe(25000);
		const bonds = f.investments.find((l) => l.key === "bond_investment");
		const sip = f.investments.find((l) => l.key === "sip");
		expect(bonds?.value).toBe(65000); // 90k − 25k
		expect(sip?.value).toBe(30000); // untouched (smaller)
		expect(f.investTotal).toBe(95000); // 120k gross − 25k
	});

	test("redemption exceeding the biggest investment spills to the next", () => {
		const f = moneyFlow({
			rows: [
				row("2026-01", "salary", "active_income", 200000),
				row("2026-01", "bond_investment", "investment", -40000),
				row("2026-01", "sip", "investment", -30000),
				row("2026-01", "investment_redemption", "transfer", 50000),
			],
			months: ["2026-01"],
		});
		// 40k bond fully consumed, 10k spills into sip → sip 20k
		expect(
			f.investments.find((l) => l.key === "bond_investment"),
		).toBeUndefined();
		expect(f.investments.find((l) => l.key === "sip")?.value).toBe(20000);
		expect(f.redemptionNetted).toBe(50000);
		expect(f.investTotal).toBe(20000);
	});
});

describe("passive collapse + coverage", () => {
	test("sub-₹1k passive sources fold into 'Other passive'", () => {
		const f = moneyFlow({
			rows: [
				row("2026-01", "salary", "active_income", 100000),
				row("2026-01", "p2p_payout", "passive_income", 8000),
				row("2026-01", "dividend", "passive_income", 600),
				row("2026-01", "savings_interest", "passive_income", 100),
				row("2026-01", "rent", "expense", -20000),
			],
			months: ["2026-01"],
		});
		const other = f.incomePassive.find((l) => l.key === OTHER_PASSIVE_KEY);
		expect(other?.value).toBe(700); // 600 + 100
		expect(f.incomePassive.find((l) => l.key === "p2p_payout")?.value).toBe(
			8000,
		);
		expect(f.incomePassiveTotal).toBe(8700);
	});

	test("passive coverage = passive ÷ expenses × 100", () => {
		const f = moneyFlow({
			rows: [
				row("2026-01", "salary", "active_income", 100000),
				row("2026-01", "p2p_payout", "passive_income", 10000),
				row("2026-01", "rent", "expense", -40000),
			],
			months: ["2026-01"],
		});
		expect(f.passiveCoveragePct).toBeCloseTo(25, 6); // 10k / 40k
	});
});

describe("noise + sign handling", () => {
	test("a net-negative income category is dropped, not rendered negative", () => {
		const f = moneyFlow({
			rows: [
				row("2026-01", "salary", "active_income", 100000),
				row("2026-01", "p2p_payout", "passive_income", 5000),
				row("2026-02", "p2p_payout", "passive_income", -9000), // nets negative
			],
			months: MONTHS,
		});
		expect(f.incomePassive.find((l) => l.key === "p2p_payout")).toBeUndefined();
	});

	test("other transfers (self_transfer, sweep) never enter the flow", () => {
		const f = moneyFlow({
			rows: [
				row("2026-01", "salary", "active_income", 100000),
				row("2026-01", "rent", "expense", -20000),
				row("2026-01", "sweep_in", "transfer", 500000),
				row("2026-01", "self_transfer", "transfer", -300000),
			],
			months: ["2026-01"],
		});
		expect(f.incomeTotal).toBe(100000);
		expect(f.savings).toBe(80000);
	});
});
