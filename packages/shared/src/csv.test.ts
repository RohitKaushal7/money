import { describe, expect, test } from "bun:test";
import {
	type CsvColumn,
	csvAmount,
	INVESTMENT_CSV_COLUMNS,
	type InvestmentCsvRow,
	TRANSACTION_CSV_COLUMNS,
	type TransactionCsvRow,
	toCsv,
} from "./csv";

interface Row {
	a: string;
	n: number | null;
}
const cols: CsvColumn<Row>[] = [
	{ key: "a", header: "a" },
	{ key: "n", header: "n", format: csvAmount },
];

describe("toCsv", () => {
	test("emits a header then one line per row, CRLF-joined", () => {
		const csv = toCsv(
			[
				{ a: "x", n: 1 },
				{ a: "y", n: 2 },
			],
			cols,
		);
		expect(csv).toBe("a,n\r\nx,1.00\r\ny,2.00");
	});

	test("header only when there are no rows", () => {
		expect(toCsv([], cols)).toBe("a,n");
	});

	test("quotes fields with comma, quote, or newline; doubles inner quotes", () => {
		const c: CsvColumn<{ v: string }>[] = [{ key: "v", header: "v" }];
		expect(toCsv([{ v: "a,b" }], c)).toBe('v\r\n"a,b"');
		expect(toCsv([{ v: 'she said "hi"' }], c)).toBe('v\r\n"she said ""hi"""');
		expect(toCsv([{ v: "line1\nline2" }], c)).toBe('v\r\n"line1\nline2"');
	});

	test("passes unicode through (quoted only if it must be)", () => {
		const c: CsvColumn<{ v: string }>[] = [{ key: "v", header: "v" }];
		expect(toCsv([{ v: "₹1,000 BLINKIT" }], c)).toBe('v\r\n"₹1,000 BLINKIT"');
		expect(toCsv([{ v: "plain" }], c)).toBe("v\r\nplain");
	});

	test("null/undefined render as empty fields", () => {
		expect(toCsv([{ a: "", n: null }], cols)).toBe("a,n\r\n,");
	});
});

describe("csvAmount", () => {
	test("2dp, no separators, blank for null/undefined", () => {
		expect(csvAmount(1234.5)).toBe("1234.50");
		expect(csvAmount(-1648.7)).toBe("-1648.70");
		expect(csvAmount(null)).toBe("");
		expect(csvAmount(undefined)).toBe("");
		expect(csvAmount("")).toBe("");
	});
});

describe("column specs", () => {
	test("transaction columns: amount/balance 2dp, category label, kind", () => {
		const rows: TransactionCsvRow[] = [
			{
				date: "2026-06-02",
				narration: "BLINKIT",
				amount: -1648.7,
				balance: 5000,
				categoryLabel: "Groceries",
				kind: "expense",
			},
		];
		expect(toCsv(rows, TRANSACTION_CSV_COLUMNS)).toBe(
			"date,narration,amount,balance,category,kind\r\n2026-06-02,BLINKIT,-1648.70,5000.00,Groceries,expense",
		);
	});

	test("investment columns: booleans render true/false, blank optionals", () => {
		const rows: InvestmentCsvRow[] = [
			{
				name: "Wint NCD",
				type: "ncd",
				incomeClass: "income",
				platform: "Wint",
				group: null,
				principal: 100000,
				currentValue: 105000,
				currency: "INR",
				annualRate: 0.11,
				interestCadence: "monthly",
				payout: "cash",
				startDate: "2025-01-01",
				maturityDate: "2027-01-01",
				status: "active",
				isPassiveIncomeSource: true,
			},
		];
		const lines = toCsv(rows, INVESTMENT_CSV_COLUMNS).split("\r\n");
		expect(lines[0]).toBe(
			"name,type,income_class,platform,group,principal,current_value,currency,annual_rate,interest_cadence,payout,start_date,maturity_date,status,is_passive_income_source",
		);
		expect(lines[1]).toBe(
			"Wint NCD,ncd,income,Wint,,100000.00,105000.00,INR,0.11,monthly,cash,2025-01-01,2027-01-01,active,true",
		);
	});
});
