/**
 * Per-FY India income-tax reference data (Q11 / issue 005). Point-in-time facts, curated in-repo like the
 * category taxonomy — NOT derived. Verified 2026-07-19 (Budget 2026 announced no slab change, so FY2025-26
 * and FY2026-27 share one new-regime table).
 */

/** A slab boundary: everything up to `upTo` (inclusive) taxed at `rate`; `upTo: null` is the top open band. */
export interface Slab {
	upTo: number | null;
	rate: number;
}

/** A surcharge band on total income; `upTo: null` is the top open band. */
export interface SurchargeBand {
	upTo: number | null;
	rate: number;
}

export interface RegimeRef {
	slabs: Slab[];
	stdDeduction: number;
	/** taxable-income ceiling for the 87A rebate (ordinary income only) */
	rebateUpTo: number;
	/** maximum 87A rebate */
	rebateMax: number;
	/** true if this regime allows the Chapter-VI-A deductions (80C/80D/…) + HRA */
	allowsDeductions: boolean;
	/** surcharge on the equity CG buckets (111A/112A) is capped at this rate */
	surchargeCgCap: number;
	/** overall surcharge is capped at this rate (new regime = 0.25; old = 0.37) */
	surchargeCap: number;
	surcharge: SurchargeBand[];
}

export interface CgRef {
	equityStcg: number;
	equityLtcg: number;
	equityLtcgExempt: number;
	crypto: number;
	otherLtcg: number;
}

export interface TaxYear {
	fy: string;
	newRegime: RegimeRef;
	oldRegime: RegimeRef;
	cess: number;
	cg: CgRef;
}

const NEW_SLABS: Slab[] = [
	{ upTo: 400_000, rate: 0 },
	{ upTo: 800_000, rate: 0.05 },
	{ upTo: 1_200_000, rate: 0.1 },
	{ upTo: 1_600_000, rate: 0.15 },
	{ upTo: 2_000_000, rate: 0.2 },
	{ upTo: 2_400_000, rate: 0.25 },
	{ upTo: null, rate: 0.3 },
];

const OLD_SLABS: Slab[] = [
	{ upTo: 250_000, rate: 0 },
	{ upTo: 500_000, rate: 0.05 },
	{ upTo: 1_000_000, rate: 0.2 },
	{ upTo: null, rate: 0.3 },
];

const SURCHARGE: SurchargeBand[] = [
	{ upTo: 5_000_000, rate: 0 },
	{ upTo: 10_000_000, rate: 0.1 },
	{ upTo: 20_000_000, rate: 0.15 },
	{ upTo: 50_000_000, rate: 0.25 },
	{ upTo: null, rate: 0.37 },
];

const CG: CgRef = {
	equityStcg: 0.2,
	equityLtcg: 0.125,
	equityLtcgExempt: 125_000,
	crypto: 0.3,
	otherLtcg: 0.125,
};

function year(fy: string): TaxYear {
	return {
		fy,
		newRegime: {
			slabs: NEW_SLABS,
			stdDeduction: 75_000,
			rebateUpTo: 1_200_000,
			rebateMax: 60_000,
			allowsDeductions: false,
			surchargeCgCap: 0.15,
			surchargeCap: 0.25, // new regime caps surcharge at 25% (no 37% tier)
			surcharge: SURCHARGE,
		},
		oldRegime: {
			slabs: OLD_SLABS,
			stdDeduction: 50_000,
			rebateUpTo: 500_000,
			rebateMax: 12_500,
			allowsDeductions: true,
			surchargeCgCap: 0.15,
			surchargeCap: 0.37,
			surcharge: SURCHARGE,
		},
		cess: 0.04,
		cg: CG,
	};
}

export const TAX_YEARS: Record<string, TaxYear> = {
	"FY2025-26": year("FY2025-26"),
	"FY2026-27": year("FY2026-27"),
};

/** Look up a FY's reference data; throws on an unknown FY (data must be curated first). */
export function taxYear(fy: string): TaxYear {
	const y = TAX_YEARS[fy];
	if (!y) throw new Error(`no tax reference data for ${fy}`);
	return y;
}
