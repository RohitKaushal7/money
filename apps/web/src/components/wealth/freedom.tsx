import {
	freedomProjection,
	type NetworthPoint,
	observedSavingRate,
	perpetuityTarget,
	type SpendingTrends,
	spendingInsights,
	type WealthSummary,
} from "@money/shared";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
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
/** Above this the curve is drawn from a sample — a 50-year projection is 600 monthly points. */
const MAX_PROJECTED_POINTS = 180;

function fmtMonthYear(ms: number): string {
	return new Date(ms).toLocaleDateString("en-GB", {
		month: "short",
		year: "numeric",
	});
}
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
	/** modelled balance in today's rupees — present from the anchor forward */
	projected?: number;
};

/**
 * The accumulation view: how long until the portfolio is big enough to never run out.
 *
 * Runway asks how long the money lasts if income stopped today. This asks when it stops mattering. Both are
 * drawn from the same assumptions and the same anchor, so the two views describe one portfolio.
 *
 * **Everything forward of today is in today's rupees.** The logged history is nominal and joins the
 * projection at the anchor, where the two bases coincide — deflating the owner's own logged figures would
 * make them unrecognisable for a rigour nobody reading a chart would notice.
 */
export function FreedomView({ points }: { points: NetworthPoint[] }) {
	const m = useMoney();
	const wealth = useQuery(orpc.plan.wealth.queryOptions());
	const w = wealth.data as WealthSummary | undefined;
	const spending = useQuery(orpc.spending.overview.queryOptions({ input: {} }));
	const { assumptions } = useRunwayAssumptions(w?.avgRoi);

	// What you actually spend, not what the plan budgets. `w.monthlyExpenses` is the plan figure, and
	// building the target on it would understate what freedom costs by exactly the amount you overspend.
	const trends = spending.data as SpendingTrends | undefined;
	const actualSpend = useMemo(
		() => (trends ? spendingInsights(trends).recentMean : 0),
		[trends],
	);
	const planSpend = w?.monthlyExpenses ?? 0;
	const spend = actualSpend > 0 ? actualSpend : planSpend;

	const anchor = points.at(-1);
	const target = useMemo(
		() => perpetuityTarget({ monthlyExpenses: spend, assumptions }),
		[spend, assumptions],
	);
	// Measured from history, so it is stripped of return using the *portfolio's* rate — not the assumption.
	// Toggling "no growth" changes what the future is projected at; it cannot change what you already saved.
	const saving = useMemo(
		() =>
			observedSavingRate({
				logs: points.map((p) => ({ asOf: p.asOf, value: p.value })),
				annualReturn: w?.avgRoi ?? 0,
			}),
		[points, w?.avgRoi],
	);

	if (wealth.isLoading || spending.isLoading) {
		return <div className="h-72 animate-pulse rounded-2xl bg-muted/40" />;
	}
	if (!anchor || !w) {
		return (
			<Note>
				Log a net-worth point first — the climb has to start somewhere real.
			</Note>
		);
	}
	if (spend <= 0) {
		return (
			<Note>
				Add recurring expenses on the Plan page. Without them there is nothing
				to fund, so "never runs out" is true of any amount.
			</Note>
		);
	}
	if (target == null) {
		return (
			<Note>
				At {(assumptions.annualReturn * 100).toFixed(1)}% return against{" "}
				{(assumptions.inflation * 100).toFixed(1)}% inflation,{" "}
				<span className="text-foreground">no corpus lasts forever</span> —
				spending overtakes any starting amount. Raise the return or lower
				inflation to see a target.
			</Note>
		);
	}
	if (saving == null) {
		return (
			<Note>
				Log your net worth twice, at least six months apart. Freedom needs a
				saving rate, and a rate read off a fortnight is noise.
			</Note>
		);
	}

	const proj = freedomProjection({
		startValue: anchor.value,
		startDate: anchor.asOf,
		monthlyContribution: saving,
		target,
		assumptions,
	});

	const projected = sample(proj.points, MAX_PROJECTED_POINTS);
	const anchorMs = proj.points[0]?.t ?? 0;
	const endMs = proj.points.at(-1)?.t ?? anchorMs;
	const spanMs = Math.max(endMs - anchorMs, 1);
	const tailFrom = anchorMs - spanMs * TAIL_SHARE;
	let tail = points.filter((p) => new Date(p.asOf).getTime() >= tailFrom);
	if (tail.length < 2) tail = points.slice(-2);

	const data: Datum[] = [
		...tail.map((p) => ({ t: new Date(p.asOf).getTime(), actual: p.value })),
		...projected.slice(1).map((p) => ({ t: p.t, projected: p.value })),
	];
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
	const arrives = proj.yearsToTarget != null;
	const accent = arrives ? COVERED : UNCOVERED;

	// The lever: the same sum, spent at plan. A cut moves both ends — it raises what is saved and lowers
	// what is needed — so the effect on the date is far larger than the monthly figure suggests.
	const cut = actualSpend > 0 ? actualSpend - planSpend : 0;
	const lever =
		cut > 0 && planSpend > 0
			? (() => {
					const t2 = perpetuityTarget({
						monthlyExpenses: planSpend,
						assumptions,
					});
					if (t2 == null) return null;
					const p2 = freedomProjection({
						startValue: anchor.value,
						startDate: anchor.asOf,
						monthlyContribution: saving + cut,
						target: t2,
						assumptions,
					});
					return p2.yearsToTarget == null
						? null
						: { years: p2.yearsToTarget, target: t2 };
				})()
			: null;

	return (
		<div className="flex flex-col gap-4">
			<div className="h-72 w-full">
				<ResponsiveContainer width="100%" height="100%">
					<ComposedChart
						data={data}
						margin={{ top: 8, right: 8, bottom: 4, left: 8 }}
					>
						<defs>
							<linearGradient id="fdPast" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stopColor={COVERED} stopOpacity={0.28} />
								<stop offset="100%" stopColor={COVERED} stopOpacity={0.02} />
							</linearGradient>
							<linearGradient id="fdFuture" x1="0" y1="0" x2="0" y2="1">
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
							domain={[0, (d: number) => Math.max(d, target * 1.05)]}
						/>
						<ReferenceLine
							y={target}
							stroke={COVERED}
							strokeDasharray="6 4"
							label={{
								// Below the line and hard left: the curve reaches the target at the far right, so a
								// right-anchored label sits exactly where the two collide.
								value: `never runs out · ${m.fmtc(target)}`,
								position: "insideBottomLeft",
								fill: COVERED,
								fontSize: 10,
							}}
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
							content={<FreedomTip fmt={m.fmt} anchorMs={anchorMs} />}
						/>
						<Area
							type="monotone"
							dataKey="actual"
							stroke={COVERED}
							strokeWidth={2}
							fill="url(#fdPast)"
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
							fill="url(#fdFuture)"
							isAnimationActive={false}
							dot={false}
							activeDot={{ r: 4, fill: accent }}
						/>
					</ComposedChart>
				</ResponsiveContainer>
			</div>

			<div className="flex flex-col gap-3">
				<p className="text-sm">
					{arrives ? (
						<>
							<span className="tnum font-medium" style={{ color: accent }}>
								{(proj.yearsToTarget as number).toFixed(1)} yr
							</span>
							<span className="text-muted-foreground">
								{" "}
								— {m.fmtc(target)} around {fmtMonthYear(endMs)}, saving{" "}
								<span className="tnum font-bold text-foreground">
									{m.fmt(Math.round(saving))}/mo
								</span>{" "}
								and growing{" "}
								<span className="tnum">
									{(proj.realRate * 100).toFixed(1)}%
								</span>{" "}
								a year after inflation.
							</span>
						</>
					) : (
						<>
							<span className="font-medium" style={{ color: UNCOVERED }}>
								Not within a lifetime
							</span>
							<span className="text-muted-foreground">
								{" "}
								— at {m.fmt(Math.round(saving))}/mo and{" "}
								{(proj.realRate * 100).toFixed(1)}% real growth,{" "}
								{m.fmtc(target)} is out of reach. Spend less, save more, or earn
								more.
							</span>
						</>
					)}
				</p>

				<div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-muted-foreground text-xs">
					<span>
						<span className="tnum font-bold text-foreground">
							{(proj.progress * 100).toFixed(1)}%
						</span>{" "}
						of the way there
					</span>
					<span>
						target assumes{" "}
						<span className="tnum">{m.fmt(Math.round(spend))}/mo</span> spending
						{actualSpend > 0 && planSpend > 0 && actualSpend !== planSpend && (
							<> — what you actually spend, not the {m.fmtc(planSpend)} plan</>
						)}
					</span>
				</div>

				{lever && arrives && (
					<p className="rounded-lg border border-border border-dashed px-3 py-2 text-xs leading-relaxed">
						<span className="text-muted-foreground">Spend at your </span>
						<span className="tnum font-bold text-foreground">
							{m.fmt(Math.round(planSpend))}
						</span>
						<span className="text-muted-foreground">
							{" "}
							plan budget and you'd be free in{" "}
						</span>
						<span className="tnum font-bold" style={{ color: COVERED }}>
							{lever.years.toFixed(1)} yr
						</span>
						<span className="text-muted-foreground">
							{" "}
							— {((proj.yearsToTarget as number) - lever.years).toFixed(1)}{" "}
							years sooner. A cut lowers the target to {m.fmtc(lever.target)} as
							well as raising what you save.
						</span>
					</p>
				)}
			</div>
		</div>
	);
}

function FreedomTip({
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
				{future ? "projected · today's rupees" : "logged"}
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
