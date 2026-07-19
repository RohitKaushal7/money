/**
 * Net-worth log compute (pure; ADR-0007). A dated series of total-net-worth points where each point
 * carries the **annualised growth** since the previous point, matching the owner's "old logs" sheet:
 *
 *     stepGrowth = (curr / prev − 1) × 365 / daysBetween      // simple annualisation, NOT compound
 *
 * Simple (not compound) annualisation is deliberate — it's what the sheet does, so a +₹40k jump over 2
 * days reads as a large annualised swing rather than being compressed. The headline is the compound CAGR
 * across the whole span. No DB, no framework.
 */

/** A raw net-worth point (as stored in SQLite `networth_logs`). */
export interface NetworthLog {
	id?: number;
	/** YYYY-MM-DD */
	asOf: string;
	/** total net worth (INR) */
	value: number;
	source?: "manual" | "computed";
	note?: string;
}

/** A point with its annualised growth vs the previous point resolved. */
export interface NetworthPoint extends NetworthLog {
	/** annualised growth since the previous log; null for the first point (or if not computable) */
	growth: number | null;
	/** whole days since the previous log; null for the first point */
	days: number | null;
}

export interface NetworthSeries {
	/** chronological (oldest → newest) */
	points: NetworthPoint[];
	first: number | null;
	latest: number | null;
	/** absolute change first → latest */
	change: number | null;
	/** compound CAGR first → latest: (last/first)^(365/spanDays) − 1; null when < 2 points or span 0 */
	cagr: number | null;
}

const MS_PER_DAY = 86_400_000;

/** UTC-midnight epoch of a YYYY-MM-DD (date-only maths, so no timezone/DST drift). null if unparseable. */
function dayEpoch(iso: string): number | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
	return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Whole days from `a` to `b` (`b − a`). null if either date is unparseable. */
export function daysBetween(a: string, b: string): number | null {
	const ea = dayEpoch(a);
	const eb = dayEpoch(b);
	if (ea == null || eb == null) return null;
	return Math.round((eb - ea) / MS_PER_DAY);
}

/**
 * Simple annualised growth between two dated values: `(curr/prev − 1) × 365/days`.
 * null when the gap is non-positive or the starting value is zero (rate undefined).
 */
export function stepGrowth(
	prev: { value: number; asOf: string },
	curr: { value: number; asOf: string },
): number | null {
	const days = daysBetween(prev.asOf, curr.asOf);
	if (days == null || days <= 0 || prev.value === 0) return null;
	return (curr.value / prev.value - 1) * (365 / days);
}

/** Build the chronological series with per-step growth + the headline CAGR. Sorts by date ascending. */
export function networthSeries(logs: NetworthLog[]): NetworthSeries {
	const sorted = [...logs].sort((a, b) =>
		a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0,
	);
	const points: NetworthPoint[] = sorted.map((log, i) => {
		const prev = i > 0 ? sorted[i - 1] : undefined;
		return {
			...log,
			growth: prev ? stepGrowth(prev, log) : null,
			days: prev ? daysBetween(prev.asOf, log.asOf) : null,
		};
	});
	const first = sorted[0];
	const last = sorted[sorted.length - 1];
	let cagr: number | null = null;
	if (first && last && first !== last && first.value > 0) {
		const span = daysBetween(first.asOf, last.asOf);
		if (span != null && span > 0) {
			cagr = (last.value / first.value) ** (365 / span) - 1;
		}
	}
	return {
		points,
		first: first?.value ?? null,
		latest: last?.value ?? null,
		change: first && last ? last.value - first.value : null,
		cagr,
	};
}
