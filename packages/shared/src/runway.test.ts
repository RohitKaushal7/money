import { describe, expect, test } from "bun:test";
import { RUNWAY_CAP_YEARS, runwayProjection } from "./runway";

/** The live portfolio at the time this model was designed — the numbers the ADR quotes. */
const REAL = {
	startValue: 6_955_344,
	startDate: "2026-07-21",
	monthlyExpenses: 63_178,
};
const years = (annualReturn: number, inflation: number) =>
	runwayProjection({ ...REAL, assumptions: { annualReturn, inflation } })
		.yearsLeft;

describe("runwayProjection", () => {
	test("both assumptions off reproduces totalValue / annualExpenses exactly", () => {
		const naive = REAL.startValue / (REAL.monthlyExpenses * 12);
		expect(years(0, 0)).toBeCloseTo(naive, 6);
	});

	test("returns alone stretch the runway well past the naive figure", () => {
		expect(years(0.079, 0)).toBeCloseTo(16.4, 1);
	});

	test("inflation gives most of that back — the point of shipping both", () => {
		expect(years(0.079, 0.06)).toBeCloseTo(10.5, 1);
	});

	test("more inflation is always less runway", () => {
		const ladder = [0, 0.04, 0.06, 0.08].map((i) => years(0.079, i) ?? 0);
		for (let i = 1; i < ladder.length; i += 1) {
			expect(ladder[i] ?? 0).toBeLessThan(ladder[i - 1] ?? 0);
		}
	});
});

describe("when the money never runs out", () => {
	test("a return that outpaces spending plus inflation reports null, not a big number", () => {
		const p = runwayProjection({
			...REAL,
			assumptions: { annualReturn: 0.2, inflation: 0.06 },
		});
		expect(p.yearsLeft).toBeNull();
		expect(p.survivesHorizon).toBe(true);
		expect(p.depletesOn).toBeNull();
	});

	test("no expenses is not infinite wealth, but it is infinite runway", () => {
		const p = runwayProjection({
			...REAL,
			monthlyExpenses: 0,
			assumptions: { annualReturn: 0, inflation: 0 },
		});
		expect(p.yearsLeft).toBeNull();
	});

	test("the horizon caps the series rather than running forever", () => {
		const p = runwayProjection({
			...REAL,
			assumptions: { annualReturn: 0.2, inflation: 0.06 },
		});
		expect(p.points).toHaveLength(RUNWAY_CAP_YEARS * 12 + 1);
	});

	test("a shorter cap is honoured", () => {
		const p = runwayProjection({
			...REAL,
			assumptions: { annualReturn: 0.2, inflation: 0.06 },
			capYears: 5,
		});
		expect(p.points).toHaveLength(61);
		expect(p.survivesHorizon).toBe(true);
	});
});

describe("the series itself", () => {
	const p = runwayProjection({
		...REAL,
		assumptions: { annualReturn: 0.079, inflation: 0.06 },
	});

	test("starts at the anchor, on the anchor's date", () => {
		expect(p.points[0]?.value).toBe(REAL.startValue);
		expect(new Date(p.points[0]?.t ?? 0).toISOString().slice(0, 10)).toBe(
			REAL.startDate,
		);
	});

	test("ends at exactly zero, never below", () => {
		expect(p.points.at(-1)?.value).toBe(0);
		for (const pt of p.points) expect(pt.value).toBeGreaterThanOrEqual(0);
	});

	test("declines monotonically while depleting", () => {
		for (let i = 1; i < p.points.length; i += 1) {
			expect(p.points[i]?.value ?? 0).toBeLessThan(p.points[i - 1]?.value ?? 0);
		}
	});

	test("the last point lands on the reported depletion year", () => {
		const elapsedMs = (p.points.at(-1)?.t ?? 0) - (p.points[0]?.t ?? 0);
		expect(elapsedMs / (365.25 * 86_400_000)).toBeCloseTo(p.yearsLeft ?? 0, 1);
	});

	test("crosses a leap day without drifting off the month grid", () => {
		const leap = runwayProjection({
			startValue: 500_000,
			startDate: "2028-01-31",
			monthlyExpenses: 100_000,
			assumptions: { annualReturn: 0, inflation: 0 },
		});
		// 31 Jan + 1 month has no 31 Feb; JS rolls it forward rather than throwing.
		expect(leap.points).toHaveLength(6);
		expect(leap.yearsLeft).toBeCloseTo(5 / 12, 6);
	});
});

describe("degenerate inputs", () => {
	test("no money is an empty projection, not a divide-by-zero", () => {
		const p = runwayProjection({
			...REAL,
			startValue: 0,
			assumptions: { annualReturn: 0.079, inflation: 0.06 },
		});
		expect(p.points).toEqual([]);
		expect(p.yearsLeft).toBeNull();
		expect(p.survivesHorizon).toBe(false);
	});

	test("an unparseable start date is refused rather than charted as NaN", () => {
		const p = runwayProjection({
			...REAL,
			startDate: "not-a-date",
			assumptions: { annualReturn: 0.079, inflation: 0.06 },
		});
		expect(p.points).toEqual([]);
	});
});
