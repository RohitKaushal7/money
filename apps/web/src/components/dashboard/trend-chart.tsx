import {
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import {
	formatCompactINR,
	formatINR,
	formatMonth,
	formatRatio,
} from "@/lib/format";

interface CoveragePoint {
	month: string;
	passiveIncomeCash: number;
	imputedDrawdown: number;
	expenses: number;
	ratio: number | null;
}

interface TrendChartProps {
	points: CoveragePoint[];
}

/** Monthly passive income vs expenses — the two quantities whose ratio is the KPI. */
export function TrendChart({ points }: TrendChartProps) {
	const data = points.map((p) => ({
		month: formatMonth(p.month),
		passive: p.passiveIncomeCash + p.imputedDrawdown,
		expenses: p.expenses,
		ratio: p.ratio ?? 0,
	}));

	return (
		<section className="flex flex-col gap-5">
			<SectionHead
				title="Passive vs spending"
				aside={
					<span className="flex items-center gap-4 text-muted-foreground text-xs">
						<Swatch color="var(--covered)" label="Passive" />
						<Swatch color="var(--uncovered)" label="Expenses" />
					</span>
				}
			/>
			<div className="h-64 w-full">
				<ResponsiveContainer width="100%" height="100%">
					<BarChart
						data={data}
						margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
						barGap={6}
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
							content={<TrendTooltip />}
						/>
						<Bar
							dataKey="passive"
							fill="var(--covered)"
							radius={[4, 4, 0, 0]}
							maxBarSize={34}
						/>
						<Bar
							dataKey="expenses"
							fill="var(--uncovered)"
							radius={[4, 4, 0, 0]}
							maxBarSize={34}
						/>
					</BarChart>
				</ResponsiveContainer>
			</div>
		</section>
	);
}

interface TooltipPayload {
	payload: { month: string; passive: number; expenses: number; ratio: number };
}

function TrendTooltip({
	active,
	payload,
}: {
	active?: boolean;
	payload?: TooltipPayload[];
}) {
	if (!active || !payload?.length) return null;
	const d = payload[0]?.payload;
	if (!d) return null;
	return (
		<div className="rounded-lg border border-border bg-popover/95 px-3 py-2 text-sm shadow-lg backdrop-blur">
			<p className="mb-1 font-medium">{d.month}</p>
			<Row
				color="var(--covered)"
				label="Passive"
				value={formatINR(d.passive)}
			/>
			<Row
				color="var(--uncovered)"
				label="Expenses"
				value={formatINR(d.expenses)}
			/>
			<p className="mt-1 border-border border-t pt-1 text-muted-foreground text-xs">
				coverage {formatRatio(d.ratio)}
			</p>
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

function Swatch({ color, label }: { color: string; label: string }) {
	return (
		<span className="flex items-center gap-1.5">
			<span
				className="size-2.5 rounded-[3px]"
				style={{ backgroundColor: color }}
			/>
			{label}
		</span>
	);
}

export function SectionHead({
	title,
	aside,
}: {
	title: string;
	aside?: React.ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-4">
			<h2 className="font-display font-medium text-xl tracking-tight">
				{title}
			</h2>
			{aside}
		</div>
	);
}
