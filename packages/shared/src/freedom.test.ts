import { describe, expect, test } from "bun:test";
import {
	freedomProjection,
	observedSavingRate,
	perpetuityTarget,
	realGrowthRate,
} from "./freedom";
import { runwayProjection } from "./runway";

const SPEND = 99_217;
const NOMINAL = 0.091;
const INFLATION = 0.06;
const A = { annualReturn: NOMINAL, inflation: INFLATION };

describe("the perpetuity target", () => {
	test("is the smallest corpus the runway model never depletes", () => {
		const target = perpetuityTarget({ monthlyExpenses: SPEND, assumptions: A });
		expect(target).not.toBeNull();
		const survives = (v: number) =>
			runwayProjection({
				startValue: v,
				startDate: "2026-07-22",
				monthlyExpenses: SPEND,
				assumptions: A,
				capYears: 200,
			}).survivesHorizon;
		// A true boundary: above it the balance holds forever, below it eventually depletes.
		//
		// The bracket is ±5% rather than ±0.1% because a deviation from the fixed point grows at exactly the
		// real rate (3.3%/yr), so starting 0.1% short takes ~213 years to reach zero — beyond any horizon
		// worth simulating. That slowness is precisely why the target must be solved algebraically: no
		// finite-horizon search can tell "holds forever" from "holds for two centuries".
		expect(survives((target as number) * 1.05)).toBe(true);
		expect(survives((target as number) * 0.95)).toBe(false);
	});

	test("is far above the naive nominal reading — the real return is what sustains it", () => {
		const target = perpetuityTarget({
			monthlyExpenses: SPEND,
			assumptions: A,
		}) as number;
		// Dividing spending by the *nominal* return would say ~2× wealth; the real return says ~5.6×.
		const naive = (SPEND * 12) / NOMINAL;
		expect(target).toBeGreaterThan(naive * 2);
	});

	test("is unreachable when the return cannot outrun inflation", () => {
		expect(
			perpetuityTarget({
				monthlyExpenses: SPEND,
				assumptions: { annualReturn: 0.04, inflation: 0.06 },
			}),
		).toBeNull();
		expect(
			perpetuityTarget({
				monthlyExpenses: SPEND,
				assumptions: { annualReturn: 0.06, inflation: 0.065 },
			}),
		).toBeNull();
	});

	/**
	 * The comparison is against the **effective** rate, not the nominal one: 6% compounded monthly is 6.17%,
	 * which does outrun 6% inflation. A perpetuity exists — an enormous one, because the margin is 0.16%.
	 * Testing this against the nominal rate would wrongly report it unreachable.
	 */
	test("compares effective against inflation, so 6% nominal beats 6% inflation", () => {
		const target = perpetuityTarget({
			monthlyExpenses: SPEND,
			assumptions: { annualReturn: 0.06, inflation: 0.06 },
		});
		expect(target).not.toBeNull();
		expect(target as number).toBeGreaterThan(50e7); // vast, as a razor-thin margin demands
	});

	test("is unreachable with returns switched off, however large the corpus", () => {
		expect(
			perpetuityTarget({
				monthlyExpenses: SPEND,
				assumptions: { annualReturn: 0, inflation: INFLATION },
			}),
		).toBeNull();
	});

	test("falls as spending falls — a cut moves the goalpost, not just the pace", () => {
		const at = (s: number) =>
			perpetuityTarget({ monthlyExpenses: s, assumptions: A }) as number;
		expect(at(65_879)).toBeLessThan(at(SPEND));
	});

	test("is null when there is nothing to draw down", () => {
		expect(perpetuityTarget({ monthlyExpenses: 0, assumptions: A })).toBeNull();
	});
});

describe("the observed saving rate", () => {
	test("recovers a known contribution, crediting the balance its return", () => {
		// A year of ₹10,000/mo added to ₹10,00,000 earning 10%: end ≈ 10L + 1L return + 1.2L saved.
		const rate = observedSavingRate({
			logs: [
				{ asOf: "2025-01-01", value: 10_00_000 },
				{ asOf: "2026-01-01", value: 10_00_000 + 1_00_000 + 1_20_000 },
			],
			annualReturn: 0.1,
		});
		expect(rate).toBeCloseTo(10_000, -1);
	});

	test("does not mistake investment return for saving", () => {
		// Pure growth, nothing added: the rate is zero, not the whole gain.
		const rate = observedSavingRate({
			logs: [
				{ asOf: "2025-01-01", value: 10_00_000 },
				{ asOf: "2026-01-01", value: 11_00_000 },
			],
			annualReturn: 0.1,
		});
		expect(rate).toBeCloseTo(0, 0);
	});

	test("is negative when the portfolio is being drawn down", () => {
		const rate = observedSavingRate({
			logs: [
				{ asOf: "2025-01-01", value: 10_00_000 },
				{ asOf: "2026-01-01", value: 9_00_000 },
			],
			annualReturn: 0.1,
		});
		expect(rate as number).toBeLessThan(0);
	});

	test("is null on a single log, and on a window too short to mean anything", () => {
		expect(
			observedSavingRate({
				logs: [{ asOf: "2025-01-01", value: 10_00_000 }],
				annualReturn: 0.1,
			}),
		).toBeNull();
		expect(
			observedSavingRate({
				logs: [
					{ asOf: "2026-01-01", value: 10_00_000 },
					{ asOf: "2026-02-01", value: 10_50_000 },
				],
				annualReturn: 0.1,
			}),
		).toBeNull();
	});

	test("sorts unordered logs rather than reading a negative gap", () => {
		const ordered = observedSavingRate({
			logs: [
				{ asOf: "2025-01-01", value: 10_00_000 },
				{ asOf: "2026-01-01", value: 12_20_000 },
			],
			annualReturn: 0.1,
		});
		const shuffled = observedSavingRate({
			logs: [
				{ asOf: "2026-01-01", value: 12_20_000 },
				{ asOf: "2025-01-01", value: 10_00_000 },
			],
			annualReturn: 0.1,
		});
		expect(shuffled).toBeCloseTo(ordered as number, 6);
	});
});

describe("the freedom projection", () => {
	const target = perpetuityTarget({
		monthlyExpenses: SPEND,
		assumptions: A,
	}) as number;
	const base = {
		startValue: 69_62_056,
		startDate: "2026-07-19",
		target,
		assumptions: A,
	};

	test("grows at the real rate, not the nominal one", () => {
		const p = freedomProjection({ ...base, monthlyContribution: 67_163 });
		expect(p.realRate).toBeCloseTo(realGrowthRate(A), 12);
		// 9.1% nominal against 6% inflation is ~3.3% real — the number the whole feature turns on.
		expect(p.realRate).toBeGreaterThan(0.03);
		expect(p.realRate).toBeLessThan(0.035);
	});

	/**
	 * The regression this module exists for. Comparing a nominally-growing balance against a frozen target
	 * makes this look like ~20 years; in real terms it is ~20 with this contribution but ~53 with none, and
	 * the naive version claims *zero* saving suffices by year 20. Pin both ends.
	 */
	test("does not reproduce the fixed-target nominal answer", () => {
		const saving = freedomProjection({ ...base, monthlyContribution: 67_163 });
		expect(saving.yearsToTarget).toBeCloseTo(19.8, 0);

		const none = freedomProjection({ ...base, monthlyContribution: 0 });
		// The naive calculation said compounding alone arrives by year 20. It does not.
		expect(none.yearsToTarget as number).toBeGreaterThan(50);
	});

	test("arrives sooner the more is saved", () => {
		const a = freedomProjection({ ...base, monthlyContribution: 50_000 });
		const b = freedomProjection({ ...base, monthlyContribution: 1_00_000 });
		expect(b.yearsToTarget as number).toBeLessThan(a.yearsToTarget as number);
	});

	test("is already free when the balance is at or above the target", () => {
		const p = freedomProjection({
			...base,
			startValue: target,
			monthlyContribution: 0,
		});
		expect(p.yearsToTarget).toBe(0);
		expect(p.freeOn).toBe("2026-07-19");
		expect(p.progress).toBeCloseTo(1, 6);
	});

	test("reports progress against the target", () => {
		const p = freedomProjection({ ...base, monthlyContribution: 67_163 });
		expect(p.progress).toBeCloseTo(base.startValue / target, 6);
		expect(p.progress).toBeLessThan(0.25);
	});

	test("never arrives when nothing is saved and the real rate is not positive", () => {
		const p = freedomProjection({
			...base,
			monthlyContribution: 0,
			assumptions: { annualReturn: 0.05, inflation: 0.06 },
		});
		expect(p.yearsToTarget).toBeNull();
		expect(p.freeOn).toBeNull();
	});

	test("still arrives on contributions alone when growth is dead", () => {
		const p = freedomProjection({
			...base,
			monthlyContribution: 2_00_000,
			assumptions: { annualReturn: 0.06, inflation: 0.06 },
		});
		expect(p.yearsToTarget).not.toBeNull();
	});

	test("the curve starts at the anchor and ends at or above the target", () => {
		const p = freedomProjection({ ...base, monthlyContribution: 67_163 });
		expect(p.points[0]?.value).toBe(base.startValue);
		expect(p.points.at(-1)?.value).toBeGreaterThanOrEqual(target);
		expect(p.points[0]?.t).toBe(Date.parse("2026-07-19T00:00:00Z"));
	});

	test("a zero target is a degenerate input, not a division by zero", () => {
		const p = freedomProjection({
			...base,
			target: 0,
			monthlyContribution: 1000,
		});
		expect(p.points).toEqual([]);
		expect(p.progress).toBe(0);
		expect(p.yearsToTarget).toBeNull();
	});
});
