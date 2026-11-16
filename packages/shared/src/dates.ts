/**
 * One date format for people, one for storage.
 *
 * Stored and sent over the API as `YYYY-MM-DD`: it sorts as text and compares as text, which every
 * maturity check and range filter relies on. Shown and typed as `DD-MM-YYYY`, the way the owner reads a
 * date. Nothing else is shown or stored.
 */

const ISO_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;
/** Day-first, any of `-` `/` `.` between the parts: `15-11-2026`, `5/1/2027`, `15.11.2026`. */
const DAY_FIRST = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/;
/** Eight digits typed with no separators, read day-first: `15112026`. */
const DAY_FIRST_COMPACT = /^(\d{2})(\d{2})(\d{4})$/;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** A real calendar day as `YYYY-MM-DD`, or null — rejects 31-02, month 13, day 0. */
function isoOf(y: number, m: number, d: number): string | null {
	if (m < 1 || m > 12 || d < 1) return null;
	const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
	if (d > days) return null;
	return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/**
 * Normalise a date string to `YYYY-MM-DD`. Accepts the stored form (`YYYY-MM-DD`, also the date part of
 * an ISO timestamp) and the day-first forms people type (`DD-MM-YYYY`, `DD/MM/YYYY`, `DD.MM.YYYY`,
 * `DDMMYYYY`). Day-first always: this app is Indian, so `07/06/2027` is 7 June. Null when it isn't a
 * real calendar day.
 */
export function toISODate(s: string | null | undefined): string | null {
	if (!s) return null;
	const t = s.trim();
	const iso = ISO_PREFIX.exec(t);
	if (iso) return isoOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));
	const dmy = DAY_FIRST.exec(t) ?? DAY_FIRST_COMPACT.exec(t);
	if (dmy) return isoOf(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
	return null;
}

/** True for a stored-form date: exactly `YYYY-MM-DD`, and a real day. */
export function isISODate(s: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(s) && toISODate(s) === s;
}

/**
 * Any date the app holds, as `DD-MM-YYYY`.
 *
 * A date-only string is read as written, never through the timezone (`2026-11-15` is the 15th wherever
 * you are). A timestamp — a `Date`, epoch milliseconds, or an ISO string with a time — is a moment, so it
 * shows as the day it was where you are. Empty for nothing; an unreadable string comes back unchanged so
 * a bad value is visible rather than silently blank.
 */
export function formatDate(
	value: string | number | Date | null | undefined,
): string {
	if (value == null || value === "") return "";
	if (typeof value === "string") {
		const t = value.trim();
		if (!/[T ]\d{2}:\d{2}/.test(t)) {
			const iso = toISODate(t);
			if (!iso) return value;
			return `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
		}
	}
	const d = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(d.getTime())) return String(value);
	return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** Today on the device clock, as `YYYY-MM-DD` (local day, not UTC). */
export function todayISODate(now = new Date()): string {
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
