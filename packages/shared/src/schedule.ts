import { toISODate } from "./plan";
import type { RecurringExpense } from "./types";

/**
 * When a recurring expense next takes money, and how much it has taken so far.
 *
 * `monthlyAmount` answers "what does this cost per month" and is all the coverage KPI needs. This file
 * answers the calendar questions the KPI has no opinion about: what's due next, how soon, and how much has
 * gone out since the first payment. Kept apart from `plan.ts` so the ladder maths stays free of date
 * arithmetic, which is where all the sharp edges are.
 *
 * A start date is optional throughout. Without one there is no schedule, and every function here says so by
 * returning null / 0 rather than guessing — an expense you never dated is not an expense that's overdue.
 */

/** Months between payments. Only the periodic cadences the plan UI offers; others have no schedule. */
const MONTHS_PER_PERIOD: Partial<Record<RecurringExpense["cadence"], number>> =
	{
		monthly: 1,
		quarterly: 3,
		half_yearly: 6,
		yearly: 12,
	};

interface Ymd {
	y: number;
	m: number;
	d: number;
}

function parse(iso: string | undefined): Ymd | null {
	const s = toISODate(iso);
	if (!s) return null;
	const [y, m, d] = s.split("-").map(Number);
	return y && m && d ? { y, m, d } : null;
}

function fmt({ y, m, d }: Ymd): string {
	return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Days in a month, 1-indexed. Handles February by the proleptic Gregorian leap rule. */
function daysInMonth(y: number, m: number): number {
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The anchor date advanced by `n` whole periods, with the day clamped into short months.
 *
 * Computed from the anchor every time rather than by stepping a cursor forward. Repeated addition is what
 * turns a 31 Jan subscription into a 28th-of-the-month subscription the first time it passes February — the
 * day is lost and never comes back. Anchoring means February borrows the 28th and March gets the 31st back.
 */
function addPeriods(anchor: Ymd, months: number, n: number): Ymd {
	const total = anchor.m - 1 + months * n;
	const y = anchor.y + Math.floor(total / 12);
	const m = (total % 12) + 1;
	return { y, m, d: Math.min(anchor.d, daysInMonth(y, m)) };
}

/** Whole days from `from` to `iso` — negative once `iso` is in the past. */
export function daysUntil(iso: string, from: string): number {
	const a = parse(iso);
	const b = parse(from);
	if (!a || !b) return 0;
	return Math.round(
		(Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86_400_000,
	);
}

/** Chronological comparison of two ISO dates — `YYYY-MM-DD` sorts lexicographically, so this is enough. */
function onOrBefore(a: string, b: string): boolean {
	return a <= b;
}

/**
 * The next date this expense takes money, or null when it has no schedule — no start date, a non-periodic
 * cadence, switched off, or already past its end date.
 *
 * A payment falling exactly today counts as due, not missed.
 */
export function nextPayment(
	exp: RecurringExpense,
	today: string,
): string | null {
	const months = MONTHS_PER_PERIOD[exp.cadence];
	const anchor = parse(exp.startDate);
	if (!months || !anchor || exp.active === false) return null;

	// Jump straight to roughly the right period, then correct in both directions: up while the candidate is
	// still in the past, down while the period before it would also do. Day-clamping in short months is why
	// the estimate can be off by one either way, and why this settles it by checking rather than by maths.
	let n = Math.max(0, Math.floor(elapsedMonths(anchor, today) / months));
	while (fmt(addPeriods(anchor, months, n)) < today) n++;
	while (n > 0 && onOrBefore(today, fmt(addPeriods(anchor, months, n - 1))))
		n--;

	const due = fmt(addPeriods(anchor, months, n));
	const end = toISODate(exp.endDate);
	return end != null && due > end ? null : due;
}

/** Whole months from `anchor` to `iso`, ignoring the day-of-month. */
function elapsedMonths(anchor: Ymd, iso: string): number {
	const t = parse(iso);
	if (!t) return 0;
	return (t.y - anchor.y) * 12 + (t.m - anchor.m);
}

/**
 * What this expense has taken since its first payment — `amount × payments so far`, counting the first
 * payment and every one up to and including today (or the end date, whichever comes first).
 *
 * This is an **estimate, and it is the optimistic kind**: it assumes the price never changed and that no
 * payment was ever missed or skipped. A ₹1,500 subscription that was ₹999 for its first two years reports
 * too high, and nothing here can know that. Present it as *committed*, never as *paid* — the app has no
 * evidence any of these payments actually cleared. The honest figure comes from matching real transactions,
 * which needs statement-level attribution the plan side doesn't have.
 */
export function estimatedPaid(exp: RecurringExpense, today: string): number {
	const months = MONTHS_PER_PERIOD[exp.cadence];
	const anchor = parse(exp.startDate);
	if (!months || !anchor) return 0;

	const end = toISODate(exp.endDate);
	// Payments stop at the end date; after that the count is frozen, however long ago it was.
	const until = end != null && end < today ? end : today;
	if (until < fmt(anchor)) return 0;

	let n = Math.max(0, Math.floor(elapsedMonths(anchor, until) / months));
	// Walk back if the clamped day of the nth payment lands after `until`, forward if the floor undershot.
	while (n > 0 && fmt(addPeriods(anchor, months, n)) > until) n--;
	while (fmt(addPeriods(anchor, months, n + 1)) <= until) n++;
	return exp.amount * (n + 1);
}
