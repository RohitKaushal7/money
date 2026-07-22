/**
 * Freedom — when the portfolio becomes big enough to never run out (spec 2026-07-22).
 *
 * `runway` answers "how long does this last if income stops today". This answers the question on the other
 * side of it: **how long until it lasts forever**, and what would move that date. Pure and framework-free
 * like the rest of the package; every input is already on the Wealth page.
 *
 * ## Everything here is in today's rupees
 *
 * A perpetual corpus runs on the **real** return, not the nominal one. A portfolio blending 9.1% against 6%
 * inflation grows at 3.3%, and the corpus that sustains spending forever is ~5.6× current wealth rather
 * than ~2×. The target also inflates with spending, so comparing a nominally-growing balance against a
 * frozen target is wrong in the flattering direction — it understated a 15-year saving requirement
 * four-fold during design, and reported "20 years, save nothing" for what is really 53 years.
 *
 * Working in today's rupees removes the trap rather than managing it: one growth rate, one target, no
 * moving goalposts. Contributions are likewise held flat in real terms, which assumes savings rise with
 * inflation the way a salary broadly does — holding them nominally flat would silently shrink them yearly.
 */

import type { RunwayAssumptions } from "./runway";

/** Beyond this the accumulation projection stops; a date past it is not one anyone plans against. */
export const FREEDOM_CAP_YEARS = 120;

/** Minimum log span before an observed saving rate means anything. */
const MIN_SAVING_WINDOW_DAYS = 180;

/**
 * The smallest corpus that never depletes, in today's rupees. `null` when **no finite corpus survives** —
 * the return cannot outrun inflation, so spending overtakes the portfolio no matter how large it starts.
 * That is a real state the Wealth sliders reach trivially (switch returns off), and callers must render it
 * as words rather than printing a very large number.
 *
 * ## Why this is a closed form, and why it is the *model's* closed form
 *
 * `runwayProjection` grows the balance monthly at `r/12` and ratchets spending once a year, so one year is
 * exactly `V' = V·g − S·a`, where `g = (1 + r/12)¹²` and `a = (g − 1)/(r/12)` is the year's twelve spends
 * carried forward at that same growth. Deflating by inflation `i` gives a linear map in today's rupees:
 *
 * ```
 * v' = v·G − c        G = g/(1+i)        c = S·a/(1+i)
 * ```
 *
 * Its fixed point `v* = c/(G − 1)` is the corpus that holds its real value forever — and it exists only
 * when `G > 1`. That inequality *is* the reachability test, which is the whole reason this is not solved
 * numerically: a search over any finite horizon answers "lasts 200 years", not "lasts forever", and with a
 * dead return those differ by an enormous but perfectly finite number.
 *
 * The textbook `W ÷ (r − i)` is a *different* closed form — it assumes one withdrawal a year — and lands
 * ~4% low. This one is derived from the recurrence the Runway view actually draws, so the two views cannot
 * disagree about one portfolio.
 *
 * Callers must guard `monthlyExpenses > 0` first — with nothing to draw down, "never depletes" is vacuous.
 */
export function perpetuityTarget(input: {
	monthlyExpenses: number;
	assumptions: RunwayAssumptions;
}): number | null {
	const { annualReturn, inflation } = input.assumptions;
	if (!(input.monthlyExpenses > 0)) return null;

	const monthlyRate = annualReturn / 12;
	const g = (1 + monthlyRate) ** 12;
	// A dead return still spends twelve times a year; the limit of (g−1)/m as m→0 is 12.
	const a = monthlyRate === 0 ? 12 : (g - 1) / monthlyRate;

	// `G − 1` is exactly the real growth rate, so the reachability test and the curve the projection draws
	// are the same quantity by construction rather than by coincidence.
	const real = realGrowthRate(input.assumptions);
	if (!(real > 0)) return null;

	return (input.monthlyExpenses * a) / (1 + inflation) / real;
}

/** Whole days between two `YYYY-MM-DD` dates. */
function daysBetween(a: string, b: string): number {
	return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}

/**
 * Net new money reaching the portfolio each month, from the net-worth log history.
 *
 * Growth in net worth is contributions **plus** what the balance earned; only the first is saving. Each gap
 * between logs is credited its return and the remainder is treated as contribution:
 *
 * ```
 * contribution = Δvalue − (starting value × annualReturn × days ÷ 365)
 * ```
 *
 * This lands materially below salary-minus-spending — surplus that never reaches the portfolio is exactly
 * what the subtraction is blind to, and this figure sees it.
 *
 * `null` when the history is too thin to extrapolate from: fewer than two logs, or a span under
 * {@link MIN_SAVING_WINDOW_DAYS}. A rate inferred from a fortnight is noise wearing a number's clothes.
 */
export function observedSavingRate(input: {
	logs: { asOf: string; value: number }[];
	annualReturn: number;
}): number | null {
	const logs = [...input.logs].sort((a, b) => (a.asOf < b.asOf ? -1 : 1));
	if (logs.length < 2) return null;

	let contributed = 0;
	let days = 0;
	for (let i = 1; i < logs.length; i += 1) {
		const prev = logs[i - 1];
		const curr = logs[i];
		if (!prev || !curr) continue;
		const gap = daysBetween(prev.asOf, curr.asOf);
		if (!(gap > 0)) continue; // same-day corrections carry no time, so no return accrues
		const earned = prev.value * input.annualReturn * (gap / 365);
		contributed += curr.value - prev.value - earned;
		days += gap;
	}
	if (days < MIN_SAVING_WINDOW_DAYS) return null;
	return contributed / (days / 365) / 12;
}

export interface FreedomPoint {
	/** epoch ms — the chart's x axis is a real time scale, not an index */
	t: number;
	/** balance in **today's rupees** at the end of that month */
	value: number;
}

export interface FreedomProjection {
	/** monthly, starting at the anchor itself, ending at the crossing or the horizon cap */
	points: FreedomPoint[];
	/** years until the target is reached; **null means not within the cap** */
	yearsToTarget: number | null;
	/** YYYY-MM-DD of the crossing; null when it never crosses */
	freeOn: string | null;
	/** `startValue / target`, so 1 means already free. Uncapped — it may exceed 1. */
	progress: number;
	/** the real (after-inflation) annual growth rate the curve is drawn at */
	realRate: number;
}

/**
 * Real annual growth: nominal compounded monthly, then deflated.
 *
 * `runwayProjection` compounds at `annualReturn / 12` monthly, so the effective annual rate is slightly
 * above the nominal one. Deriving from the effective rate — not the nominal — is what keeps the two views
 * consistent about the same portfolio.
 */
export function realGrowthRate(assumptions: RunwayAssumptions): number {
	const effective = (1 + assumptions.annualReturn / 12) ** 12 - 1;
	return (1 + effective) / (1 + assumptions.inflation) - 1;
}

/**
 * Accumulate toward `target`: the balance compounds at the real rate while a real monthly contribution is
 * added. The order within a month is grow, then contribute — the month's saving has not been invested yet
 * when the month's return is credited.
 */
export function freedomProjection(input: {
	/** the latest **logged** net worth, so the curve continues the history line */
	startValue: number;
	/** YYYY-MM-DD of that balance */
	startDate: string;
	/** net new money per month, in today's rupees */
	monthlyContribution: number;
	target: number;
	assumptions: RunwayAssumptions;
	capYears?: number;
}): FreedomProjection {
	const capMonths = Math.round((input.capYears ?? FREEDOM_CAP_YEARS) * 12);
	const realRate = realGrowthRate(input.assumptions);
	const monthlyRate = (1 + realRate) ** (1 / 12) - 1;
	const start = new Date(`${input.startDate}T00:00:00Z`);
	const startMs = start.getTime();
	const progress = input.target > 0 ? input.startValue / input.target : 0;
	const empty: FreedomProjection = {
		points: [],
		yearsToTarget: null,
		freeOn: null,
		progress,
		realRate,
	};
	if (!Number.isFinite(startMs) || !(input.target > 0)) return empty;

	const at = (n: number): Date =>
		new Date(
			Date.UTC(
				start.getUTCFullYear(),
				start.getUTCMonth() + n,
				start.getUTCDate(),
			),
		);

	// Already there: freedom is today, not a month away.
	if (input.startValue >= input.target) {
		return {
			points: [{ t: startMs, value: input.startValue }],
			yearsToTarget: 0,
			freeOn: input.startDate,
			progress,
			realRate,
		};
	}

	const points: FreedomPoint[] = [{ t: startMs, value: input.startValue }];
	let balance = input.startValue;

	for (let month = 1; month <= capMonths; month += 1) {
		const before = balance;
		balance = balance * (1 + monthlyRate) + input.monthlyContribution;
		const date = at(month);

		if (balance >= input.target) {
			// Land inside the crossing month rather than at its end, so the reported figure is a smooth
			// function of the inputs instead of stepping a whole month at a time.
			const gained = balance - before;
			const fraction = gained > 0 ? (input.target - before) / gained : 0;
			// The point itself stays on the month grid — the curve should visibly cross the target line
			// rather than stop exactly on it. Only the reported figure is interpolated.
			points.push({ t: date.getTime(), value: balance });
			return {
				points,
				yearsToTarget: (month - 1 + fraction) / 12,
				freeOn: date.toISOString().slice(0, 10),
				progress,
				realRate,
			};
		}

		points.push({ t: date.getTime(), value: balance });
		// A non-positive real rate with no contribution can never close the gap; stop rather than grinding
		// out a century of identical points.
		if (input.monthlyContribution <= 0 && monthlyRate <= 0) break;
	}

	return { points, yearsToTarget: null, freeOn: null, progress, realRate };
}
