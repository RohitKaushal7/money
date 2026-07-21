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

	return (
		<section className="flex flex-col gap-8">
			<div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
				<div className="max-w-xl">
					<p className="flex items-center gap-2 font-medium text-[0.7rem] text-muted-foreground uppercase tracking-[0.22em]">
						Passive-income coverage · monthly
						<TaxModeChip />
					</p>
					<div className="mt-3 flex items-baseline gap-4">
						<span
							className="tnum pointer-events-none font-display font-medium text-[clamp(4.5rem,15vw,10rem)] leading-[0.82] tracking-tight"
							style={{ color: accent }}
						>
							{ratio == null ? "—" : formatRatio(ratio)}
						</span>
						{delta != null && <DeltaChip delta={delta} />}
					</div>

					<CoverageTrend history={history} series={series} accent={accent} />
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

			{/* progress toward 1.0× */}
			<div className="flex flex-col gap-2">
				<div className="relative h-3 overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full transition-[width] duration-700 ease-out"
						style={{ width: `${fill}%`, backgroundColor: accent }}
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
 */
function CoverageTrend({
	history,
	series,
	accent,
}: {
	history: { month: string; ratio: number }[];
	series: number[];
	accent: string;
}) {
	const first = history[0];
	if (series.length < 2) {
		return first ? (
			<p className="mt-4 text-muted-foreground text-xs">
				Tracking since {monthLabel(first.month)} — the trend appears once
				there's a second month.
			</p>
		) : null;
	}
	return (
		<div className="mt-4 flex items-center gap-3">
			<Sparkline points={series} color={accent} />
			<span className="text-muted-foreground text-xs">
				<span className="tnum text-foreground/70">{series.length}</span> months
			</span>
		</div>
	);
}

/**
 * Hand-rolled rather than recharts: at 120×28 a full charting library renders worse and costs more than
 * the eleven lines of path maths it replaces.
 */
function Sparkline({ points, color }: { points: number[]; color: string }) {
	const w = 132;
	const h = 30;
	const pad = 3;
	const min = Math.min(...points);
	const max = Math.max(...points);
	const span = max - min || 1;
	const x = (i: number) =>
		pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
	const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
	const line = points
		.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
		.join(" ");
	const lastX = x(points.length - 1);
	const lastY = y(points[points.length - 1] ?? min);

	return (
		<svg
			width={w}
			height={h}
			viewBox={`0 0 ${w} ${h}`}
			className="overflow-visible"
			role="img"
			aria-label={`Coverage over the last ${points.length} months`}
		>
			<path
				d={`${line} L${lastX.toFixed(1)},${h} L${pad},${h} Z`}
				fill={color}
				opacity={0.1}
			/>
			<path
				d={line}
				fill="none"
				stroke={color}
				strokeWidth={1.5}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<circle cx={lastX} cy={lastY} r={2.5} fill={color} />
		</svg>
	);
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
