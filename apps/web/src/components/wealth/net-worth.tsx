import {
	type NetworthPoint,
	type NetworthSeries,
	networthSeries,
} from "@money/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, TrendingDown, TrendingUp, X } from "lucide-react";
import { useState } from "react";
import {
	Area,
	Bar,
	Cell,
	ComposedChart,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import {
	type DateRange,
	DateRangePicker,
} from "@/components/date-range-picker";
import { useMoney } from "@/lib/currency";
import { orpc } from "@/utils/orpc";

const COVERED = "var(--covered)";
const UNCOVERED = "var(--uncovered)";

/** signed one-decimal percent, e.g. +10.5% / −35.1% */
function signedPct(r: number | null | undefined): string {
	if (r == null) return "—";
	const v = r * 100;
	return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
}

/** "2024-01-05" → "5 Jan '24" */
function fmtDate(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleDateString("en-GB", {
		day: "numeric",
		month: "short",
		year: "2-digit",
	});
}
/** compact axis label "Jan '24" */
function fmtAxis(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

export function NetWorthOverTime() {
	const q = useQuery(orpc.networth.list.queryOptions());
	const m = useMoney();
	const [range, setRange] = useState<DateRange>({});
	const s = q.data as NetworthSeries | undefined;

	if (q.isLoading) {
		return <div className="h-72 animate-pulse rounded-2xl bg-muted/40" />;
	}
	if (!s || s.points.length === 0) {
		return <EmptyNetWorth />;
	}

	// filter to the selected range and recompute growth/CAGR so the whole card reflects the window
	const inRange = (p: NetworthPoint) =>
		(!range.from || p.asOf >= range.from) && (!range.to || p.asOf <= range.to);
	const view = networthSeries(
		s.points.filter(inRange).map((p) => ({
			id: p.id,
			asOf: p.asOf,
			value: p.value,
			source: p.source,
			note: p.note,
		})),
	);
	const hasPoints = view.points.length > 0;
	const up = (view.cagr ?? 0) >= 0;
	const accent = up ? COVERED : UNCOVERED;

	return (
		<section className="flex flex-col gap-6">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
						Net worth over time
					</p>
					<div className="mt-1 flex items-baseline gap-3">
						<span className="tnum font-display font-medium text-4xl leading-none">
							{m.fmt(view.latest ?? 0)}
						</span>
						{view.cagr != null && (
							<span
								className="flex items-center gap-1 font-medium text-sm"
								style={{ color: accent }}
							>
								{up ? (
									<TrendingUp className="size-4" />
								) : (
									<TrendingDown className="size-4" />
								)}
								{signedPct(view.cagr)}
								<span className="text-muted-foreground text-xs">/yr</span>
							</span>
						)}
					</div>
					{view.change != null && view.first != null && (
						<p className="mt-1 text-muted-foreground text-sm">
							<span className="tnum text-foreground/70">
								{view.change >= 0 ? "+" : "−"}
								{m.fmtc(Math.abs(view.change))}
							</span>{" "}
							since {fmtDate(view.points[0]?.asOf ?? "")} · compounded annually
						</p>
					)}
				</div>
				<div className="flex flex-col items-end gap-2">
					<Controls />
					<DateRangePicker defaultPreset="last-12m" onChange={setRange} />
				</div>
			</div>

			{hasPoints ? (
				<>
					<NetWorthChart points={view.points} />
					<NetWorthLog points={view.points} />
				</>
			) : (
				<p className="rounded-xl border border-border border-dashed px-6 py-10 text-center text-muted-foreground text-sm">
					No net-worth entries in this range.
				</p>
			)}
		</section>
	);
}

type ChartDatum = {
	asOf: string;
	/** epoch ms — the x position, so spacing is proportional to real elapsed time */
	t: number;
	value: number;
	growthPct: number | null;
};

function NetWorthChart({ points }: { points: NetworthPoint[] }) {
	const m = useMoney();
	const data: ChartDatum[] = points.map((p) => ({
		asOf: p.asOf,
		t: new Date(p.asOf).getTime(),
		value: p.value,
		growthPct: p.growth == null ? null : p.growth * 100,
	}));

	return (
		<div className="h-72 w-full">
			<ResponsiveContainer width="100%" height="100%">
				<ComposedChart
					data={data}
					margin={{ top: 8, right: 8, bottom: 4, left: 8 }}
				>
					<defs>
						<linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stopColor={COVERED} stopOpacity={0.28} />
							<stop offset="100%" stopColor={COVERED} stopOpacity={0.02} />
						</linearGradient>
					</defs>
					<XAxis
						dataKey="t"
						type="number"
						scale="time"
						domain={["dataMin", "dataMax"]}
						tickFormatter={(v: number) => fmtAxis(new Date(v).toISOString())}
						tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
						tickLine={false}
						axisLine={{ stroke: "var(--border)" }}
						minTickGap={40}
					/>
					<YAxis
						yAxisId="value"
						tickFormatter={(v: number) => m.fmtc(v)}
						tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
						tickLine={false}
						axisLine={false}
						width={52}
						domain={[0, "dataMax"]}
					/>
					<YAxis
						yAxisId="growth"
						orientation="right"
						tickFormatter={(v: number) => `${Math.round(v)}%`}
						tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
						tickLine={false}
						axisLine={false}
						width={40}
					/>
					<ReferenceLine yAxisId="growth" y={0} stroke="var(--border)" />
					<Tooltip
						cursor={{ stroke: "var(--border)" }}
						isAnimationActive={false}
						content={<NetWorthTip fmt={m.fmt} />}
					/>
					<Bar yAxisId="growth" dataKey="growthPct" barSize={14} radius={2}>
						{data.map((d) => (
							<Cell
								key={d.asOf}
								fill={(d.growthPct ?? 0) >= 0 ? COVERED : UNCOVERED}
								fillOpacity={0.55}
							/>
						))}
					</Bar>
					<Area
						yAxisId="value"
						type="monotone"
						dataKey="value"
						stroke={COVERED}
						strokeWidth={2}
						fill="url(#nwFill)"
						isAnimationActive={false}
						dot={false}
						activeDot={{ r: 4, fill: COVERED }}
					/>
				</ComposedChart>
			</ResponsiveContainer>
		</div>
	);
}

function NetWorthTip({
	active,
	payload,
	fmt,
}: {
	active?: boolean;
	payload?: { payload: ChartDatum }[];
	fmt: (inr: number) => string;
}) {
	if (!active || !payload?.length) return null;
	const d = payload[0]?.payload;
	if (!d) return null;
	const up = (d.growthPct ?? 0) >= 0;
	return (
		<div className="rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md">
			<p className="font-medium text-sm">{fmtDate(d.asOf)}</p>
			<p className="tnum mt-0.5 text-sm">{fmt(d.value)}</p>
			{d.growthPct != null && (
				<p className="tnum text-xs" style={{ color: up ? COVERED : UNCOVERED }}>
					{signedPct(d.growthPct / 100)} annualised
				</p>
			)}
		</div>
	);
}

function NetWorthLog({ points }: { points: NetworthPoint[] }) {
	const qc = useQueryClient();
	const m = useMoney();
	const remove = useMutation({
		...orpc.networth.remove.mutationOptions(),
		onSuccess: () => qc.invalidateQueries(),
	});
	// newest first — a log reads top-down from "now"
	const rows = [...points].reverse();

	return (
		<div className="overflow-hidden rounded-xl border border-border">
			<div className="grid grid-cols-[1fr_auto_auto_2rem] items-center gap-3 border-border border-b bg-muted/30 px-4 py-2 text-[0.65rem] text-muted-foreground uppercase tracking-[0.15em]">
				<span>Date</span>
				<span className="text-right">Value</span>
				<span className="w-20 text-right">Growth /yr</span>
				<span />
			</div>
			<ul className="max-h-80 divide-y divide-border overflow-y-auto">
				{rows.map((p) => {
					const up = (p.growth ?? 0) >= 0;
					return (
						<li
							key={p.asOf}
							className="group grid grid-cols-[1fr_auto_auto_2rem] items-center gap-3 px-4 py-2.5 text-sm hover:bg-secondary/20"
						>
							<span className="flex items-center gap-2">
								{fmtDate(p.asOf)}
								{p.source === "computed" && (
									<span className="rounded bg-muted px-1.5 py-0.5 text-[0.6rem] text-muted-foreground">
										auto
									</span>
								)}
							</span>
							<span className="tnum text-right">{m.fmt(p.value)}</span>
							<span
								className="tnum w-20 text-right"
								style={{
									color:
										p.growth == null
											? "var(--muted-foreground)"
											: up
												? COVERED
												: UNCOVERED,
								}}
							>
								{p.growth == null ? "—" : signedPct(p.growth)}
							</span>
							<button
								type="button"
								aria-label={`Delete ${fmtDate(p.asOf)}`}
								onClick={() => p.id != null && remove.mutate({ id: p.id })}
								className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-[var(--uncovered)] group-hover:opacity-100"
							>
								<X className="size-3.5" />
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function Controls() {
	const qc = useQueryClient();
	const invalidate = () => qc.invalidateQueries();
	const [open, setOpen] = useState(false);
	const [date, setDate] = useState("");
	const [value, setValue] = useState("");

	const logToday = useMutation({
		...orpc.networth.logToday.mutationOptions(),
		onSuccess: invalidate,
	});
	const add = useMutation({
		...orpc.networth.add.mutationOptions(),
		onSuccess: () => {
			invalidate();
			setOpen(false);
			setDate("");
			setValue("");
		},
	});

	const submit = () => {
		const v = Number(value.replace(/,/g, ""));
		if (!date || !Number.isFinite(v) || v < 0) return;
		add.mutate({ asOf: date, value: v });
	};

	return (
		<div className="flex flex-col items-end gap-2">
			<div className="flex gap-2">
				<button
					type="button"
					onClick={() => logToday.mutate(undefined)}
					disabled={logToday.isPending}
					className="rounded-full border border-border px-3.5 py-1.5 font-medium text-xs transition-colors hover:bg-secondary disabled:opacity-50"
				>
					{logToday.isPending ? "Logging…" : "Log today"}
				</button>
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					className="flex items-center gap-1 rounded-full border border-border px-3.5 py-1.5 font-medium text-xs transition-colors hover:bg-secondary"
				>
					<Plus className="size-3.5" /> Add entry
				</button>
			</div>
			{open && (
				<div className="flex items-center gap-2 rounded-lg border border-border bg-card/60 p-2">
					<input
						type="date"
						value={date}
						onChange={(e) => setDate(e.target.value)}
						className="rounded-md border border-border bg-background px-2 py-1 text-sm"
					/>
					<input
						type="text"
						inputMode="numeric"
						placeholder="₹ value"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && submit()}
						className="tnum w-32 rounded-md border border-border bg-background px-2 py-1 text-sm"
					/>
					<button
						type="button"
						onClick={submit}
						disabled={add.isPending}
						className="rounded-md bg-foreground px-3 py-1 font-medium text-background text-sm disabled:opacity-50"
					>
						Save
					</button>
				</div>
			)}
		</div>
	);
}

function EmptyNetWorth() {
	const qc = useQueryClient();
	const logToday = useMutation({
		...orpc.networth.logToday.mutationOptions(),
		onSuccess: () => qc.invalidateQueries(),
	});
	return (
		<section className="flex flex-col items-start gap-4 rounded-2xl border border-border border-dashed px-8 py-14">
			<p className="font-display font-medium text-xl">No net-worth log yet</p>
			<p className="max-w-md text-muted-foreground text-sm">
				Log a point to start the trend — each new point shows the annualised
				growth since the last. "Log today" captures your cash balance plus every
				holding's current value automatically.
			</p>
			<button
				type="button"
				onClick={() => logToday.mutate(undefined)}
				disabled={logToday.isPending}
				className="rounded-lg bg-foreground px-4 py-2 font-medium text-background text-sm disabled:opacity-50"
			>
				{logToday.isPending ? "Logging…" : "Log today's net worth →"}
			</button>
		</section>
	);
}
