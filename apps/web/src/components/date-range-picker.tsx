import { fiscalYearStart } from "@money/shared";
import { useEffect, useRef, useState } from "react";

/**
 * Reusable date-range selector: a preset dropdown (+ inline custom inputs) that resolves to inclusive
 * `YYYY-MM-DD` bounds and emits them via `onChange`. Reused anywhere the app filters by date (Transactions,
 * the net-worth chart). `defaultPreset` picks the initial option; null falls back to the Indian FY.
 */

export type RangePreset =
	| "this-month"
	| "this-quarter"
	| "this-fy"
	| "last-fy"
	| "last-12m"
	| "last-24m"
	| "all"
	| "custom";

export interface DateRange {
	/** inclusive YYYY-MM-DD, or undefined for unbounded */
	from?: string;
	to?: string;
}

const PRESETS: { key: RangePreset; label: string }[] = [
	{ key: "this-month", label: "This month" },
	{ key: "this-quarter", label: "This quarter" },
	{ key: "last-12m", label: "Last 12 months" },
	{ key: "last-24m", label: "Last 24 months" },
	{ key: "this-fy", label: "This FY" },
	{ key: "last-fy", label: "Last FY" },
	{ key: "all", label: "All time" },
	{ key: "custom", label: "Custom range" },
];

const iso = (d: Date) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
		d.getDate(),
	).padStart(2, "0")}`;

/** Resolve a preset (+ optional custom bounds) to inclusive date bounds, using the client clock as "today". */
export function resolveRange(
	preset: RangePreset,
	from?: string,
	to?: string,
): DateRange {
	const now = new Date();
	const y = now.getFullYear();
	const m = now.getMonth(); // 0-based
	switch (preset) {
		case "this-month":
			return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
		case "this-quarter": {
			const qs = Math.floor(m / 3) * 3;
			return { from: iso(new Date(y, qs, 1)), to: iso(new Date(y, qs + 3, 0)) };
		}
		case "this-fy": {
			const fs = fiscalYearStart(y, m + 1);
			return { from: `${fs}-04-01`, to: `${fs + 1}-03-31` };
		}
		case "last-fy": {
			const fs = fiscalYearStart(y, m + 1) - 1;
			return { from: `${fs}-04-01`, to: `${fs + 1}-03-31` };
		}
		case "last-12m":
			return { from: iso(new Date(y - 1, m, now.getDate())), to: iso(now) };
		case "last-24m":
			return { from: iso(new Date(y - 2, m, now.getDate())), to: iso(now) };
		case "all":
			return {};
		case "custom":
			return { from: from || undefined, to: to || undefined };
	}
}

const SELECT_CLASS =
	"h-9 rounded-md border border-input bg-background px-3 pr-8 text-foreground text-sm outline-none focus-visible:border-ring";
const DATE_CLASS =
	"h-9 rounded-md border border-input bg-background px-2 text-foreground text-sm outline-none focus-visible:border-ring";

export function DateRangePicker({
	defaultPreset = null,
	onChange,
}: {
	defaultPreset?: RangePreset | null;
	onChange: (range: DateRange) => void;
}) {
	const [preset, setPreset] = useState<RangePreset>(defaultPreset ?? "this-fy");
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	// keep a stable ref so the emit-effect doesn't depend on the caller's onChange identity
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	useEffect(() => {
		onChangeRef.current(resolveRange(preset, from, to));
	}, [preset, from, to]);

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<select
				value={preset}
				aria-label="Date range"
				onChange={(e) => setPreset(e.target.value as RangePreset)}
				className={SELECT_CLASS}
			>
				{PRESETS.map((p) => (
					<option
						key={p.key}
						value={p.key}
						className="bg-popover text-popover-foreground"
					>
						{p.label}
					</option>
				))}
			</select>
			{preset === "custom" && (
				<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
					<input
						type="date"
						aria-label="From date"
						value={from}
						max={to || undefined}
						onChange={(e) => setFrom(e.target.value)}
						className={DATE_CLASS}
					/>
					<span>→</span>
					<input
						type="date"
						aria-label="To date"
						value={to}
						min={from || undefined}
						onChange={(e) => setTo(e.target.value)}
						className={DATE_CLASS}
					/>
				</div>
			)}
		</div>
	);
}
