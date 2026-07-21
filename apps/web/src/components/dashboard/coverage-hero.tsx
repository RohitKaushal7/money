import { useEffect, useState } from "react";
import { TaxModeChip } from "@/components/tax-mode-chip";
import { useMoney } from "@/lib/currency";
import { formatPct, formatRatio } from "@/lib/format";

interface CoverageHeroProps {
	/** expected monthly passive income (the total-tier ladder numerator; ADR-0015) */
	interest: number;
	/** expected monthly recurring expenses */
	expenses: number;
	/** passiveIncome / expenses; null when there are no recurring expenses yet */
	ratio: number | null;
	/** captured months, oldest first — the "trending up" half of the KPI */
	history?: { month: string; ratio: number }[];
}

/**
 * The north-star KPI (ADR-0011 revised) as the emotional centerpiece: what fraction of your recurring
 * expenses your expected passive income covers, and how far from "1.0× = free". Plan-driven and monthly —
 * both sides come from the Plan, not the noisy statement. Green when covered, warm amber while not.
 */
export function CoverageHero({
	interest,
	expenses,
	ratio,
	history = [],
}: CoverageHeroProps) {
	const m = useMoney();
	const passive = interest;
	const covered = ratio != null && ratio >= 1;
	const gap = Math.max(0, expenses - passive);
	const fill = ratio == null ? 1.5 : Math.max(1.5, Math.min(100, ratio * 100));
	const accent = covered ? "var(--covered)" : "var(--uncovered)";

	// Month-over-month movement. One captured month can't show a direction, so we say so rather than
	// drawing a flat line that implies "no change" when it means "no history yet".
	const series = history.map((h) => h.ratio);
	const last = series.at(-1);
	const prev = series.at(-2);
	const delta = last != null && prev != null ? last - prev : null;

	// The bar is width-driven, so React's first paint would land it at its final size with nothing to
	// transition from — the existing `transition-[width]` never fired. Paint at zero, then flip on the
	// next frame. Keeping it a transition (rather than a keyframe) means later changes to the ratio —
	// toggling post-tax, say — still animate instead of jumping.
	const [grown, setGrown] = useState(false);
	useEffect(() => {
		const id = requestAnimationFrame(() => setGrown(true));
		return () => cancelAnimationFrame(id);
	}, []);

	return (
		<section className="flex flex-col gap-8">
			<div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end lg:gap-12">
				<div className="max-w-xl shrink-0">
					<p className="flex items-center gap-2 font-medium text-[0.7rem] text-muted-foreground uppercase tracking-[0.22em]">
						Passive-income coverage · monthly
						<TaxModeChip />
					</p>
					<div className="mt-3">
						<span
							className="tnum pointer-events-none font-display font-medium text-[clamp(4.5rem,15vw,10rem)] leading-[0.82] tracking-tight"
							style={{ color: accent }}
						>
							{ratio == null ? "—" : formatRatio(ratio)}
						</span>
					</div>

					<p className="mt-5 max-w-md text-foreground/80 text-lg leading-snug">
						{ratio == null ? (
							<>Add recurring expenses to complete the ratio.</>
						) : (
							<>
								Passive income covers{" "}
								<span className="font-semibold" style={{ color: accent }}>
									{formatPct(ratio)}
								</span>{" "}
								of your recurring expenses.{" "}
								{covered
									? "You're free — it fully covers your baseline."
									: "Keep growing it toward 1.0×."}
							</>
						)}
					</p>
				</div>

				{/* The trend fills the space beside the numeral, dissolving toward it so the two read as one
				    composition rather than a figure sitting next to a widget. */}
				<div className="flex min-w-0 flex-1 flex-col justify-end gap-7">
					<CoverageTrend history={history} accent={accent} delta={delta} />
					<dl className="grid grid-cols-3 gap-x-8 gap-y-1 lg:text-right">
						<Stat label="Passive / mo" value={m.fmt(passive)} tone="covered" />
						<Stat label="Expenses / mo" value={m.fmt(expenses)} />
						<Stat
							label="Gap to freedom"
							value={m.fmt(gap)}
							tone={covered ? "covered" : "uncovered"}
						/>
					</dl>
				</div>
			</div>

			{/* progress toward 1.0× */}
			<div className="flex flex-col gap-2">
				<div className="relative h-3 overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full transition-[width] duration-1000 ease-out motion-reduce:transition-none"
						style={{ width: `${grown ? fill : 0}%`, backgroundColor: accent }}
					/>
				</div>
				<div className="flex items-center justify-between text-muted-foreground text-xs">
					<span>now · {ratio == null ? "—" : formatRatio(ratio)}</span>
					<span className="font-medium text-foreground/70">
						1.0× — passive income covers everything
					</span>
				</div>
			</div>
		</section>
	);
}

/** "2026-07" → "Jul 2026". */
function monthLabel(month: string): string {
	const [y, m] = month.split("-");
	const i = Number(m) - 1;
	const names = [
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
	return i >= 0 && i < 12 ? `${names[i]} ${y}` : month;
}

/**
 * The trend, or an honest admission that there isn't one yet. History is captured going forward only —
 * the plan never stored past state — so the first month has nothing to compare against.
 *
 * **Scaled to 1.0×, never to itself.** A sparkline that autoscales to its own min/max makes a series
 * running 0.48→0.72 fill the full height and read as "topped out", directly contradicting the numeral and
 * the progress bar beside it. The domain always reaches 1.0 so the curve's distance from the dashed line
 * IS the remaining gap to freedom.
 */
function CoverageTrend({
	history,
	accent,
	delta,
}: {
	history: { month: string; ratio: number }[];
	accent: string;
	delta: number | null;
}) {
	const first = history[0];
	const series = history.map((h) => h.ratio);
	if (series.length < 2) {
		return first ? (
			<p className="text-muted-foreground text-xs lg:text-right">
				Tracking since {monthLabel(first.month)} — the trend appears once
				there's a second month.
			</p>
		) : null;
	}

	// Geometry in a fixed coordinate space, stretched to the container. `preserveAspectRatio="none"` plus
	// non-scaling strokes keeps the line crisp at any width; the end dot is HTML so it stays round.
	const W = 420;
	const H = 128;
	const padY = 10;
	const lo = Math.min(...series);
	const hi = Math.max(1, ...series);
	const span = hi - lo || 1;
	const x = (i: number) => (i * W) / (series.length - 1);
	const y = (v: number) => padY + (1 - (v - lo) / span) * (H - padY * 2);

	const pts = series.map((v, i) => ({ x: x(i), y: y(v) }));
	const line = smoothPath(pts);
	const area = `${line} L${W},${H} L0,${H} Z`;
	const oneY = y(1);
	const lastPct = ((y(series[series.length - 1] ?? lo) / H) * 100).toFixed(2);
	const fade =
		"linear-gradient(to right, transparent 0%, rgba(0,0,0,0.25) 14%, #000 42%)";

	return (
		<figure className="flex flex-col gap-2">
			<div className="relative w-full">
				<svg
					viewBox={`0 0 ${W} ${H}`}
					preserveAspectRatio="none"
					className="kpi-anim-wipe h-28 w-full sm:h-32"
					role="img"
					aria-label={`Coverage over ${series.length} months, from ${formatRatio(series[0] ?? 0)} to ${formatRatio(series[series.length - 1] ?? 0)}`}
					style={{ maskImage: fade, WebkitMaskImage: fade }}
				>
					<defs>
						<linearGradient id="covTrendFill" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stopColor={accent} stopOpacity={0.26} />
							<stop offset="100%" stopColor={accent} stopOpacity={0} />
						</linearGradient>
					</defs>
					{/* 1.0× — the ceiling the curve is reaching for */}
					<line
						x1="0"
						y1={oneY}
						x2={W}
						y2={oneY}
						stroke="var(--muted-foreground)"
						strokeWidth={1}
						strokeDasharray="3 5"
						strokeOpacity={0.45}
						vectorEffect="non-scaling-stroke"
					/>
					<path d={area} fill="url(#covTrendFill)" />
					<path
						d={line}
						fill="none"
						stroke={accent}
						strokeWidth={2}
						strokeLinecap="round"
						strokeLinejoin="round"
						vectorEffect="non-scaling-stroke"
					/>
				</svg>
				<span
					className="kpi-anim-dot pointer-events-none absolute size-2 rounded-full ring-2 ring-background"
					style={{
						right: 0,
						top: `${lastPct}%`,
						transform: "translate(50%, -50%)",
						backgroundColor: accent,
					}}
				/>
			</div>

			<figcaption className="flex items-center justify-between text-muted-foreground text-xs">
				<span>
					{monthLabel(first?.month ?? "")} —{" "}
					<span className="tnum">{series.length}</span> months
				</span>
				<span className="flex items-center gap-2">
					<span className="opacity-70">1.0× ceiling</span>
					{delta != null && <DeltaChip delta={delta} />}
				</span>
			</figcaption>
		</figure>
	);
}

/**
 * Catmull-Rom → cubic bezier. Straight segments across a dozen-plus points read as a jagged wedge once
 * filled; a smoothed curve reads as a trend, which is what this actually is.
 */
function smoothPath(pts: { x: number; y: number }[]): string {
	const p = pts[0];
	if (!p) return "";
	let d = `M${p.x.toFixed(1)},${p.y.toFixed(1)}`;
	const t = 0.2;
	for (let i = 0; i < pts.length - 1; i += 1) {
		const p1 = pts[i];
		const p2 = pts[i + 1];
		if (!p1 || !p2) continue;
		const p0 = pts[i - 1] ?? p1;
		const p3 = pts[i + 2] ?? p2;
		const c1x = p1.x + (p2.x - p0.x) * t;
		const c1y = p1.y + (p2.y - p0.y) * t;
		const c2x = p2.x - (p3.x - p1.x) * t;
		const c2y = p2.y - (p3.y - p1.y) * t;
		d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
	}
	return d;
}

/** Month-over-month change in the ratio. Direction is the point, so the arrow leads. */
function DeltaChip({ delta }: { delta: number }) {
	const flat = Math.abs(delta) < 0.005;
	const up = delta > 0;
	const color = flat
		? "var(--muted-foreground)"
		: up
			? "var(--covered)"
			: "var(--uncovered)";
	return (
		<span
			className="tnum flex items-center gap-1 font-medium text-sm"
			style={{ color }}
			title="Change since last month"
		>
			{flat ? "→" : up ? "▲" : "▼"}
			{flat ? "0.00" : `${up ? "+" : ""}${delta.toFixed(2)}`}
		</span>
	);
}

function Stat({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone?: "covered" | "uncovered";
}) {
	const color =
		tone === "covered"
			? "var(--covered)"
			: tone === "uncovered"
				? "var(--uncovered)"
				: undefined;
	return (
		<div className="flex flex-col lg:items-end">
			<dt className="order-2 text-muted-foreground text-xs">{label}</dt>
			<dd
				className="tnum order-1 font-display font-medium text-2xl"
				style={color ? { color } : undefined}
			>
				{value}
			</dd>
		</div>
	);
}
