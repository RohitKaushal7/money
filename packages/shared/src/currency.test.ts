import { describe, expect, test } from "bun:test";
import { type Currency, convert, ratesOf, toInr } from "./currency";

const CURRENCIES: Currency[] = [
	{ code: "USD", symbol: "$", rateToInr: 96, enabled: true },
	{ code: "EUR", symbol: "€", rateToInr: 110, enabled: true },
];
const rates = ratesOf(CURRENCIES);

describe("ratesOf", () => {
	test("always pins INR = 1", () => {
		expect(rates.INR).toBe(1);
		expect(rates.USD).toBe(96);
	});
});

describe("toInr", () => {
	test("converts a native amount to INR", () => {
		expect(toInr(100, "USD", rates)).toBe(9600);
		expect(toInr(8.41, "EUR", rates)).toBeCloseTo(925.1, 1);
	});
	test("INR / undefined / unknown ⇒ unchanged", () => {
		expect(toInr(500, "INR", rates)).toBe(500);
		expect(toInr(500, undefined, rates)).toBe(500);
		expect(toInr(500, "GBP", rates)).toBe(500);
	});
});

describe("convert", () => {
	test("cross-rate goes via INR", () => {
		// 96 USD = 9216 INR = 83.78 EUR
		expect(convert(96, "USD", "EUR", rates)).toBeCloseTo(9216 / 110, 4);
	});
	test("same currency is identity", () => {
		expect(convert(42, "USD", "USD", rates)).toBe(42);
	});
});
