import {
	ROLLING_MONTHS,
	type SpendingInsights,
	type SpendingTrends,
	spendHistory,
} from "@money/shared";
import { useNavigate } from "@tanstack/react-router";
import {
	Bar,
	CartesianGrid,
	ComposedChart,
	Line,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { useMoney } from "@/lib/currency";
import { formatCompactINR, formatMonth } from "@/lib/format";

const OUT = "var(--uncovered)"; // over budget = pressure
const IN = "var(--covered)"; // under budget = relief

/**
 * Categorical stack colours — the dataviz-validated `--cat-*` slots (index.css), in slot order. The palette
 * is assigned by stack position (biggest-total category → slot 1); with a fixed 5-hue palette + "Other",
 * per-window rank ordering is unavoidable, so the always-on legend and hover tooltip carry identity, never
 * colour alone. "Other" is a muted neutral, deliberately recessive.
 */
const PALETTE = [
	"var(--cat-1)",
	"var(--cat-2)",
	"var(--cat-3)",
	"var(--cat-4)",
	"var(--cat-5)",
];
const OTHER_COLOR = "var(--muted-foreground)";

function colorAt(index: number, isOther: boolean): string {
	return isOther ? OTHER_COLOR : (PALETTE[index % PALETTE.length] as string);
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
	const { fmt } = useMoney();
	const navigate = useNavigate();
	const hist = spendHistory(res, 5);

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
	// Thin X labels once the window is wide enough that every-month labels would collide.
	const interval =
		hist.months.length > 14 ? Math.ceil(hist.months.length / 12) - 1 : 0;

	// Click anywhere in a month's column → open Transactions filtered to that month. Reading the chart's
	// activePayload (rather than a per-Bar onClick) makes the whole column clickable and sidesteps the
	// tooltip cursor layer swallowing bar clicks.
	const goToMonth = (state: unknown) => {
		// recharts gives us the clicked column's display label; map it back to the raw "YYYY-MM".
		const label = (state as { activeLabel?: string })?.activeLabel;
		const ym = data.find((r) => r.month === label)?.ym;
		if (ym) navigate({ to: "/transactions", search: { month: ym } });
	};

	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="font-display font-medium text-xl tracking-tight">
					Spending history
				</h2>
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-muted-foreground text-xs">
					{hist.series.map((s, i) => (
						<Swatch key={s.key} color={colorAt(i, s.isOther)} label={s.label} />
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
						<Swatch
							color="var(--muted-foreground)"
							label="Budget"
							line="dashed"
						/>
					)}
				</div>
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
							tickFormatter={(v) => formatCompactINR(v as number)}
							tickLine={false}
							axisLine={false}
							width={52}
							tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
						/>
						<Tooltip
							cursor={{ fill: "var(--muted)", opacity: 0.5 }}
							content={({ active, payload, label }) => (
								<HistoryTooltip
									active={active}
									payload={payload as unknown as TooltipEntry[] | undefined}
									label={label as string | undefined}
									budget={hist.budget}
									fmt={fmt}
								/>
							)}
						/>
						{hist.series.map((s, i) => (
							<Bar
								key={s.key}
								dataKey={s.key}
								name={s.label}
								stackId="spend"
								fill={colorAt(i, s.isOther)}
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
		</section>
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
	const over = budget > 0 && total > budget;
	return (
		<div className="rounded-lg border border-border bg-popover/95 px-3 py-2 text-sm shadow-lg backdrop-blur">
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
			<span className="flex items-center gap-2 text-muted-foreground">
				<span
					className="size-2 rounded-[2px]"
					style={{ backgroundColor: color }}
				/>
				{label}
			</span>
			<span className="font-medium">{value}</span>
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
