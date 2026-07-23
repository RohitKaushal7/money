import { describe, expect, test } from "bun:test";
import { type CsvColumn, csvAmount, toCsv } from "./csv";

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
