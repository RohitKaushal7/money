/**
 * India income-tax compute (Q11 / issue 005) — pure, no I/O. Old-vs-new regime comparison, capital-gains at
 * special rates, surcharge with marginal relief, 87A rebate (ordinary income only), 4% cess, and the
 * marginal rate that feeds the after-tax KPI switch. Reference constants live in ./tax-reference.
 */

import type { RegimeRef, Slab } from "./tax-reference";
import { taxYear } from "./tax-reference";

/** Realised capital gains per bucket (INR). Manual entry in v1 (no cost-basis lots yet). */
export interface CapitalGains {
	/** listed equity/equity-MF, held ≤12m — 111A, 20% */
	equityStcg: number;
	/** listed equity/equity-MF, held >12m — 112A, 12.5%, first ₹1.25L/FY exempt */
	equityLtcg: number;
	/** crypto / VDA — 115BBH, 30% flat, no exemption/set-off */
	crypto: number;
	/** debt/other, held short — taxed at slab (added to ordinary income) */
	otherStcg: number;
	/** debt/other, held long — 12.5% */
	otherLtcg: number;
}

/** Old-regime deductions (already resolved to INR amounts; ignored under the new regime). */
export interface Deductions {
	/** 80C — capped ₹1.5L */
	s80c: number;
	/** 80D — health insurance */
	s80d: number;
	/** 80TTA — savings interest, capped ₹10k */
	s80tta: number;
	/** 80DD — 0 or ₹1.25L (severe disability, flat) */
	s80dd: number;
	/** HRA exemption, pre-computed via hraExemption() */
	hra: number;
}

export interface TaxInputs {
	salary: number;
	/** taxable passive income (interest/coupons/payouts/dividends) */
	otherIncome: number;
	capitalGains: CapitalGains;
	deductions: Deductions;
}

export type Regime = "old" | "new";

export interface RegimeResult {
	regime: Regime;
	/** salary + otherIncome + every CG bucket */
	grossIncome: number;
	/** ordinary income after std deduction + (old-regime) deductions + otherStcg */
	ordinaryTaxable: number;
	slabTax: number;
	/** tax on the special-rate CG buckets */
	cgTax: number;
	surcharge: number;
	cess: number;
	rebate: number;
	totalTax: number;
}

export const ZERO_CG: CapitalGains = {
	equityStcg: 0,
	equityLtcg: 0,
	crypto: 0,
	otherStcg: 0,
	otherLtcg: 0,
};

export const ZERO_DEDUCTIONS: Deductions = {
	s80c: 0,
	s80d: 0,
	s80tta: 0,
	s80dd: 0,
	hra: 0,
};

/** Marginal slab tax on `taxable` income (INR). Walks the bands, taxing each layer at its rate. */
export function slabTax(taxable: number, slabs: Slab[]): number {
	if (taxable <= 0) return 0;
	let tax = 0;
	let prev = 0;
	for (const band of slabs) {
		const ceiling = band.upTo ?? Number.POSITIVE_INFINITY;
		if (taxable <= prev) break;
		const layer = Math.min(taxable, ceiling) - prev;
		tax += layer * band.rate;
		prev = ceiling;
	}
	return tax;
}

/** HRA exemption (old regime) = least of {HRA received, rent − 10% basic, 50%/40% basic}, floored at 0. */
export function hraExemption(input: {
	basic: number;
	hraReceived: number;
	rentPaid: number;
	metro: boolean;
}): number {
	const rentOverTenPct = input.rentPaid - 0.1 * input.basic;
	const pctBasic = (input.metro ? 0.5 : 0.4) * input.basic;
	return Math.max(0, Math.min(input.hraReceived, rentOverTenPct, pctBasic));
}

/** The surcharge band rate and its floor for `totalIncome`. */
function surchargeBand(
	totalIncome: number,
	ref: RegimeRef,
): { rate: number; floor: number } {
	let floor = 0;
	for (const band of ref.surcharge) {
		const ceiling = band.upTo ?? Number.POSITIVE_INFINITY;
		if (totalIncome <= ceiling) {
			return { rate: Math.min(band.rate, ref.surchargeCap), floor };
		}
		floor = ceiling;
	}
	return { rate: 0, floor: 0 };
}

/**
 * Raw surcharge on `taxBeforeSurcharge` (INR) — band rate by `totalIncome`, with the equity-CG portion
 * (`cgTax`) capped at `ref.surchargeCgCap` (15%). Marginal relief is applied separately in
 * {@link computeRegime}, which knows the tax at the band floor.
 */
export function surcharge(input: {
	totalIncome: number;
	taxBeforeSurcharge: number;
	cgTax: number;
	ref: RegimeRef;
}): number {
	const { rate } = surchargeBand(input.totalIncome, input.ref);
	if (rate === 0) return 0;
	const cgCapped = Math.min(rate, input.ref.surchargeCgCap);
	const nonCgTax = Math.max(0, input.taxBeforeSurcharge - input.cgTax);
	return nonCgTax * rate + input.cgTax * cgCapped;
}

/**
 * The full per-regime waterfall: gross → deductions → ordinary slab tax → CG at special rates → 87A rebate
 * (ordinary only) → surcharge (+ marginal relief) → 4% cess. Deductions apply only under the old regime.
 */
export function computeRegime(
	inputs: TaxInputs,
	regime: Regime,
	fy: string,
): RegimeResult {
	const y = taxYear(fy);
	const ref = regime === "new" ? y.newRegime : y.oldRegime;
	const cg = inputs.capitalGains;

	const grossIncome =
		inputs.salary +
		inputs.otherIncome +
		cg.equityStcg +
		cg.equityLtcg +
		cg.crypto +
		cg.otherStcg +
		cg.otherLtcg;

	const d = inputs.deductions;
	const deductions = ref.allowsDeductions
		? Math.min(d.s80c, 150_000) +
			d.s80d +
			Math.min(d.s80tta, 10_000) +
			d.s80dd +
			d.hra
		: 0;

	const ordinaryTaxable = Math.max(
		0,
		inputs.salary +
			inputs.otherIncome +
			cg.otherStcg -
			ref.stdDeduction -
			deductions,
	);
	const slab = slabTax(ordinaryTaxable, ref.slabs);

	const equityLtcgTaxable = Math.max(0, cg.equityLtcg - y.cg.equityLtcgExempt);
	const cgTax =
		cg.equityStcg * y.cg.equityStcg +
		equityLtcgTaxable * y.cg.equityLtcg +
		cg.otherLtcg * y.cg.otherLtcg +
		cg.crypto * y.cg.crypto;

	// 87A rebate — ordinary income only, never capital gains.
	let rebate = 0;
	if (ordinaryTaxable <= ref.rebateUpTo) {
		rebate = Math.min(slab, ref.rebateMax);
	} else if (!ref.allowsDeductions) {
		// new-regime marginal relief just above the rebate ceiling
		const overCeiling = ordinaryTaxable - ref.rebateUpTo;
		if (slab > overCeiling) rebate = slab - overCeiling;
	}

	const taxBeforeSurcharge = Math.max(0, slab - rebate) + cgTax;
	let sur = surcharge({
		totalIncome: grossIncome,
		taxBeforeSurcharge,
		cgTax,
		ref,
	});

	// Marginal relief: (tax + surcharge) may not exceed the tax at the band floor plus income over the floor.
	// The tax at the floor is approximated by scaling this income's ordinary + CG down to the floor — exact
	// at the boundary (scale → 1), which is where relief actually binds.
	const { floor } = surchargeBand(grossIncome, ref);
	if (floor > 0 && grossIncome > floor) {
		const scale = floor / grossIncome;
		const slabAtFloor = slabTax(ordinaryTaxable * scale, ref.slabs);
		const taxAtFloor = slabAtFloor + cgTax * scale; // rebate is 0 this far above the ceiling
		const relief = Math.max(
			0,
			taxBeforeSurcharge + sur - taxAtFloor - (grossIncome - floor),
		);
		sur = Math.max(0, sur - relief);
	}

	const cess = (taxBeforeSurcharge + sur) * y.cess;

	return {
		regime,
		grossIncome,
		ordinaryTaxable,
		slabTax: slab,
		cgTax,
		surcharge: sur,
		cess,
		rebate,
		totalTax: taxBeforeSurcharge + sur + cess,
	};
}

/** Run both regimes and pick the cheaper. `saving` = tax avoided by choosing `recommended`. */
export function compareRegimes(
	inputs: TaxInputs,
	fy: string,
): {
	old: RegimeResult;
	new: RegimeResult;
	recommended: Regime;
	saving: number;
} {
	const oldR = computeRegime(inputs, "old", fy);
	const newR = computeRegime(inputs, "new", fy);
	const recommended: Regime = oldR.totalTax <= newR.totalTax ? "old" : "new";
	return {
		old: oldR,
		new: newR,
		recommended,
		saving: Math.abs(oldR.totalTax - newR.totalTax),
	};
}

/**
 * Extra old-regime deduction needed to make the old regime at least tie the new one. Returns null when the
 * new regime wins even at full deduction (bisection over 0…₹10L of added 80D-style deduction).
 */
export function breakevenDeduction(
	inputs: TaxInputs,
	fy: string,
): number | null {
	const taxOldWith = (extra: number) => {
		const withDed: TaxInputs = {
			...inputs,
			deductions: {
				...inputs.deductions,
				s80d: inputs.deductions.s80d + extra,
			},
		};
		return computeRegime(withDed, "old", fy).totalTax;
	};
	const newTax = computeRegime(inputs, "new", fy).totalTax;
	if (taxOldWith(0) <= newTax) return 0;
	let lo = 0;
	let hi = 1_000_000;
	if (taxOldWith(hi) > newTax) return null; // new wins even with ₹10L extra deduction
	for (let i = 0; i < 40; i++) {
		const mid = (lo + hi) / 2;
		if (taxOldWith(mid) <= newTax) hi = mid;
		else lo = mid;
	}
	return Math.round(hi);
}

/** Tax-free equity-LTCG headroom remaining this FY (the harvesting lever). */
export function ltcgHeadroom(equityLtcg: number, fy: string): number {
	return Math.max(0, taxYear(fy).cg.equityLtcgExempt - equityLtcg);
}

/** Rate on the next ₹ of ordinary income: slab rate × (1 + surcharge band) × (1 + cess). Feeds the KPI. */
export function marginalRate(
	inputs: TaxInputs,
	regime: Regime,
	fy: string,
): number {
	const y = taxYear(fy);
	const ref = regime === "new" ? y.newRegime : y.oldRegime;
	const r = computeRegime(inputs, regime, fy);

	// slab rate at the top of ordinary income
	let slabRate = 0;
	let prev = 0;
	for (const band of ref.slabs) {
		const ceiling = band.upTo ?? Number.POSITIVE_INFINITY;
		if (r.ordinaryTaxable > prev) slabRate = band.rate;
		prev = ceiling;
	}

	const { rate: surRate } = surchargeBand(r.grossIncome, ref);
	return slabRate * (1 + surRate) * (1 + y.cess);
}
