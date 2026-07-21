/**
 * Runway — how long the portfolio lasts if the income stops today (ADR-0016).
 *
 * The original `wealthSummary.yearsLeft` was `totalValue / annualExpenses`: money in a mattress. That is
 * the reciprocal of `requiredRoi`, so the wealth page was reporting one fact twice. This models the two
 * forces that actually decide the answer — the balance keeps earning as it drains, and the spending keeps
 * getting more expensive — and both are opt-out, so the naive figure remains reachable rather than lost.
 *
 * Pure and framework-free: the assumptions are user preferences held on the client, and every input is
 * already in the `plan.wealth` payload, so nothing here crosses the wire.
 */

/** The two forces. Either may be 0, which switches that force off; both 0 reproduces the naive division. */
export interface RunwayAssumptions {
	/** blended annual portfolio return (e.g. 0.079). 0 ⇒ the balance does not earn. */
	annualReturn: number;
	/** annual expense inflation (e.g. 0.06). 0 ⇒ today's spending forever. */
	inflation: number;
}

export interface RunwayPoint {
	/** epoch ms — the chart's x axis is a real time scale, not an index */
	t: number;
	/** balance at the end of that month, floored at 0 */
	value: number;
}

export interface RunwayProjection {
	/** monthly, starting at the anchor itself, ending at depletion or the horizon cap */
	points: RunwayPoint[];
	/** years until the balance hits 0; **null means it never does** under these assumptions */
	yearsLeft: number | null;
	/** YYYY-MM-DD of the month the balance runs out; null when it never does */
	depletesOn: string | null;
	/** true when the projection stopped at `capYears` with money still in the account */
	survivesHorizon: boolean;
}

/** Beyond this, "how many years" stops being a number anyone acts on. */
export const RUNWAY_CAP_YEARS = 40;

/**
 * Draw down `startValue` month by month.
 *
 * The order within a month is: earn, then spend. Inflation steps once a year rather than monthly, because
 * that is how spending actually ratchets — rents and premiums reset on an anniversary, not continuously.
 */
export function runwayProjection(input: {
	/** balance to start from — the latest *logged* net worth, so the curve joins the history line */
	startValue: number;
	/** YYYY-MM-DD of that balance */
	startDate: string;
	monthlyExpenses: number;
	assumptions: RunwayAssumptions;
	capYears?: number;
}): RunwayProjection {
	const capYears = input.capYears ?? RUNWAY_CAP_YEARS;
	const capMonths = Math.round(capYears * 12);
	const monthlyRate = input.assumptions.annualReturn / 12;
	const start = new Date(`${input.startDate}T00:00:00Z`);
	const startMs = start.getTime();
	const empty = {
		points: [] as RunwayPoint[],
		yearsLeft: null,
		depletesOn: null,
		survivesHorizon: false,
	};
	if (!Number.isFinite(startMs) || !(input.startValue > 0)) return empty;

	/** `startDate` plus n whole months, preserving the day-of-month where the target month has it. */
	const at = (n: number): Date =>
		new Date(
			Date.UTC(
				start.getUTCFullYear(),
				start.getUTCMonth() + n,
				start.getUTCDate(),
			),
		);

	const points: RunwayPoint[] = [{ t: startMs, value: input.startValue }];
	let balance = input.startValue;
	let spend = input.monthlyExpenses;

	for (let month = 1; month <= capMonths; month += 1) {
		const grown = balance * (1 + monthlyRate);
		balance = grown - spend;
		const date = at(month);

		if (balance <= 0) {
			// Land inside the final month rather than at its end: the balance covers `grown / spend` of that
			// month's spending. Without this, zeroing both assumptions would round up to a whole month and
			// disagree with the naive `totalValue / annualExpenses` it is supposed to reproduce exactly.
			const fraction = spend > 0 ? grown / spend : 0;
			const prev = at(month - 1).getTime();
			points.push({
				t: prev + (date.getTime() - prev) * fraction,
				value: 0,
			});
			return {
				points,
				yearsLeft: (month - 1 + fraction) / 12,
				depletesOn: date.toISOString().slice(0, 10),
				survivesHorizon: false,
			};
		}

		points.push({ t: date.getTime(), value: balance });
		// Anniversary ratchet: month 12 is the first spend at next year's prices.
		if (month % 12 === 0) spend *= 1 + input.assumptions.inflation;
	}

	return { points, yearsLeft: null, depletesOn: null, survivesHorizon: true };
}

/**
 * Just the headline number, for callers that want the metric without the curve.
 *
 * Returns null both when the money never runs out *and* when there is nothing to run out of — the caller
 * has `survivesHorizon` via {@link runwayProjection} if it needs to tell those apart.
 */
export function runwayYears(input: {
	startValue: number;
	startDate: string;
	monthlyExpenses: number;
	assumptions: RunwayAssumptions;
	capYears?: number;
}): number | null {
	return runwayProjection(input).yearsLeft;
}
