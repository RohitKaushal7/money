/**
 * Indian financial year (FY) helpers.
 *
 * The Indian FY runs **1 April – 31 March**. The FY starting on 1 Apr 2025 and ending 31 Mar 2026 is
 * labelled `FY2025-26`.
 *
 * These functions are deliberately timezone-free: they operate on integer `year`/`month` (month is
 * 1-based, 1 = January) or on `YYYY-MM-DD` strings. Bank statements give date-only values, so working on
 * calendar components avoids a late-March IST transaction being mis-bucketed by a UTC conversion.
 *
 * This module is a fixed calendar fact, not part of the (still-undesigned) domain schema — see
 * `docs/decisions/0010-single-user-and-naming.md`.
 */

/** First month of the Indian FY (April), 1-based. */
export const FY_START_MONTH = 4;

/**
 * Start calendar year of the FY containing the given `year` + `month` (month 1–12).
 * e.g. (2026, 2) → 2025 because Feb 2026 falls in FY2025-26.
 */
export function fiscalYearStart(year: number, month: number): number {
	if (!Number.isInteger(month) || month < 1 || month > 12) {
		throw new RangeError(`month out of range (1-12): ${month}`);
	}
	return month >= FY_START_MONTH ? year : year - 1;
}

/** FY label like `FY2025-26` for the FY that starts in `startYear`. */
export function fyLabel(startYear: number): string {
	const endShort = (startYear + 1) % 100;
	return `FY${startYear}-${endShort.toString().padStart(2, "0")}`;
}

/** FY label for a given `year` + `month`. */
export function fyLabelFor(year: number, month: number): string {
	return fyLabel(fiscalYearStart(year, month));
}

/**
 * Inclusive start and **exclusive** end ISO dates for the FY that starts in `startYear`.
 * Exclusive end suits half-open range filters: `txn_date >= start AND txn_date < endExclusive`.
 */
export function fyBounds(startYear: number): {
	start: string;
	endExclusive: string;
} {
	return {
		start: `${startYear}-04-01`,
		endExclusive: `${startYear + 1}-04-01`,
	};
}

/** Parse the leading `YYYY-MM` of an ISO date string into `{ year, month }`. */
export function parseYm(isoDate: string): { year: number; month: number } {
	const match = /^(\d{4})-(\d{2})/.exec(isoDate);
	if (!match) {
		throw new Error(`not an ISO date (expected YYYY-MM-DD): ${isoDate}`);
	}
	return { year: Number(match[1]), month: Number(match[2]) };
}

/** FY label from a `YYYY-MM-DD` string. */
export function fyLabelForDate(isoDate: string): string {
	const { year, month } = parseYm(isoDate);
	return fyLabelFor(year, month);
}
