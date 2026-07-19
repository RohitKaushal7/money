import { describe, expect, test } from "bun:test";
import {
	daysBetween,
	type NetworthLog,
	networthSeries,
	stepGrowth,
} from "./networth";

describe("daysBetween", () => {
	test("counts whole days, date-only (no TZ drift)", () => {
		expect(daysBetween("2024-01-01", "2024-04-01")).toBe(91); // 2024 is a leap year
		expect(daysBetween("2025-07-07", "2025-07-21")).toBe(14);
		expect(daysBetween("2025-03-31", "2025-04-02")).toBe(2);
	});

	test("null on unparseable input", () => {
		expect(daysBetween("nope", "2024-01-01")).toBeNull();
	});
});

describe("stepGrowth (simple annualisation)", () => {
	test("reproduces the sheet's Growth column", () => {
		// 3.80L → 3.90L over 91 days → the sheet's ~10.5%
		expect(
			stepGrowth(
				{ value: 3_800_000, asOf: "2024-01-01" },
				{ value: 3_900_000, asOf: "2024-04-01" },
			),
		).toBeCloseTo(0.1056, 3);
		// a 2-day +₹40k jump reads as a big annualised swing (simple, not compressed by compounding)
		expect(
			stepGrowth(
				{ value: 4_085_836, asOf: "2024-11-03" },
				{ value: 4_125_836, asOf: "2024-11-05" },
			),
		).toBeCloseTo(1.7866, 3);
		// a drop annualises negative
		expect(
			stepGrowth(
				{ value: 5_350_696, asOf: "2025-07-07" },
				{ value: 5_277_696, asOf: "2025-07-21" },
			),
		).toBeCloseTo(-0.3557, 3);
	});

	test("null when the gap is non-positive or the base is zero", () => {
		const p = { value: 100, asOf: "2025-01-01" };
		expect(stepGrowth(p, { value: 200, asOf: "2025-01-01" })).toBeNull();
		expect(
			stepGrowth(
				{ value: 0, asOf: "2025-01-01" },
				{ value: 5, asOf: "2025-02-01" },
			),
		).toBeNull();
	});
});

describe("networthSeries", () => {
	const logs: NetworthLog[] = [
		{ asOf: "2025-07-21", value: 5_277_696 },
		{ asOf: "2024-01-01", value: 3_800_000 }, // out of order on purpose
		{ asOf: "2026-01-05", value: 5_991_309 },
	];

	test("sorts chronologically; first point has null growth", () => {
		const s = networthSeries(logs);
		expect(s.points.map((p) => p.asOf)).toEqual([
			"2024-01-01",
			"2025-07-21",
			"2026-01-05",
		]);
		expect(s.points[0]?.growth).toBeNull();
		expect(s.points[0]?.days).toBeNull();
		expect(s.points[1]?.growth).not.toBeNull();
	});

	test("headline compound CAGR spans first → latest", () => {
		const s = networthSeries(logs);
		expect(s.first).toBe(3_800_000);
		expect(s.latest).toBe(5_991_309);
		expect(s.change).toBe(2_191_309);
		// (5_991_309/3_800_000)^(365/735) − 1 ≈ 0.2537
		expect(s.cagr).toBeCloseTo(0.2537, 3);
	});

	test("empty and single-point series degrade gracefully", () => {
		expect(networthSeries([])).toMatchObject({
			points: [],
			first: null,
			latest: null,
			cagr: null,
		});
		const one = networthSeries([{ asOf: "2025-01-01", value: 100 }]);
		expect(one.points).toHaveLength(1);
		expect(one.cagr).toBeNull();
		expect(one.change).toBe(0);
	});
});
