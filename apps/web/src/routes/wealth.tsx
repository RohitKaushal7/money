import type { HoldingRollup, WealthSummary } from "@money/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
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

function Distribution({ w }: { w: WealthSummary }) {
	const data = w.rollups.map((r, i) => ({
		name: r.name,
		value: r.value,
		share: r.share,
		color: PALETTE[i % PALETTE.length],
	}));
	return (
		<section className="flex flex-col gap-4">
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
						>
							{data.map((d) => (
								<Cell key={d.name} fill={d.color} />
							))}
						</Pie>
					</PieChart>
				</ResponsiveContainer>
				<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
					<span className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
						Total
					</span>
					<span className="tnum font-display font-medium text-2xl">
						{formatCompactINR(w.totalValue)}
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
		</section>
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
