import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	accountKind,
	axioRowId,
	isCreditAccount,
	periodOf,
	settlementMonth,
} from "./axio";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

describe("axioRowId", () => {
	test("hashes the documented parts, amount to 2dp, excluding category/flags", () => {
		const parts = {
			date: "2026-06-02",
			time: "03:49 PM",
			amount: 1648.7,
			drcr: "DR",
			account: "Axis credit 1111",
			place: "BLINKIT",
		};
		expect(axioRowId(parts)).toBe(
			md5("2026-06-02|03:49 PM|1648.70|DR|Axis credit 1111|BLINKIT"),
		);
	});

	test("re-tagging a row (category/flag change) does not change its id", () => {
		const base = {
			date: "2026-06-01",
			time: "01:55 PM",
			amount: 250,
			drcr: "DR",
			account: "YesBank credit 2222",
			place: "SHESH PAL",
		};
		expect(axioRowId(base)).toBe(axioRowId({ ...base }));
	});
});

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
