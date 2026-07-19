import { describe, expect, test } from "bun:test";
import { mapCategory, parseFee, parseRate } from "./cards-parse";

describe("parseRate", () => {
	test("extracts the first percentage as a fraction", () => {
		expect(parseRate("0.2% (1x)")).toBeCloseTo(0.002, 6);
		expect(parseRate("10%")).toBeCloseTo(0.1, 6);
		expect(parseRate("3% / 4% / 5%")).toBeCloseTo(0.03, 6);
		expect(parseRate("1% on other spends (cap 500/cycle)")).toBeCloseTo(
			0.01,
			6,
		);
		expect(parseRate("non-Neon: 1.5% scan-and-pay, 0.5% online")).toBeCloseTo(
			0.015,
			6,
		);
	});
	test("null when no percentage", () => {
		expect(parseRate("cashback")).toBeNull();
		expect(parseRate(undefined)).toBeNull();
	});
});

describe("parseFee", () => {
	test("extracts the leading number", () => {
		expect(parseFee(0)).toBe(0);
		expect(parseFee("500 + GST")).toBe(500);
		expect(parseFee("2,00,000/year")).toBe(200000);
		expect(parseFee("lifetime free")).toBeNull();
	});
});

describe("mapCategory", () => {
	test("keyword-maps the prose 'on' text to a taxonomy key", () => {
		expect(mapCategory("Swiggy app (Food, Instamart, Genie)")).toBe(
			"food_delivery",
		);
		expect(mapCategory("Amazon.in incl. flights/hotels")).toBe("amazon");
		expect(mapCategory("online shopping in eligible MCCs")).toBe(
			"online_shopping",
		);
		expect(mapCategory("Cleartrip (flights + hotels)")).toBe("travel");
		expect(mapCategory("scan-and-pay")).toBe("upi");
		expect(mapCategory("something unrecognised")).toBe("offline_other");
	});
});
