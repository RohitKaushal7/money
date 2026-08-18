import { usePreference } from "@/lib/preferences";

/**
 * The display period for recurring flows on the Plan page.
 *
 * Everything underneath is stored and computed per-month — this only rescales what's on screen, so a ₹5,000
 * grocery budget can be read as the ₹1,154 it actually costs each week or the ₹60,000 it costs each year.
 * Nothing here touches a stored amount or the coverage ratio, which is a quotient of two flows and so is the
 * same number in every period.
 */
export type Period = "weekly" | "monthly" | "yearly";

/**
 * A week is 1/52 of a year, not 7/30 of a month. Going monthly → weekly is therefore ×12/52 (₹12,000/mo →
 * ₹2,769/wk), which is what a billing cycle actually averages out to — the 7/30 shortcut is off by ~1.5%.
 */
const FACTOR: Record<Period, number> = {
	weekly: 12 / 52,
	monthly: 1,
	yearly: 12,
};
const SUFFIX: Record<Period, string> = {
	weekly: "/wk",
	monthly: "/mo",
	yearly: "/yr",
};
const LABEL: Record<Period, string> = {
	weekly: "Weekly",
	monthly: "Monthly",
	yearly: "Yearly",
};
/** Shortest → longest, wrapping. Cycling forward reads as "zoom out", which is the direction people expect. */
const NEXT: Record<Period, Period> = {
	weekly: "monthly",
	monthly: "yearly",
	yearly: "weekly",
};

export interface PeriodKit {
	period: Period;
	/** advance to the next period (weekly → monthly → yearly → weekly) */
	cycle: () => void;
	/** rescale a per-month amount into the active period */
	scale: (monthly: number) => number;
	/** "/wk" · "/mo" · "/yr" */
	suffix: string;
	/** "Weekly" · "Monthly" · "Yearly" */
	label: string;
}

/**
 * One period for the whole page. Backed by a preference, so every row, header total and tab re-renders
 * together on a cycle and none of them can be showing a different period than its neighbour.
 */
export function usePlanPeriod(): PeriodKit {
	const [period, setPeriod] = usePreference("plan.period");
	return {
		period,
		cycle: () => setPeriod(NEXT[period]),
		scale: (monthly) => monthly * FACTOR[period],
		suffix: SUFFIX[period],
		label: LABEL[period],
	};
}
