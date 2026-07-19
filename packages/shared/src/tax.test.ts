import { describe, expect, test } from "bun:test";
import {
	breakevenDeduction,
	compareRegimes,
	computeRegime,
	hraExemption,
	ltcgHeadroom,
	marginalRate,
	slabTax,
	surcharge,
	type TaxInputs,
	ZERO_CG,
	ZERO_DEDUCTIONS,
} from "./tax";
import { taxYear } from "./tax-reference";

const base = (
	over: Partial<{ salary: number; otherIncome: number }> = {},
): TaxInputs => ({
	salary: over.salary ?? 0,
	otherIncome: over.otherIncome ?? 0,
	capitalGains: { ...ZERO_CG },
	deductions: { ...ZERO_DEDUCTIONS },
});

describe("slabTax", () => {
	const nw = taxYear("FY2025-26").newRegime.slabs;
	const old = taxYear("FY2025-26").oldRegime.slabs;

	test("zero below the first threshold", () => {
		expect(slabTax(300_000, nw)).toBe(0);
		expect(slabTax(0, nw)).toBe(0);
	});

	test("marginal accumulation across new-regime bands", () => {
		// 12L: 4L@0 + 4L@5% + 4L@10% = 20k + 40k = 60,000
		expect(slabTax(1_200_000, nw)).toBe(60_000);
		// 16L: +4L@15% = 60k + 60k = 120,000
		expect(slabTax(1_600_000, nw)).toBe(120_000);
		// 24L: 120k + 4L@20% + 4L@25% = 120k + 80k + 100k = 300,000
		expect(slabTax(2_400_000, nw)).toBe(300_000);
	});

	test("old-regime bands", () => {
		// 10L: 2.5L@0 + 2.5L@5% + 5L@20% = 12.5k + 100k = 112,500
		expect(slabTax(1_000_000, old)).toBe(112_500);
		// 12L: +2L@30% = 112.5k + 60k = 172,500
		expect(slabTax(1_200_000, old)).toBe(172_500);
	});
});

describe("hraExemption (least of three)", () => {
	test("metro: rent − 10% basic often binds", () => {
		// least of {6L, 3L − 1.2L = 1.8L, 6L} = 1.8L
		expect(
			hraExemption({
				basic: 1_200_000,
				hraReceived: 600_000,
				rentPaid: 300_000,
				metro: true,
			}),
		).toBe(180_000);
	});

	test("HRA received can bind", () => {
		// least of {1L, 1.8L, 6L} = 1L
		expect(
			hraExemption({
				basic: 1_200_000,
				hraReceived: 100_000,
				rentPaid: 300_000,
				metro: true,
			}),
		).toBe(100_000);
	});

	test("no rent → no exemption; non-metro uses 40%", () => {
		expect(
			hraExemption({
				basic: 1_200_000,
				hraReceived: 600_000,
				rentPaid: 0,
				metro: true,
			}),
		).toBe(0);
		expect(
			hraExemption({
				basic: 1_200_000,
				hraReceived: 600_000,
				rentPaid: 300_000,
				metro: false,
			}),
		).toBe(180_000);
	});
});

describe("surcharge (raw band + CG cap)", () => {
	const oldRef = taxYear("FY2025-26").oldRegime;

	test("no surcharge under ₹50L", () => {
		expect(
			surcharge({
				totalIncome: 4_000_000,
				taxBeforeSurcharge: 1_000_000,
				cgTax: 0,
				ref: oldRef,
			}),
		).toBe(0);
	});

	test("10% band above ₹50L", () => {
		expect(
			surcharge({
				totalIncome: 6_000_000,
				taxBeforeSurcharge: 1_500_000,
				cgTax: 0,
				ref: oldRef,
			}),
		).toBe(150_000);
	});

	test("equity-CG surcharge is capped at 15% even in the 25% band", () => {
		// 3Cr income, all from equity CG tax of 30L → band 25% but CG cap 15% → 4.5L
		expect(
			surcharge({
				totalIncome: 30_000_000,
				taxBeforeSurcharge: 3_000_000,
				cgTax: 3_000_000,
				ref: oldRef,
			}),
		).toBe(450_000);
	});
});

describe("computeRegime", () => {
	test("new regime: ₹12.75L salary → zero tax (75k std + 12L rebate)", () => {
		const r = computeRegime(base({ salary: 1_275_000 }), "new", "FY2025-26");
		expect(r.ordinaryTaxable).toBe(1_200_000);
		expect(r.slabTax).toBe(60_000);
		expect(r.rebate).toBe(60_000);
		expect(r.totalTax).toBe(0);
	});

	test("new regime: ₹24.75L salary → taxable 24L → 3L slab + 4% cess", () => {
		const r = computeRegime(base({ salary: 2_475_000 }), "new", "FY2025-26");
		expect(r.ordinaryTaxable).toBe(2_400_000);
		expect(r.slabTax).toBe(300_000);
		expect(r.rebate).toBe(0);
		expect(r.cess).toBeCloseTo(12_000, 0);
		expect(r.totalTax).toBeCloseTo(312_000, 0);
	});

	test("87A rebate does NOT cover capital gains (the gotcha)", () => {
		// salary 10L → new taxable 9.25L (below 12L rebate ceiling); + 5L equity LTCG.
		// slab tax on 9.25L = 4L@0 + 4L@5% + 1.25L@10% = 20k + 12.5k = 32,500 → rebate wipes it.
		// equity LTCG (5L − 1.25L = 3.75L) × 12.5% = 46,875 stays. +4% cess.
		const inp = base({ salary: 1_000_000 });
		inp.capitalGains.equityLtcg = 500_000;
		const r = computeRegime(inp, "new", "FY2025-26");
		expect(r.rebate).toBe(32_500);
		expect(r.cgTax).toBeCloseTo(46_875, 0);
		expect(r.totalTax).toBeCloseTo(46_875 * 1.04, 0);
	});

	test("old regime applies deductions; new ignores them", () => {
		const inp = base({ salary: 1_500_000 });
		inp.deductions.s80c = 150_000;
		inp.deductions.s80dd = 125_000;
		const oldR = computeRegime(inp, "old", "FY2025-26");
		const newR = computeRegime(inp, "new", "FY2025-26");
		expect(oldR.ordinaryTaxable).toBe(1_175_000); // 15L − 50k − 1.5L − 1.25L
		expect(newR.ordinaryTaxable).toBe(1_425_000); // 15L − 75k
	});

	test("80C is capped at ₹1.5L", () => {
		const inp = base({ salary: 1_500_000 });
		inp.deductions.s80c = 500_000; // over-cap
		const r = computeRegime(inp, "old", "FY2025-26");
		expect(r.ordinaryTaxable).toBe(1_500_000 - 50_000 - 150_000);
	});

	test("marginal relief near ₹50L reduces the surcharge below the raw band amount", () => {
		// gross ~50.75L just over the ₹50L threshold → raw surcharge ≈ 10% of ~10.8L ≈ 108k; relief cuts it.
		const r = computeRegime(base({ salary: 5_075_000 }), "new", "FY2025-26");
		expect(r.surcharge).toBeGreaterThan(0);
		expect(r.surcharge).toBeLessThan(108_000);
		// the relief guarantee: (taxBeforeSurcharge + surcharge) − taxAtFloor ≤ income over floor
		expect(r.slabTax + r.surcharge).toBeLessThanOrEqual(1_080_000 + 75_000 + 1);
	});

	test("no relief when comfortably above the threshold", () => {
		// gross 70L, 10% band, relief does not bind → surcharge ≈ 10% of the base tax
		const r = computeRegime(base({ salary: 7_000_000 }), "new", "FY2025-26");
		expect(r.surcharge).toBeCloseTo(r.slabTax * 0.1, -2);
	});
});

describe("compare / breakeven / headroom / marginalRate", () => {
	test("recommends the cheaper regime and reports the saving", () => {
		const c = compareRegimes(base({ salary: 2_000_000 }), "FY2025-26");
		expect(["old", "new"]).toContain(c.recommended);
		const cheaper = Math.min(c.old.totalTax, c.new.totalTax);
		const dearer = Math.max(c.old.totalTax, c.new.totalTax);
		expect(c.saving).toBeCloseTo(dearer - cheaper, 0);
	});

	test("breakeven: extra deduction that flips new→old, or null", () => {
		const inp = base({ salary: 2_000_000 });
		const be = breakevenDeduction(inp, "FY2025-26");
		expect(be === null || be > 0).toBe(true);
		if (be !== null) {
			const withDed = base({ salary: 2_000_000 });
			withDed.deductions.s80d = be;
			const c = compareRegimes(withDed, "FY2025-26");
			expect(c.old.totalTax).toBeLessThanOrEqual(c.new.totalTax + 1);
		}
	});

	test("ltcg headroom = 1.25L minus realised, floored at 0", () => {
		expect(ltcgHeadroom(0, "FY2025-26")).toBe(125_000);
		expect(ltcgHeadroom(100_000, "FY2025-26")).toBe(25_000);
		expect(ltcgHeadroom(200_000, "FY2025-26")).toBe(0);
	});

	test("marginalRate: 30% bracket → 0.312 with cess, no surcharge", () => {
		expect(
			marginalRate(base({ salary: 3_000_000 }), "new", "FY2025-26"),
		).toBeCloseTo(0.312, 3);
	});
});
