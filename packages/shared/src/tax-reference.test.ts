import { describe, expect, test } from "bun:test";
import { TAX_YEARS, taxYear } from "./tax-reference";

describe("tax reference data", () => {
	test("both live FYs exist and share the new-regime table", () => {
		expect(Object.keys(TAX_YEARS)).toEqual(
			expect.arrayContaining(["FY2025-26", "FY2026-27"]),
		);
		expect(taxYear("FY2026-27").newRegime.slabs).toEqual(
			taxYear("FY2025-26").newRegime.slabs,
		);
	});

	test("new-regime slabs are the verified Budget-2025 ladder", () => {
		const s = taxYear("FY2025-26").newRegime.slabs;
		expect(s).toEqual([
			{ upTo: 400_000, rate: 0 },
			{ upTo: 800_000, rate: 0.05 },
			{ upTo: 1_200_000, rate: 0.1 },
			{ upTo: 1_600_000, rate: 0.15 },
			{ upTo: 2_000_000, rate: 0.2 },
			{ upTo: 2_400_000, rate: 0.25 },
			{ upTo: null, rate: 0.3 },
		]);
	});

	test("regime knobs: std deduction, rebate ceilings, cg rates", () => {
		const y = taxYear("FY2025-26");
		expect(y.newRegime.stdDeduction).toBe(75_000);
		expect(y.newRegime.rebateUpTo).toBe(1_200_000);
		expect(y.newRegime.rebateMax).toBe(60_000);
		expect(y.oldRegime.stdDeduction).toBe(50_000);
		expect(y.oldRegime.rebateUpTo).toBe(500_000);
		expect(y.oldRegime.rebateMax).toBe(12_500);
		expect(y.cess).toBe(0.04);
		expect(y.cg.equityStcg).toBe(0.2);
		expect(y.cg.equityLtcg).toBe(0.125);
		expect(y.cg.equityLtcgExempt).toBe(125_000);
		expect(y.cg.crypto).toBe(0.3);
		expect(y.cg.otherLtcg).toBe(0.125);
	});

	test("taxYear throws on an unknown FY", () => {
		expect(() => taxYear("FY1999-00")).toThrow();
	});
});
