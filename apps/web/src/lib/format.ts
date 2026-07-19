/** INR + number formatting for the dashboard (Indian digit grouping: ₹1,23,456). */

const inr0 = new Intl.NumberFormat("en-IN", {
	style: "currency",
	currency: "INR",
	maximumFractionDigits: 0,
});

const inr2 = new Intl.NumberFormat("en-IN", {
	style: "currency",
	currency: "INR",
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

export function formatINR(
	value: number | null | undefined,
	opts?: { decimals?: boolean },
): string {
	return (opts?.decimals ? inr2 : inr0).format(value ?? 0);
}

/** Compact INR for axes/labels: ₹1.2L, ₹3.4Cr, ₹5.6k. */
export function formatCompactINR(value: number | null | undefined): string {
	const n = value ?? 0;
	const abs = Math.abs(n);
	if (abs >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
	if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
	if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
	return `₹${Math.round(n)}`;
}

/** "2026-04" → "Apr '26". */
export function formatMonth(ym: string): string {
	const [year, month] = ym.split("-");
	const date = new Date(Number(year), Number(month) - 1, 1);
	return `${date.toLocaleDateString("en-US", { month: "short" })} '${(year ?? "").slice(2)}`;
}

/** "2026-04-01T…" or "2026-04-01" → "1 Apr". */
export function formatDay(iso: string): string {
	const date = new Date(iso);
	return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function formatRatio(ratio: number | null | undefined): string {
	return `${(ratio ?? 0).toFixed(2)}×`;
}

export function formatPct(ratio: number | null | undefined): string {
	return `${Math.round((ratio ?? 0) * 100)}%`;
}
