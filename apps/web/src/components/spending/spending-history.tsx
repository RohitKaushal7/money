import {
	type ColorSlot,
	OTHER_COLOR,
	ROLLING_MONTHS,
	resolveCategoryColors,
	type SpendingInsights,
	type SpendingTrends,
	spendHistory,
} from "@money/shared";
import { buttonVariants } from "@money/ui/components/button";
import { useIsPhone } from "@money/ui/hooks/use-media-query";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import {
	Bar,
	CartesianGrid,
	ComposedChart,
	Line,
	ReferenceArea,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { useMoney } from "@/lib/currency";
import { formatMonth } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { orpc } from "@/utils/orpc";

const OUT = "var(--uncovered)"; // over budget = pressure
const IN = "var(--covered)"; // under budget = relief

/**
 * Stack colours come from the category, never from its position in the stack.
 *
 * This used to index the palette by stack slot — biggest total got slot 1 — so changing the range, or
 * recategorising anything, repainted every series that survived. A colour you can't rely on is one you
 * can't learn, which defeats the point of having one. `resolveCategoryColors` keys off the category
 * instead; see @money/shared/category-colors.
 *
 * The legend and tooltip still carry the label, so identity is never colour alone — which is also what
 * licenses the palette's two contrast warnings.
 */
function useCategoryColors(keys: readonly string[]): Map<string, string> {
	const cats = useQuery(orpc.categories.list.queryOptions());
	const pinned: Record<string, ColorSlot | null> = {};
	for (const c of cats.data ?? [])
		pinned[c.key] = (c.colorSlot ?? null) as ColorSlot | null;
	return resolveCategoryColors(keys, pinned);
}

interface ChartRow {
	/** Display label, e.g. "Jul '25". */
	month: string;
	/** Raw window month "YYYY-MM" — carried for the click-through to Transactions. */
	ym: string;
	total: number;
	/** Trailing-average level at this month; null where the window hasn't filled or the month is partial. */
	rolling: number | null;
	[seriesKey: string]: number | string | null;
}

/**
 * Monthly spend history: one stacked bar per month (top-5 categories + Other), over three reference marks
 * — the plan budget, the window's typical month, and the trailing average.
 *
 * The three are told apart by **dash pattern, not colour**: the five stack slots already own the palette
 * (`--cat-*`, ADR-none/validated), so a sixth and seventh hue would collide with a category. Budget is
 * dashed, typical is dotted, and the trailing average is the solid one because it is the line you actually
 * read — bars this volatile (₹3.9k to ₹1.8L across two years) don't show a direction on their own.
 */
export function SpendingHistory({
	res,
	insights,
}: {
	res: SpendingTrends;
	insights: SpendingInsights;
}) {
	// `fmtc` rather than the INR-only compact formatter: the tooltip beside this axis is already
	// currency-aware, and the axis was the one label in the chart that ignored the display currency.
	const { fmt, fmtc } = useMoney();
	const navigate = useNavigate();
	const phone = useIsPhone();
	// A phone has no hover, so the tooltip's breakdown would be unreachable if a tap went straight to
	// Transactions. Instead a tap picks the month and its breakdown shows under the chart, with the jump to
	// Transactions one tap further (the readout's button, or the same column again). Opens on the latest month.
	const [picked, setPicked] = useState<string | null>(null);
	const hist = spendHistory(res, 5);
	const colorByKey = useCategoryColors(
		hist.series.filter((s) => !s.isOther).map((s) => s.key),
	);
	const colorOf = (s: { key: string; isOther: boolean }) =>
		s.isOther ? OTHER_COLOR : (colorByKey.get(s.key) ?? OTHER_COLOR);

	const data: ChartRow[] = hist.months.map((month, i) => {
		const row: ChartRow = {
			month: formatMonth(month),
			ym: month,
			total: hist.totalByMonth[i] ?? 0,
			rolling: insights.rolling[i] ?? null,
		};
		for (const s of hist.series) row[s.key] = hist.amounts[s.key]?.[i] ?? 0;
		return row;
	});

	const showBudget = hist.budget > 0;
	const showAverage = insights.average > 0;
	const showRolling = insights.rolling.some((v) => v != null);
	// Thin X labels once the window is wide enough that every-month labels would collide. A phone fits
	// about five "Jul '25" labels across.
	const maxLabels = phone ? 5 : 12;
	const interval =
		hist.months.length > (phone ? maxLabels : 14)
			? Math.ceil(hist.months.length / maxLabels) - 1
			: 0;
	const selected = phone
		? (data.find((r) => r.ym === picked) ?? data[data.length - 1])
		: undefined;

	// Click anywhere in a month's column → open Transactions filtered to that month. Reading the chart's
	// activePayload (rather than a per-Bar onClick) makes the whole column clickable and sidesteps the
	// tooltip cursor layer swallowing bar clicks.
	const goToMonth = (state: unknown) => {
		// recharts gives us the clicked column's display label; map it back to the raw "YYYY-MM".
		const label = (state as { activeLabel?: string })?.activeLabel;
		const ym = data.find((r) => r.month === label)?.ym;
		if (!ym) return;
		if (phone && ym !== selected?.ym) {
			haptics.selected();
			setPicked(ym);
			return;
		}
		navigate({ to: "/transactions", search: { month: ym } });
	};

	const legend = (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-muted-foreground text-xs">
			{hist.series.map((s) => (
				<Swatch key={s.key} color={colorOf(s)} label={s.label} />
			))}
			{showRolling && (
				<Swatch
					color="var(--foreground)"
					label={`${ROLLING_MONTHS}-mo avg`}
					line="solid"
				/>
			)}
			{showAverage && (
				<Swatch
					color="var(--foreground)"
					label={`Typical ${fmt(Math.round(insights.average))}`}
					line="dotted"
				/>
			)}
			{showBudget && (
				<Swatch color="var(--muted-foreground)" label="Budget" line="dashed" />
			)}
		</div>
	);

	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="font-display font-medium text-xl tracking-tight">
					Spending history
				</h2>
				{!phone && legend}
			</div>
			<div className="h-64 w-full cursor-pointer">
				<ResponsiveContainer width="100%" height="100%">
					<ComposedChart
						data={data}
						margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
						onClick={goToMonth}
					>
						<CartesianGrid
							vertical={false}
							stroke="var(--border)"
							strokeDasharray="2 4"
						/>
						<XAxis
							dataKey="month"
							tickLine={false}
							axisLine={false}
							interval={interval}
							tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
							dy={8}
						/>
						<YAxis
							tickFormatter={(v) => fmtc(v as number)}
							tickLine={false}
							axisLine={false}
							width={phone ? 48 : 52}
							tick={{
								fill: "var(--muted-foreground)",
								fontSize: phone ? 12 : 11,
							}}
						/>
						{selected && (
							<ReferenceArea
								x1={selected.month}
								x2={selected.month}
								fill="var(--muted)"
								fillOpacity={0.7}
								strokeOpacity={0}
							/>
						)}
						<Tooltip
							// On a phone the readout below replaces the floating tooltip; it stays mounted (with
							// nothing to draw) so the chart still reports which column a tap landed on.
							cursor={phone ? false : { fill: "var(--muted)", opacity: 0.5 }}
							content={({ active, payload, label }) =>
								phone ? null : (
									<HistoryTooltip
										active={active}
										payload={payload as unknown as TooltipEntry[] | undefined}
										label={label as string | undefined}
										budget={hist.budget}
										fmt={fmt}
									/>
								)
							}
						/>
						{hist.series.map((s, i) => (
							<Bar
								key={s.key}
								dataKey={s.key}
								name={s.label}
								stackId="spend"
								fill={colorOf(s)}
								stroke="var(--background)"
								strokeWidth={1}
								maxBarSize={34}
								radius={
									i === hist.series.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]
								}
							/>
						))}
						{showBudget && (
							<ReferenceLine
								y={hist.budget}
								stroke="var(--muted-foreground)"
								strokeDasharray="5 5"
								strokeWidth={1.5}
							/>
						)}
						{showAverage && (
							<ReferenceLine
								y={insights.average}
								stroke="var(--foreground)"
								strokeDasharray="1 4"
								strokeOpacity={0.65}
								strokeWidth={1.5}
							/>
						)}
						{showRolling && (
							<Line
								type="monotone"
								dataKey="rolling"
								name={`${ROLLING_MONTHS}-month average`}
								stroke="var(--foreground)"
								strokeWidth={2}
								dot={false}
								activeDot={{ r: 3, fill: "var(--foreground)" }}
								isAnimationActive={false}
								connectNulls={false}
							/>
						)}
					</ComposedChart>
				</ResponsiveContainer>
			</div>
			{phone && (
				<>
					{legend}
					{selected && (
						<MonthReadout
							row={selected}
							series={hist.series.map((s) => ({
								key: s.key,
								label: s.label,
								color: colorOf(s),
							}))}
							budget={hist.budget}
							fmt={fmt}
						/>
					)}
				</>
			)}
		</section>
	);
}

/**
 * The phone's stand-in for the hover tooltip: the picked month's breakdown, in place under the chart, and
 * the way through to that month's transactions as a full-width button rather than a precise tap on a bar.
 */
function MonthReadout({
	row,
	series,
	budget,
	fmt,
}: {
	row: ChartRow;
	series: { key: string; label: string; color: string }[];
	budget: number;
	fmt: (inr: number) => string;
}) {
	const rows = series
		.map((s) => ({ ...s, value: Number(row[s.key] ?? 0) }))
		.filter((r) => r.value > 0)
		.sort((a, b) => b.value - a.value);
	return (
		<div className="flex flex-col gap-3 rounded-2xl border border-border bg-card/40 px-4 py-4 text-sm">
			<p className="text-muted-foreground text-xs">
				Tap a month to see its breakdown
			</p>
			<MonthBreakdown
				label={row.month}
				rows={rows.map((r) => ({
					label: r.label,
					value: r.value,
					color: r.color,
				}))}
				total={row.total}
				rolling={row.rolling}
				budget={budget}
				fmt={fmt}
			/>
			<Link
				to="/transactions"
				search={{ month: row.ym }}
				className={buttonVariants({
					variant: "secondary",
					className: "h-11 w-full justify-between text-sm",
				})}
			>
				{row.month} transactions
				<ChevronRight className="size-4" />
			</Link>
		</div>
	);
}

interface TooltipEntry {
	name?: string;
	value?: number;
	color?: string;
	dataKey?: string;
	payload?: ChartRow;
}

function HistoryTooltip({
	active,
	payload,
	label,
	budget,
	fmt,
}: {
	active?: boolean;
	payload?: TooltipEntry[];
	label?: string;
	budget: number;
	fmt: (inr: number) => string;
}) {
	if (!active || !payload?.length) return null;
	const total = Number(payload[0]?.payload?.total ?? 0);
	// The trailing-average Line shares the payload with the stack Bars — it is a level, not a slice of
	// this month's spend, so it belongs below the total rather than in the category list.
	const rolling = payload.find((p) => p.dataKey === "rolling")?.value;
	const rows = payload
		.filter((p) => p.dataKey !== "rolling")
		.map((p) => ({
			label: p.name ?? p.dataKey ?? "",
			value: Number(p.value ?? 0),
			color: p.color ?? OTHER_COLOR,
		}))
		.filter((r) => r.value > 0)
		.sort((a, b) => b.value - a.value);
	return (
		<div className="rounded-lg border border-border bg-popover/95 px-3 py-2 text-sm shadow-lg backdrop-blur">
			<MonthBreakdown
				label={label}
				rows={rows}
				total={total}
				rolling={rolling ?? null}
				budget={budget}
				fmt={fmt}
			/>
		</div>
	);
}

/** One month's stack, total, trailing level and budget verdict: the tooltip's body and the phone readout's. */
function MonthBreakdown({
	label,
	rows,
	total,
	rolling,
	budget,
	fmt,
}: {
	label?: string;
	rows: { label: string; value: number; color: string }[];
	total: number;
	rolling: number | null;
	budget: number;
	fmt: (inr: number) => string;
}) {
	const over = budget > 0 && total > budget;
	return (
		<div>
			<p className="mb-1 font-medium">{label}</p>
			{rows.map((r) => (
				<Row
					key={r.label}
					color={r.color}
					label={r.label}
					value={fmt(r.value)}
				/>
			))}
			<div className="tnum mt-1 flex items-center justify-between gap-6 border-border border-t pt-1">
				<span className="text-muted-foreground">Total</span>
				<span className="font-medium">{fmt(total)}</span>
			</div>
			{rolling != null && (
				<div className="tnum flex items-center justify-between gap-6 text-xs">
					<span className="text-muted-foreground">
						{ROLLING_MONTHS}-mo average
					</span>
					<span>{fmt(Number(rolling))}</span>
				</div>
			)}
			{budget > 0 && (
				<p className="tnum text-xs" style={{ color: over ? OUT : IN }}>
					{over
						? `${fmt(total - budget)} over budget`
						: `${fmt(budget - total)} under budget`}
				</p>
			)}
		</div>
	);
}

function Row({
	color,
	label,
	value,
}: {
	color: string;
	label: string;
	value: string;
}) {
	return (
		<div className="tnum flex items-center justify-between gap-6">
			<span className="flex min-w-0 items-center gap-2 text-muted-foreground">
				<span
					className="size-2 shrink-0 rounded-[2px]"
					style={{ backgroundColor: color }}
				/>
				{label}
			</span>
			<span className="shrink-0 font-medium">{value}</span>
		</div>
	);
}

const LINE_CLASS = {
	solid: "border-solid",
	dashed: "border-dashed",
	dotted: "border-dotted",
} as const;

/** A stack colour (filled square) or a reference mark, identified by its dash pattern. */
function Swatch({
	color,
	label,
	line,
}: {
	color: string;
	label: string;
	line?: "solid" | "dashed" | "dotted";
}) {
	return (
		<span className="flex items-center gap-1.5">
			{line ? (
				// Spelled out, not interpolated: Tailwind's JIT scans for literal class names, so a
				// `border-${line}` template would compile to nothing and every mark would look solid.
				<span
					className={`inline-block w-3 border-t-2 ${LINE_CLASS[line]}`}
					style={{ borderColor: color }}
				/>
			) : (
				<span
					className="size-2.5 rounded-[3px]"
					style={{ backgroundColor: color }}
				/>
			)}
			{label}
		</span>
	);
}
