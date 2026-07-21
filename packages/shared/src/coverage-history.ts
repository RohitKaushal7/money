/**
 * Calendar helpers for replaying the coverage KPI over time.
 *
 * The Plan holds only current state, so the "trending up" half of the north-star (ADR-0011/0015) is
 * captured as one snapshot per month and re-derived on read. These are the pure date rules that decide
 * *when* a stored month is evaluated — kept here, framework- and database-free, so they can be tested
 * directly (ADR-0007).
 */

/** YYYY-MM for a date. Defaults to the server clock's today. */
export function monthOf(date = new Date()): string {
	return date.toISOString().slice(0, 7);
}

/** Last calendar day of a YYYY-MM, as YYYY-MM-DD. Null if the month string is malformed. */
export function monthEnd(month: string): string | null {
	const parts = month.split("-");
	const y = Number(parts[0]);
	const m = Number(parts[1]);
	if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12)
		return null;
	// Day 0 of the following month is the last day of this one.
	return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * The date a stored month should be evaluated "as of".
 *
 * This matters because `coverageLadder` drops matured holdings via `isLive(inv, today)`. Replaying a past
 * month with *today's* date would retroactively delete every holding that has matured since, making old
 * months look poorer than they were and manufacturing an upward trend out of nothing. So past months are
 * evaluated at their own month-end, and the current month at today — its month-end is still in the future,
 * and a holding maturing later this month is live right now.
 */
export function asOfFor(month: string, today: string): string {
	const end = monthEnd(month);
	if (!end) return today;
	return end < today ? end : today;
}
