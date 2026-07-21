import { type AppDb, coverageSnapshots } from "@money/db";
import {
	asOfFor,
	type CoverageLadder,
	coverageLadder,
	type Investment,
	monthOf,
	netIncomeOfTax,
	type RecurringExpense,
} from "@money/shared";
import { asc, eq } from "drizzle-orm";

/**
 * Coverage history — capture and replay of the north-star KPI over time.
 *
 * The Plan holds only current state, so the "is it trending up?" half of the KPI has nothing to draw
 * until we start recording. We store the monthly *inputs* rather than computed ratios (see the
 * `coverage_snapshots` schema doc for why) and re-derive the series with current code on every read.
 */

/** What a month's row holds: the plan as it stood, INR-normalised and pre-tax. */
export interface PlanSnapshot {
	investments: Investment[];
	recurring: RecurringExpense[];
}

export interface CoveragePoint extends CoverageLadder {
	/** YYYY-MM */
	month: string;
}

/**
 * Upsert the current month's snapshot — but only when the plan actually differs from what is stored.
 *
 * Called from `plan.ladder`, i.e. on read. The equality check is what makes that acceptable: idle page
 * loads do no writing, and a month's row settles at the last state the plan was genuinely in.
 */
export async function captureCoverageSnapshot(
	appDb: AppDb,
	snapshot: PlanSnapshot,
): Promise<void> {
	// Don't accumulate rows of zeros before the user has entered a plan — an empty month is not a data
	// point, it's noise that would drag the trend line down from the origin.
	if (snapshot.investments.length === 0 && snapshot.recurring.length === 0)
		return;

	const month = monthOf();
	const planJson = JSON.stringify(snapshot);

	const [existing] = await appDb
		.select({ planJson: coverageSnapshots.planJson })
		.from(coverageSnapshots)
		.where(eq(coverageSnapshots.month, month))
		.limit(1);
	if (existing?.planJson === planJson) return;

	await appDb
		.insert(coverageSnapshots)
		.values({ month, planJson })
		.onConflictDoUpdate({
			target: coverageSnapshots.month,
			set: { planJson, updatedAt: new Date() },
		});
}

/**
 * Replay every captured month through the *current* `coverageLadder`, so the whole series is comparable
 * even across changes to the KPI definition. The after-tax netting is applied here rather than being
 * frozen into storage, so toggling it re-renders history consistently instead of mixing two modes.
 */
export async function loadCoverageHistory(
	appDb: AppDb,
	opts: { afterTax: boolean; taxRate: number; today: string },
): Promise<CoveragePoint[]> {
	const rows = await appDb
		.select({
			month: coverageSnapshots.month,
			planJson: coverageSnapshots.planJson,
		})
		.from(coverageSnapshots)
		.orderBy(asc(coverageSnapshots.month));

	const points: CoveragePoint[] = [];
	for (const row of rows) {
		let snapshot: PlanSnapshot;
		try {
			snapshot = JSON.parse(row.planJson) as PlanSnapshot;
		} catch {
			// A corrupt row should cost one point, not the whole chart.
			continue;
		}
		const investments = opts.afterTax
			? snapshot.investments.map((i) => netIncomeOfTax(i, opts.taxRate))
			: snapshot.investments;
		points.push({
			month: row.month,
			...coverageLadder({
				investments,
				recurring: snapshot.recurring,
				today: asOfFor(row.month, opts.today),
			}),
		});
	}
	return points;
}
