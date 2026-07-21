/** INR + number formatting for the dashboard (Indian digit grouping: ₹1,23,456). */

import { useMemo } from "react";
import { usePreference } from "@/lib/preferences";

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

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
	["year", 365 * 24 * 3600e3],
	["month", 30 * 24 * 3600e3],
	["day", 24 * 3600e3],
	["hour", 3600e3],
	["minute", 60e3],
];

/**
 * "3 days ago", "yesterday", "just now" — for timestamps whose exact value doesn't matter, only how long
 * ago. The absolute date belongs in a `title` beside it, for when it does.
 */
export function formatRelativeTime(
	ms: number | null | undefined,
	now = Date.now(),
): string {
	if (ms == null) return "—";
	const delta = ms - now;
	for (const [unit, size] of STEPS) {
		if (Math.abs(delta) >= size) {
			return RELATIVE.format(Math.round(delta / size), unit);
		}
	}
	return "just now";
}

export function formatRatio(ratio: number | null | undefined): string {
	return `${(ratio ?? 0).toFixed(2)}×`;
}

export function formatPct(ratio: number | null | undefined): string {
	return `${Math.round((ratio ?? 0) * 100)}%`;
}

/**
 * Privacy mode: hide the digits without hiding that it's money.
 *
 * Every digit becomes a bullet and everything else survives — the currency symbol, the Indian grouping, a
 * minus sign, a k/L/Cr suffix — so the mask lands in a table column or a chart axis at close to the width
 * of the figure it replaced, and still reads as an amount rather than a rendering bug.
 *
 * Only amounts are masked. Ratios, percentages, month counts and dates stay, because the north-star KPI is
 * exactly what you'd want on screen while showing someone the app, and it says nothing about how much you
 * have.
 */
export function maskDigits(text: string): string {
	return text.replace(/\d/g, "•");
}

/**
 * The amount formatters above, masked while privacy mode is on.
 *
 * Take formatters from here rather than importing them directly: the hook subscribes to the preference, so
 * flipping it re-renders every amount on the page. A direct import is an amount that never hides.
 */
export function useFormat() {
	const [hidden] = usePreference("privacy.hidden");
	return useMemo(
		() =>
			hidden
				? {
						formatINR: (
							value: number | null | undefined,
							opts?: { decimals?: boolean },
						) => maskDigits(formatINR(value, opts)),
						formatCompactINR: (value: number | null | undefined) =>
							maskDigits(formatCompactINR(value)),
					}
				: { formatINR, formatCompactINR },
		[hidden],
	);
}
