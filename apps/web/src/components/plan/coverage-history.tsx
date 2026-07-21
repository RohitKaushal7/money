import { useQuery } from "@tanstack/react-query";
import {
	Bar,
	ComposedChart,
	Line,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { useMoney } from "@/lib/currency";
import { formatRatio } from "@/lib/format";
import { orpc } from "@/utils/orpc";

const INCOME = "var(--covered)";
const EXPENSES = "var(--uncovered)";
/** The ratio rides its own axis, so it needs a colour that reads against both of the above. `--cat-1` is
 *  from the CVD-validated categorical palette (`--chart-*` clusters and fails separation — see spending). */
const RATIO = "var(--cat-1)";

interface Point {
	month: string;
	expenses: number;
	cash: { income: number; ratio: number | null };
	fixed: { income: number; ratio: number | null };
	total: { income: number; ratio: number | null };
}

const MONTHS = [
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

/** "2026-07" → "Jul '26" */
function shortMonth(month: string): string {
	const [y, m] = month.split("-");
	const i = Number(m) - 1;
	return i >= 0 && i < 12 ? `${MONTHS[i]} '${(y ?? "").slice(2)}` : month;
}

/**
 * The KPI's second half: is coverage *trending up*?
 *
 * A rising ratio is ambiguous on its own — passive income growing and expenses shrinking look identical.
 * So the ratio gets the primary axis, and the two quantities it is made of are plotted underneath in ₹ on
 * a shared secondary axis, where they can be compared directly against each other.
 */
export function CoverageHistory() {
	const m = useMoney();
	const history = useQuery(orpc.plan.coverageHistory.queryOptions());
	const points = (history.data ?? []) as Point[];

	const data = points.map((p) => ({
		month: p.month,
		label: shortMonth(p.month),
		ratio: p.total.ratio,
		income: p.total.income,
		expenses: p.expenses,
		cash: p.cash.income,
		fixed: p.fixed.income,
	}));

	return (
		<section className="flex flex-col gap-5 rounded-2xl border border-border bg-card/40 px-6 py-6">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
						Coverage over time
					</p>
					<p className="mt-1 text-muted-foreground text-sm">
						Whether the ratio is climbing — and which side moved.
					</p>
				</div>
				{data.length > 1 && (
					<div className="flex items-center gap-4 text-xs">
						<Legend color={INCOME} shape="bar" label="Passive income" />
						<Legend color={EXPENSES} shape="line" label="Expenses" />
						<Legend color={RATIO} shape="line" label="Coverage" />
					</div>
				)}
			</div>

			{history.isLoading ? (
				<div className="h-64 animate-pulse rounded-xl bg-muted/50" />
			) : data.length < 2 ? (
				<Empty first={data[0]?.month} />
			) : (
				<div className="h-64 w-full">
					<ResponsiveContainer width="100%" height="100%">
						<ComposedChart
							data={data}
							margin={{ top: 8, right: 8, bottom: 4, left: 8 }}
						>
							<XAxis
								dataKey="label"
								tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
								tickLine={false}
								axisLine={{ stroke: "var(--border)" }}
								minTickGap={20}
							/>
							<YAxis
								yAxisId="ratio"
								tickFormatter={(v: number) => `${v.toFixed(1)}×`}
								tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
								tickLine={false}
								axisLine={false}
								width={44}
								domain={[0, (max: number) => Math.max(1.1, max * 1.15)]}
							/>
							<YAxis
								yAxisId="money"
								orientation="right"
								tickFormatter={(v: number) => m.fmtc(v)}
								tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
								tickLine={false}
								axisLine={false}
								width={52}
								domain={[0, "dataMax"]}
							/>
							{/* 1.0× — the line that means "free" */}
							<ReferenceLine
								yAxisId="ratio"
								y={1}
								stroke="var(--muted-foreground)"
								strokeDasharray="4 4"
								strokeOpacity={0.6}
							/>
							<Tooltip
								cursor={{ stroke: "var(--border)" }}
								isAnimationActive={false}
								content={<CoverageTip fmt={m.fmt} />}
							/>
							<Bar
								yAxisId="money"
								dataKey="income"
								barSize={18}
								radius={2}
								fill={INCOME}
								fillOpacity={0.45}
								isAnimationActive={false}
							/>
							<Line
								yAxisId="money"
								type="monotone"
								dataKey="expenses"
								stroke={EXPENSES}
								strokeWidth={1.5}
								strokeDasharray="5 3"
								dot={false}
								isAnimationActive={false}
							/>
							<Line
								yAxisId="ratio"
								type="monotone"
								dataKey="ratio"
								stroke={RATIO}
								strokeWidth={2.5}
								dot={false}
								activeDot={{ r: 4, fill: RATIO }}
								isAnimationActive={false}
								connectNulls
							/>
						</ComposedChart>
					</ResponsiveContainer>
				</div>
			)}
		</section>
	);
}

function Legend({
	color,
	shape,
	label,
}: {
	color: string;
	shape: "bar" | "line";
	label: string;
}) {
	return (
		<span className="flex items-center gap-1.5 text-muted-foreground">
			<span
				className={
					shape === "bar" ? "h-2.5 w-2.5 rounded-[2px]" : "h-0.5 w-3.5"
				}
				style={{ backgroundColor: color }}
			/>
			{label}
		</span>
	);
}

function Empty({ first }: { first?: string }) {
	return (
		<div className="flex h-64 flex-col items-start justify-center gap-2 rounded-xl border border-border border-dashed px-8">
			<p className="font-display font-medium text-lg">Not enough history yet</p>
			<p className="max-w-md text-muted-foreground text-sm">
				{first
					? `Your plan has been captured since ${shortMonth(first)}. A second month is needed before there's a trend to draw.`
					: "Each month your plan is captured automatically. The trend appears once two months exist."}{" "}
				There's no backfill — the plan only ever held current state, so history
				starts from when you began.
			</p>
		</div>
	);
}

interface TipPayload {
	payload: {
		label: string;
		ratio: number | null;
		income: number;
		expenses: number;
		cash: number;
		fixed: number;
	};
}

function CoverageTip({
	active,
	payload,
	fmt,
}: {
	active?: boolean;
	payload?: TipPayload[];
	fmt: (n: number) => string;
}) {
	const d = payload?.[0]?.payload;
	if (!active || !d) return null;
	return (
		<div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
			<p className="font-medium text-sm">{d.label}</p>
			<p className="tnum mt-1" style={{ color: RATIO }}>
				{d.ratio == null ? "—" : formatRatio(d.ratio)} coverage
			</p>
			<dl className="mt-2 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-muted-foreground">
				<dt>Passive income</dt>
				<dd className="tnum text-right text-foreground/80">{fmt(d.income)}</dd>
				<dt>Expenses</dt>
				<dd className="tnum text-right text-foreground/80">
					{fmt(d.expenses)}
				</dd>
				<dt className="pt-1 text-[0.7rem]">of which cash</dt>
				<dd className="tnum pt-1 text-right text-[0.7rem]">{fmt(d.cash)}</dd>
				<dt className="text-[0.7rem]">of which fixed</dt>
				<dd className="tnum text-right text-[0.7rem]">{fmt(d.fixed)}</dd>
			</dl>
		</div>
	);
}
