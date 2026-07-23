import { describe, expect, test } from "bun:test";
import {
	AXIO_OTHER,
	type AxioSpendRow,
	accountKind,
	axioColors,
	axioSeries,
	cardBillCrossCheck,
	categoryTotals,
	headerSplit,
	isCreditAccount,
	periodOf,
	settlementMonth,
	topAxioCategories,
} from "./axio";
import { OTHER_COLOR, slotVar } from "./category-colors";

describe("accountKind / isCreditAccount", () => {
	test("the 'credit' token means a card", () => {
		expect(accountKind("Axis credit 4444")).toBe("credit");
		expect(accountKind("One Card credit XXXX")).toBe("credit");
		expect(isCreditAccount("HDFC credit 5555")).toBe(true);
	});
	test("Slice is a credit line despite lacking the token", () => {
		expect(accountKind("Slice  8888")).toBe("credit");
	});
	test("cash and bank accounts are not cards", () => {
		expect(accountKind("CASH Spends")).toBe("cash");
		expect(accountKind("SBI  3333")).toBe("direct");
		expect(accountKind("Paytm Bank 7777")).toBe("direct");
		expect(isCreditAccount("SBI  3333")).toBe(false);
	});
});

describe("settlementMonth", () => {
	test("a month's card spend settles the next month", () => {
		expect(settlementMonth("2026-06")).toBe("2026-07");
	});
	test("December rolls into next January", () => {
		expect(settlementMonth("2026-12")).toBe("2027-01");
	});
});

describe("periodOf", () => {
	test("month is identity", () => {
		expect(periodOf("2026-06", "month")).toBe("2026-06");
	});
	test("quarter buckets by calendar quarter", () => {
		expect(periodOf("2026-06", "quarter")).toBe("2026-Q2");
		expect(periodOf("2026-01", "quarter")).toBe("2026-Q1");
		expect(periodOf("2026-12", "quarter")).toBe("2026-Q4");
	});
	test("year is the leading four digits", () => {
		expect(periodOf("2026-06", "year")).toBe("2026");
	});
});

const R = (
	month: string,
	category: string,
	account: string,
	amount: number,
	n = 1,
): AxioSpendRow => ({ month, category, account, amount, n });

// Real-shaped fixture: the three "… credit …" rows are cards; "HDFC  6666" and "SBI  3333" are bank
// accounts (in Axio the HDFC card is a separate "HDFC credit 5555"). GROCERIES sums to 2000 across a card
// and a bank row; BILLS (2500) is the biggest so ties never make the ordering ambiguous.
const JUNE: AxioSpendRow[] = [
	R("2026-06", "GROCERIES", "Axis credit 1111", 1648.7),
	R("2026-06", "FOOD & DRINKS", "YesBank credit 2222", 380),
	R("2026-06", "FUEL", "Axis credit 4444", 508.45),
	R("2026-06", "BILLS", "HDFC  6666", 2500),
	R("2026-06", "GROCERIES", "SBI  3333", 351.3),
];

describe("headerSplit", () => {
	test("splits total spend into cards vs direct", () => {
		const s = headerSplit(JUNE);
		expect(s.total).toBeCloseTo(5388.45, 2);
		expect(s.cards).toBeCloseTo(2537.15, 2); // the three credit-card rows
		expect(s.direct).toBeCloseTo(2851.3, 2); // HDFC bank + SBI
	});
});

describe("categoryTotals", () => {
	test("aggregates by category, sorted by total desc", () => {
		const t = categoryTotals(JUNE);
		expect(t[0]).toEqual({ category: "BILLS", total: 2500, count: 1 });
		expect(t.find((c) => c.category === "GROCERIES")?.total).toBeCloseTo(
			2000,
			2,
		);
	});
	test("scope=cards drops direct-account spend", () => {
		const t = categoryTotals(JUNE, "cards");
		expect(t.find((c) => c.category === "GROCERIES")?.total).toBeCloseTo(
			1648.7,
			2,
		);
	});
});

describe("topAxioCategories", () => {
	test("returns the n biggest category names by total", () => {
		expect(topAxioCategories(JUNE, 2)).toEqual(["BILLS", "GROCERIES"]);
	});
});

describe("axioSeries", () => {
	test("rolls months into periods and buckets non-selected categories into Other", () => {
		const rows: AxioSpendRow[] = [
			R("2026-01", "BILLS", "Axis credit 4444", 100),
			R("2026-02", "BILLS", "Axis credit 4444", 200),
			R("2026-02", "FUEL", "Axis credit 4444", 50),
		];
		const s = axioSeries(rows, {
			granularity: "quarter",
			scope: "all",
			categories: ["BILLS"],
		});
		expect(s).toHaveLength(1);
		const p = s[0];
		expect(p?.period).toBe("2026-Q1");
		expect(p?.total).toBe(350);
		expect(p?.byCategory.BILLS).toBe(300);
		expect(p?.byCategory[AXIO_OTHER]).toBe(50);
	});
});

describe("cardBillCrossCheck", () => {
	test("compares month M card spend against month M+1 card_bill", () => {
		const rows = [R("2026-06", "GROCERIES", "Axis credit 4444", 40000)];
		const bills = [{ month: "2026-07", amount: 38000 }];
		const result = cardBillCrossCheck(rows, bills);
		expect(result).toHaveLength(1);
		const row = result[0];
		expect(row?.spendMonth).toBe("2026-06");
		expect(row?.settleMonth).toBe("2026-07");
		expect(row?.cardSpend).toBe(40000);
		expect(row?.cardBill).toBe(38000);
		expect(row?.gap).toBe(2000);
	});
});

describe("axioColors", () => {
	test("common categories get their stable pins; UNKNOWN is muted Other", () => {
		const c = axioColors(["BILLS", "GROCERIES", "UNKNOWN"]);
		expect(c.get("BILLS")).toBe(slotVar(1));
		expect(c.get("GROCERIES")).toBe(slotVar(2));
		expect(c.get("UNKNOWN")).toBe(OTHER_COLOR);
	});
	test("a leftover claims the lowest free slot, stably regardless of input order", () => {
		const a = axioColors(["BILLS", "ENTERTAINMENT"]);
		const b = axioColors(["ENTERTAINMENT", "BILLS"]);
		expect(a.get("ENTERTAINMENT")).toBe(b.get("ENTERTAINMENT"));
		expect(a.get("BILLS")).toBe(slotVar(1)); // pinned, unaffected by the leftover
	});
	test("past five distinct colours, the rest fall to Other", () => {
		const c = axioColors(["a", "b", "c", "d", "e", "f"]);
		expect([...c.values()].filter((v) => v === OTHER_COLOR).length).toBe(1);
	});
});
