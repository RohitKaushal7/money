import { toISODate } from "@money/shared";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

const localISO = (d: Date) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * A day's heading in a transaction list: "Today", "Yesterday", "Sat 26 Jul", and the year only when it isn't
 * this one ("Sat 26 Jul 2025"). Relative to the device's own calendar, since "today" is the person's today.
 */
export function dayLabel(iso: string, now = new Date()): string {
	const today = localISO(now);
	const y = new Date(now);
	y.setDate(y.getDate() - 1);
	if (iso === today) return "Today";
	if (iso === localISO(y)) return "Yesterday";
	const [yy, mm, dd] = iso.split("-").map(Number);
	if (!yy || !mm || !dd) return iso;
	// noon, so no timezone offset can tip the weekday into the neighbouring day
	const d = new Date(yy, mm - 1, dd, 12);
	const base = `${WEEKDAY[d.getDay()]} ${dd} ${MONTH[mm - 1]}`;
	return yy === now.getFullYear() ? base : `${base} ${yy}`;
}

/**
 * Consecutive rows of the same day, in the order given (the API already sorts newest first). Consecutive
 * rather than a bucket per day, so a list that isn't sorted by date still reads top to bottom as it came.
 */
export function groupByDay<T extends { date: string }>(
	rows: T[],
	now = new Date(),
): { day: string; label: string; rows: T[] }[] {
	const groups: { day: string; label: string; rows: T[] }[] = [];
	for (const row of rows) {
		const day = toISODate(row.date) ?? row.date;
		const last = groups.at(-1);
		if (last && last.day === day) last.rows.push(row);
		else groups.push({ day, label: dayLabel(day, now), rows: [row] });
	}
	return groups;
}
