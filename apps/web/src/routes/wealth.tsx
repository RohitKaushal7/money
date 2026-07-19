import type { HoldingRollup, WealthSummary } from "@money/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import {
	Cell,
	Pie,
	PieChart,
	ResponsiveContainer,
	Scatter,
	ScatterChart,
	Tooltip,
	XAxis,
	YAxis,
	ZAxis,
} from "recharts";
import { formatCompactINR, formatINR } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/wealth")({ component: WealthPage });

const PALETTE = [
	"oklch(0.64 0.13 155)", // green
	"oklch(0.72 0.15 90)", // lime-amber
	"oklch(0.74 0.15 66)", // amber
	"oklch(0.67 0.16 45)", // orange
	"oklch(0.60 0.15 28)", // warm red
	"oklch(0.62 0.09 230)", // slate blue
	"oklch(0.66 0.08 190)", // teal
	"oklch(0.58 0.10 305)", // plum
	"oklch(0.70 0.05 80)", // warm grey
];
const pct1 = (r: number | null | undefined) =>
	r == null ? "—" : `${(r * 100).toFixed(1)}%`;

function daysUntil(iso?: string): number | null {
	if (!iso) return null;
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return null;
	return Math.round((t - Date.now()) / 86_400_000);
}

function DonutTip({
	active,
	payload,
}: {
	active?: boolean;
	payload?: {
		payload: {
			name: string;
			value: number;
			share: number;
			rate: number | null;
			monthly: number;
		};
	}[];
}) {
	if (!active || !payload?.length) return null;
	const d = payload[0]?.payload;
	if (!d) return null;
	return (
		<div className="rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md">
			<p className="font-medium text-sm">{d.name}</p>
			<p className="tnum mt-0.5 text-muted-foreground text-xs">
				{formatINR(d.value)} · {Math.round(d.share * 100)}% · {pct1(d.rate)} ·{" "}
				{formatINR(d.monthly)}/mo
			</p>
		</div>
	);
}

function WealthPage() {
	const wealth = useQuery(orpc.plan.wealth.queryOptions());
	const w = wealth.data as WealthSummary | undefined;

	return (
		<main className="h-full overflow-y-auto">
			<div className="mx-auto flex max-w-5xl flex-col gap-10 px-5 py-10 sm:px-8 sm:py-14">
				<header className="flex flex-col gap-1">
					<h1 className="font-display font-medium text-3xl tracking-tight">
						Wealth
					</h1>
					<p className="text-muted-foreground">
						Every rupee you own, where it sits, and what rate it's compounding
						at.
					</p>
				</header>

				{!w || w.totalValue === 0 ? (
					<p className="rounded-2xl border border-border border-dashed px-8 py-16 text-muted-foreground">
						No holdings yet — add them on the{" "}
						<a href="/plan" className="text-foreground underline">
							Plan
						</a>{" "}
						page.
					</p>
				) : (
					<>
						<div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.1fr]">
							<Distribution w={w} />
							<Metrics w={w} />
						</div>
						<Holdings rollups={w.rollups} total={w.totalValue} />
					</>
				)}
			</div>
		</main>
	);
}

type Datum = {
	name: string;
	value: number;
	share: number;
	rate: number | null;
	monthly: number;
	color: string;
};
type Tab = "allocation" | "return" | "rose" | "spread";
const TABS: [Tab, string][] = [
	["allocation", "Allocation"],
	["return", "By return"],
	["rose", "Rose"],
	["spread", "Spread"],
];
const BANDS = [
	{ label: "< 7%", lo: -1, hi: 0.07, color: "oklch(0.62 0.16 28)" },
	{ label: "7–10%", lo: 0.07, hi: 0.1, color: "oklch(0.74 0.15 66)" },
	{ label: "10–12%", lo: 0.1, hi: 0.12, color: "oklch(0.78 0.15 125)" },
	{ label: "12%+", lo: 0.12, hi: 99, color: "oklch(0.64 0.14 155)" },
];

function Distribution({ w }: { w: WealthSummary }) {
	const [tab, setTab] = useState<Tab>("allocation");
	const data: Datum[] = w.rollups.map((r, i) => ({
		name: r.name,
		value: r.value,
		share: r.share,
		rate: r.rate,
		monthly: r.monthly,
		color: PALETTE[i % PALETTE.length],
	}));
	return (
		<section className="flex flex-col gap-4">
			<div className="flex gap-1 rounded-lg bg-muted/50 p-1 text-sm">
				{TABS.map(([k, label]) => (
					<button
						key={k}
						type="button"
						onClick={() => setTab(k)}
						className={`flex-1 rounded-md px-2 py-1 transition-colors ${tab === k ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
					>
						{label}
					</button>
				))}
			</div>
			{tab === "allocation" && (
				<AllocationView data={data} total={w.totalValue} />
			)}
			{tab === "return" && <ReturnBands data={data} total={w.totalValue} />}
			{tab === "rose" && <RoseView data={data} total={w.totalValue} />}
			{tab === "spread" && <SpreadView data={data} />}
		</section>
	);
}

function AllocationView({ data, total }: { data: Datum[]; total: number }) {
	return (
		<>
			<div className="relative mx-auto h-64 w-full max-w-sm">
				<ResponsiveContainer width="100%" height="100%">
					<PieChart>
						<Pie
							data={data}
							dataKey="value"
							nameKey="name"
							innerRadius="66%"
							outerRadius="100%"
							paddingAngle={1.5}
							stroke="none"
							isAnimationActive={false}
						>
							{data.map((d) => (
								<Cell key={d.name} fill={d.color} />
							))}
						</Pie>
						<Tooltip
							cursor={false}
							isAnimationActive={false}
							content={<DonutTip />}
						/>
					</PieChart>
				</ResponsiveContainer>
				<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
					<span className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
						Total
					</span>
					<span className="tnum font-display font-medium text-2xl">
						{formatCompactINR(total)}
					</span>
				</div>
			</div>
			<ul className="flex flex-col gap-1.5">
				{data.map((d) => (
					<li key={d.name} className="flex items-center gap-2.5 text-sm">
						<span
							className="size-2.5 shrink-0 rounded-full"
							style={{ backgroundColor: d.color }}
						/>
						<span className="min-w-0 flex-1 truncate">{d.name}</span>
						<span className="tnum text-muted-foreground text-xs">
							{Math.round(d.share * 100)}%
						</span>
						<span className="tnum w-24 text-right font-medium">
							{formatINR(d.value)}
						</span>
					</li>
				))}
			</ul>
		</>
	);
}

function ReturnBands({ data, total }: { data: Datum[]; total: number }) {
	const bands = BANDS.map((b) => {
		const items = data.filter(
			(d) => d.rate != null && d.rate >= b.lo && d.rate < b.hi,
		);
		const value = items.reduce((s, d) => s + d.value, 0);
		return { ...b, value, share: total > 0 ? value / total : 0, items };
	}).filter((b) => b.value > 0);
	return (
		<div className="flex flex-col gap-4 py-4">
			<div className="flex h-7 w-full overflow-hidden rounded-md">
				{bands.map((b) => (
					<div
						key={b.label}
						style={{ width: `${b.share * 100}%`, backgroundColor: b.color }}
						title={`${b.label}: ${Math.round(b.share * 100)}%`}
					/>
				))}
			</div>
			<ul className="flex flex-col gap-2.5">
				{bands.map((b) => (
					<li key={b.label} className="flex items-baseline gap-3">
						<span
							className="size-2.5 shrink-0 translate-y-0.5 rounded-full"
							style={{ backgroundColor: b.color }}
						/>
						<span className="w-14 shrink-0 font-medium text-sm">{b.label}</span>
						<span className="tnum w-9 shrink-0 text-muted-foreground text-sm">
							{Math.round(b.share * 100)}%
						</span>
						<span className="tnum w-24 shrink-0 text-sm">
							{formatINR(b.value)}
						</span>
						<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
							{b.items.map((i) => i.name).join(" · ")}
						</span>
					</li>
				))}
			</ul>
			<p className="text-muted-foreground text-xs">
				Red = lower return, green = higher — how much of your wealth sits at
				each return level.
			</p>
		</div>
	);
}

function polar(cx: number, cy: number, r: number, a: number): [number, number] {
	return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function annularPath(
	cx: number,
	cy: number,
	rIn: number,
	rOut: number,
	a0: number,
	a1: number,
): string {
	const large = a1 - a0 > Math.PI ? 1 : 0;
	const [x0, y0] = polar(cx, cy, rIn, a0);
	const [x1, y1] = polar(cx, cy, rOut, a0);
	const [x2, y2] = polar(cx, cy, rOut, a1);
	const [x3, y3] = polar(cx, cy, rIn, a1);
	return `M ${x0} ${y0} L ${x1} ${y1} A ${rOut} ${rOut} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rIn} ${rIn} 0 ${large} 0 ${x0} ${y0} Z`;
}

function RoseView({ data, total }: { data: Datum[]; total: number }) {
	const [active, setActive] = useState<number | null>(null);
	const size = 264;
	const cx = size / 2;
	const cy = size / 2;
	const innerR = 60;
	const minOuter = 66;
	const maxOuter = 124;
	const maxRate = Math.max(0.0001, ...data.map((d) => d.rate ?? 0));
	let a = -Math.PI / 2;
	const segs = data.map((d, i) => {
		const span = total > 0 ? (d.value / total) * Math.PI * 2 : 0;
		const a0 = a;
		const a1 = a + span;
		a = a1;
		const outerR = minOuter + ((d.rate ?? 0) / maxRate) * (maxOuter - minOuter);
		return { d, i, path: annularPath(cx, cy, innerR, outerR, a0, a1) };
	});
	const act = active != null ? data[active] : null;
	return (
		<div className="flex flex-col gap-3">
			<div className="relative mx-auto" style={{ width: size, height: size }}>
				<svg
					width={size}
					height={size}
					viewBox={`0 0 ${size} ${size}`}
					role="img"
					aria-label="wealth by value and return"
				>
					<title>Wealth by value (angle) and return (reach)</title>
					{segs.map((s) => (
						<path
							key={s.d.name}
							d={s.path}
							fill={s.d.color}
							stroke="var(--background)"
							strokeWidth={1.5}
							opacity={active == null || active === s.i ? 1 : 0.35}
							onMouseEnter={() => setActive(s.i)}
							onMouseLeave={() => setActive(null)}
						/>
					))}
				</svg>
				<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
					{act ? (
						<>
							<span className="max-w-[7rem] truncate font-medium text-sm">
								{act.name}
							</span>
							<span className="tnum font-display font-medium text-lg">
								{formatCompactINR(act.value)}
							</span>
							<span className="text-muted-foreground text-xs">
								{pct1(act.rate)} · {Math.round(act.share * 100)}%
							</span>
						</>
					) : (
						<>
							<span className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
								Total
							</span>
							<span className="tnum font-display font-medium text-2xl">
								{formatCompactINR(total)}
							</span>
						</>
					)}
				</div>
			</div>
			<p className="text-center text-muted-foreground text-xs">
				Angle = share of wealth · reach = XIRR. Fat-and-short = lots of money at
				low return.
			</p>
		</div>
	);
}

function SpreadView({ data }: { data: Datum[] }) {
	const points = data
		.filter((d) => d.rate != null)
		.map((d) => ({ ...d, ratePct: (d.rate ?? 0) * 100 }));
	return (
		<div className="flex flex-col gap-2">
			<div className="h-64 w-full">
				<ResponsiveContainer width="100%" height="100%">
					<ScatterChart margin={{ top: 12, right: 20, bottom: 16, left: 8 }}>
						<XAxis
							type="number"
							dataKey="ratePct"
							name="XIRR"
							unit="%"
							domain={[0, "dataMax"]}
							tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
							tickLine={false}
							axisLine={{ stroke: "var(--border)" }}
						/>
						<YAxis type="number" dataKey="value" hide domain={[0, "dataMax"]} />
						<ZAxis type="number" dataKey="value" range={[140, 1500]} />
						<Tooltip
							cursor={{ strokeDasharray: "3 3" }}
							isAnimationActive={false}
							content={<DonutTip />}
						/>
						<Scatter data={points}>
							{points.map((p) => (
								<Cell key={p.name} fill={p.color} />
							))}
						</Scatter>
					</ScatterChart>
				</ResponsiveContainer>
			</div>
			<p className="text-center text-muted-foreground text-xs">
				x = XIRR · bubble size + height = amount. Big bubbles on the left are
				lots of money at low return.
			</p>
		</div>
	);
}

function Metrics({ w }: { w: WealthSummary }) {
	const cushion =
		w.avgRoi != null && w.requiredRoi != null ? w.avgRoi - w.requiredRoi : null;
	const free = cushion != null && cushion >= 0;
	return (
		<section className="flex flex-col justify-center gap-6">
			<div>
				<p className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
					Total wealth
				</p>
				<p className="tnum font-display font-medium text-5xl leading-none">
					{formatINR(w.totalValue)}
				</p>
				<p className="mt-1 text-muted-foreground text-sm">
					throwing off{" "}
					<span className="tnum text-foreground/80">
						{formatINR(Math.round(w.annualReturn / 12))}
					</span>{" "}
					/mo
				</p>
			</div>

			<div className="grid grid-cols-2 gap-x-8 gap-y-5">
				<Metric
					label="Avg ROI"
					value={pct1(w.avgRoi)}
					tone={free ? "covered" : undefined}
				/>
				<Metric label="Required to be free" value={pct1(w.requiredRoi)} />
				<Metric
					label="Cushion"
					value={
						cushion == null
							? "—"
							: `${cushion >= 0 ? "+" : ""}${(cushion * 100).toFixed(2)}%`
					}
					tone={free ? "covered" : "uncovered"}
				/>
				<Metric
					label="Years of runway"
					value={w.yearsLeft == null ? "—" : `${w.yearsLeft.toFixed(1)} yr`}
				/>
			</div>

			<p className="text-muted-foreground text-sm leading-snug">
				{free ? (
					<>
						You're earning{" "}
						<span className="font-medium text-[var(--covered)]">
							{pct1(w.avgRoi)}
						</span>{" "}
						vs the <span className="font-medium">{pct1(w.requiredRoi)}</span>{" "}
						you'd need to fully cover expenses — you're past free on a
						total-return basis.
					</>
				) : (
					<>
						You're earning <span className="font-medium">{pct1(w.avgRoi)}</span>
						; you'd need{" "}
						<span className="font-medium text-[var(--uncovered)]">
							{pct1(w.requiredRoi)}
						</span>{" "}
						for wealth alone to cover expenses.
					</>
				)}
			</p>

			{w.maturedValue > 0 && (
				<div className="rounded-lg border border-[var(--uncovered)]/30 bg-[var(--uncovered)]/5 px-4 py-3 text-sm">
					<span className="tnum font-medium text-[var(--uncovered)]">
						{formatINR(w.maturedValue)}
					</span>{" "}
					<span className="text-muted-foreground">
						matured and awaiting redeploy — record where it went on the Plan
						page.
					</span>
				</div>
			)}
		</section>
	);
}

function Metric({
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
		<div className="flex flex-col">
			<span className="text-muted-foreground text-xs">{label}</span>
			<span
				className="tnum font-display font-medium text-2xl"
				style={color ? { color } : undefined}
			>
				{value}
			</span>
		</div>
	);
}

function Holdings({
	rollups,
	total,
}: {
	rollups: HoldingRollup[];
	total: number;
}) {
	return (
		<section className="flex flex-col gap-3">
			<h2 className="font-display font-medium text-xl">Holdings</h2>
			<ul className="flex flex-col gap-2">
				{rollups.map((r) => (
					<HoldingCard
						key={r.group ?? r.name}
						rollup={r}
						share={total > 0 ? r.value / total : 0}
					/>
				))}
			</ul>
		</section>
	);
}

function HoldingCard({
	rollup,
	share,
}: {
	rollup: HoldingRollup;
	share: number;
}) {
	const [open, setOpen] = useState(false);
	const grouped = rollup.group != null && rollup.members.length > 1;
	return (
		<li className="overflow-hidden rounded-xl border border-border bg-card/40">
			<button
				type="button"
				onClick={() => grouped && setOpen((o) => !o)}
				className={`flex w-full items-center gap-4 px-5 py-4 text-left ${grouped ? "hover:bg-secondary/30" : "cursor-default"}`}
			>
				{grouped && (
					<ChevronRight
						className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
					/>
				)}
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium">{rollup.name}</p>
					<p className="text-muted-foreground text-xs">
						{grouped
							? `${rollup.members.length} holdings · ${pct1(rollup.rate)} wtd`
							: `${rollup.incomeClass === "growth" ? "growth" : "income"} · ${pct1(rollup.rate)}`}
					</p>
				</div>
				<Stat label="value" value={formatINR(rollup.value)} />
				<Stat label="of wealth" value={`${Math.round(share * 100)}%`} muted />
				<Stat
					label="/mo"
					value={formatINR(rollup.monthly)}
					color="var(--covered)"
				/>
			</button>
			{grouped && open && (
				<ul className="flex flex-col divide-y divide-border border-border border-t">
					{rollup.members.map((m) => {
						const d = daysUntil(m.maturityDate);
						const monthly =
							m.expectedMonthlyInterest ??
							((m.currentValue ?? 0) * (m.annualRate ?? 0)) / 12;
						return (
							<li
								key={m.id}
								className="flex items-center gap-4 px-5 py-2.5 pl-11 text-sm"
							>
								<div className="min-w-0 flex-1">
									<p className="truncate">{m.name}</p>
									{m.maturityDate && (
										<p className="text-muted-foreground text-xs">
											matures {m.maturityDate}
											{d != null && (
												<span
													className={d <= 30 ? "text-[var(--uncovered)]" : ""}
												>
													{" "}
													· {d}d
												</span>
											)}
										</p>
									)}
								</div>
								<span className="tnum w-24 text-right text-muted-foreground">
									{formatINR(m.currentValue ?? 0)}
								</span>
								<span className="tnum w-12 text-right text-muted-foreground">
									{pct1(m.annualRate)}
								</span>
								<span
									className="tnum w-20 text-right"
									style={{ color: "var(--covered)" }}
								>
									{formatINR(monthly)}
								</span>
							</li>
						);
					})}
				</ul>
			)}
		</li>
	);
}

function Stat({
	label,
	value,
	color,
	muted,
}: {
	label: string;
	value: string;
	color?: string;
	muted?: boolean;
}) {
	return (
		<div className="hidden shrink-0 flex-col items-end sm:flex">
			<span
				className={`tnum font-medium ${muted ? "text-muted-foreground" : ""}`}
				style={color ? { color } : undefined}
			>
				{value}
			</span>
			<span className="text-[0.6rem] text-muted-foreground">{label}</span>
		</div>
	);
}
