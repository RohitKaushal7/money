import {
	type NetworthPoint,
	RUNWAY_CAP_YEARS,
	runwayProjection,
	type WealthSummary,
} from "@money/shared";
import { useQuery } from "@tanstack/react-query";
import {
	Area,
	ComposedChart,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { useMoney } from "@/lib/currency";
import { useRunwayAssumptions } from "@/lib/preferences";
import { orpc } from "@/utils/orpc";

const COVERED = "var(--covered)";
const UNCOVERED = "var(--uncovered)";

/** How much real history to keep on screen, as a fraction of the projected span. */
const TAIL_SHARE = 0.25;
/** Above this the curve is drawn from a sample — a 40-year projection is 481 monthly points. */
const MAX_PROJECTED_POINTS = 180;

/** "Feb 2037" */
function fmtMonthYear(ms: number): string {
	return new Date(ms).toLocaleDateString("en-GB", {
		month: "short",
		year: "numeric",
	});
}
/** compact axis label — years alone, once the span is measured in decades */
function fmtAxis(ms: number, spanYears: number): string {
	const d = new Date(ms);
	return spanYears > 8
		? String(d.getUTCFullYear())
		: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

function sample<T>(items: T[], max: number): T[] {
	if (items.length <= max) return items;
	const step = Math.ceil(items.length / max);
	const out = items.filter((_, i) => i % step === 0);
	const last = items.at(-1);
	if (last && out.at(-1) !== last) out.push(last);
	return out;
}

type Datum = {
	t: number;
	/** real logged net worth — present only on the history tail */
	actual?: number;
	/** modelled balance — present from the anchor forward */
	projected?: number;
};

/**
 * The drawdown view (ADR-0016): your money going down over the years, given what it earns and what you
 * spend. Anchored to the latest *logged* net worth so the projection continues the history line rather than
 * starting from a slightly different number.
 */
export function RunwayView({ points }: { points: NetworthPoint[] }) {
	const m = useMoney();
	const wealth = useQuery(orpc.plan.wealth.queryOptions());
	const w = wealth.data as WealthSummary | undefined;
	const {
		assumptions,
		returnsOn,
		setReturnsOn,
		inflationOn,
		setInflationOn,
		inflationRate,
		setInflationRate,
	} = useRunwayAssumptions(w?.avgRoi);

	const anchor = points.at(-1);

	if (wealth.isLoading) {
		return <div className="h-72 animate-pulse rounded-2xl bg-muted/40" />;
	}
	if (!anchor || !w) {
		return (
			<Note>
				Log a net-worth point first — the projection has to start somewhere
				real.
			</Note>
		);
	}
	if (w.monthlyExpenses <= 0) {
		return (
			<Note>
				Add recurring expenses on the Plan page. Without them there's nothing to
				draw down, so runway is undefined rather than infinite.
			</Note>
		);
	}

	const proj = runwayProjection({
		startValue: anchor.value,
		startDate: anchor.asOf,
		monthlyExpenses: w.monthlyExpenses,
		assumptions,
	});

	const projected = sample(proj.points, MAX_PROJECTED_POINTS);
	const anchorMs = proj.points[0]?.t ?? 0;
	const endMs = proj.points.at(-1)?.t ?? anchorMs;
	const spanMs = endMs - anchorMs;
	// Keep a slice of the real climb so the turn is visible. The date-range picker still caps how much
	// history exists to draw; this only stops a decade of future from flattening it into a sliver.
	const tailFrom = anchorMs - spanMs * TAIL_SHARE;
	let tail = points.filter((p) => new Date(p.asOf).getTime() >= tailFrom);
	if (tail.length < 2) tail = points.slice(-2);

	const data: Datum[] = [
		...tail.map((p) => ({ t: new Date(p.asOf).getTime(), actual: p.value })),
		...projected.slice(1).map((p) => ({ t: p.t, projected: p.value })),
	];
	// Join the two series at the anchor, or recharts leaves a gap between the solid and dashed halves.
	const join = data.find((d) => d.t === anchorMs);
	if (join) join.projected = anchor.value;
	else
		data.unshift({
			t: anchorMs,
			actual: anchor.value,
			projected: anchor.value,
		});
	data.sort((a, b) => a.t - b.t);

	const spanYears = (endMs - (data[0]?.t ?? anchorMs)) / (365.25 * 86_400_000);
	const lasts = proj.yearsLeft == null;
	const accent = lasts ? COVERED : UNCOVERED;

	return (
		<div className="flex flex-col gap-4">
			<div className="h-72 w-full">
				<ResponsiveContainer width="100%" height="100%">
					<ComposedChart
						data={data}
						margin={{ top: 8, right: 8, bottom: 4, left: 8 }}
					>
						<defs>
							<linearGradient id="rwPast" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stopColor={COVERED} stopOpacity={0.28} />
								<stop offset="100%" stopColor={COVERED} stopOpacity={0.02} />
							</linearGradient>
							<linearGradient id="rwFuture" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stopColor={accent} stopOpacity={0.16} />
								<stop offset="100%" stopColor={accent} stopOpacity={0.01} />
							</linearGradient>
						</defs>
						<XAxis
							dataKey="t"
							type="number"
							scale="time"
							domain={["dataMin", "dataMax"]}
							tickFormatter={(v: number) => fmtAxis(v, spanYears)}
							tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
							tickLine={false}
							axisLine={{ stroke: "var(--border)" }}
							minTickGap={40}
						/>
						<YAxis
							tickFormatter={(v: number) => m.fmtc(v)}
							tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
							tickLine={false}
							axisLine={false}
							width={52}
							domain={[0, "dataMax"]}
						/>
						<ReferenceLine
							x={anchorMs}
							stroke="var(--border)"
							strokeDasharray="4 4"
							label={{
								value: "today",
								position: "insideTopLeft",
								fill: "var(--muted-foreground)",
								fontSize: 10,
							}}
						/>
						<Tooltip
							cursor={{ stroke: "var(--border)" }}
							isAnimationActive={false}
							content={<RunwayTip fmt={m.fmt} anchorMs={anchorMs} />}
						/>
						<Area
							type="monotone"
							dataKey="actual"
							stroke={COVERED}
							strokeWidth={2}
							fill="url(#rwPast)"
							isAnimationActive={false}
							dot={false}
							activeDot={{ r: 4, fill: COVERED }}
						/>
						<Area
							type="monotone"
							dataKey="projected"
							stroke={accent}
							strokeWidth={2}
							strokeDasharray="5 4"
							fill="url(#rwFuture)"
							isAnimationActive={false}
							dot={false}
							activeDot={{ r: 4, fill: accent }}
						/>
					</ComposedChart>
				</ResponsiveContainer>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
				<p className="text-sm">
					{lasts ? (
						<>
							<span className="font-medium" style={{ color: COVERED }}>
								Never depletes
							</span>
							<span className="text-muted-foreground">
								{" "}
								— still growing {RUNWAY_CAP_YEARS} years out. Your return
								outpaces spending.
							</span>
						</>
					) : (
						<>
							<span className="tnum font-medium" style={{ color: accent }}>
								{proj.yearsLeft?.toFixed(1)} yr
							</span>
							<span className="text-muted-foreground">
								{" "}
								— {m.fmtc(anchor.value)} reaches zero around{" "}
								{fmtMonthYear(endMs)}.
							</span>
						</>
					)}
				</p>

				<div className="flex flex-wrap items-center gap-2">
					<Toggle
						on={returnsOn}
						onClick={() => setReturnsOn(!returnsOn)}
						label={
							returnsOn
								? `earning ${((w.avgRoi ?? 0) * 100).toFixed(1)}%`
								: "no growth"
						}
						title="Let the remaining balance keep compounding at your blended portfolio return"
					/>
					<Toggle
						on={inflationOn}
						onClick={() => setInflationOn(!inflationOn)}
						label={inflationOn ? "inflating" : "flat spending"}
						title="Step spending up once a year"
					/>
					{inflationOn && (
						<label className="flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs">
							<input
								type="number"
								min={0}
								max={20}
								step={0.5}
								value={(inflationRate * 100).toFixed(1)}
								onChange={(e) => {
									const v = Number(e.target.value);
									if (Number.isFinite(v))
										setInflationRate(Math.min(20, Math.max(0, v)) / 100);
								}}
								className="tnum w-11 bg-transparent text-right outline-none"
								aria-label="Annual expense inflation, percent"
							/>
							<span className="text-muted-foreground">% /yr</span>
						</label>
					)}
				</div>
			</div>
		</div>
	);
}

function Toggle({
	on,
	onClick,
	label,
	title,
}: {
	on: boolean;
	onClick: () => void;
	label: string;
	title: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			aria-pressed={on}
			className={`rounded-full border px-3 py-1 text-xs transition-colors ${
				on
					? "border-foreground/25 bg-secondary font-medium"
					: "border-border text-muted-foreground hover:text-foreground"
			}`}
		>
			{label}
		</button>
	);
}

function RunwayTip({
	active,
	payload,
	fmt,
	anchorMs,
}: {
	active?: boolean;
	payload?: { payload: Datum }[];
	fmt: (inr: number) => string;
	anchorMs?: number;
}) {
	if (!active || !payload?.length) return null;
	const d = payload[0]?.payload;
	if (!d) return null;
	const value = d.actual ?? d.projected;
	if (value == null) return null;
	const future = anchorMs != null && d.t > anchorMs;
	return (
		<div className="rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md">
			<p className="font-medium text-sm">{fmtMonthYear(d.t)}</p>
			<p className="tnum mt-0.5 text-sm">{fmt(Math.round(value))}</p>
			<p className="text-muted-foreground text-xs">
				{future ? "projected" : "logged"}
			</p>
		</div>
	);
}

function Note({ children }: { children: React.ReactNode }) {
	return (
		<p className="rounded-xl border border-border border-dashed px-6 py-10 text-center text-muted-foreground text-sm">
			{children}
		</p>
	);
}
