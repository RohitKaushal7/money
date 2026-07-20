import { type SpendingTrends, spendHistory } from "@money/shared";
import {
	Bar,
	BarChart,
	CartesianGrid,
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
	month: string;
	total: number;
	[seriesKey: string]: number | string;
}

/** Monthly spend history: one stacked bar per month (top-5 categories + Other), with a flat budget line. */
export function SpendingHistory({ res }: { res: SpendingTrends }) {
	const { fmt } = useMoney();
	const hist = spendHistory(res, 5);

	const data: ChartRow[] = hist.months.map((month, i) => {
		const row: ChartRow = {
			month: formatMonth(month),
			total: hist.totalByMonth[i] ?? 0,
		};
		for (const s of hist.series) row[s.key] = hist.amounts[s.key]?.[i] ?? 0;
		return row;
	});

	const showBudget = hist.budget > 0;
	// Thin X labels once the window is wide enough that every-month labels would collide.
	const interval =
		hist.months.length > 14 ? Math.ceil(hist.months.length / 12) - 1 : 0;

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
					{showBudget && (
						<Swatch color="var(--muted-foreground)" label="Budget" dashed />
					)}
				</div>
			</div>
			<div className="h-64 w-full">
				<ResponsiveContainer width="100%" height="100%">
					<BarChart
						data={data}
						margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
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
					</BarChart>
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
	const rows = payload
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

function Swatch({
	color,
	label,
	dashed,
}: {
	color: string;
	label: string;
	dashed?: boolean;
}) {
	return (
		<span className="flex items-center gap-1.5">
			{dashed ? (
				<span
					className="inline-block w-3 border-t-2 border-dashed"
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
