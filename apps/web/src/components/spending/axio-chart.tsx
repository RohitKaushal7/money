import {
	AXIO_OTHER,
	type AxioSpendRow,
	axioColors,
	axioSeries,
	OTHER_COLOR,
	topAxioCategories,
} from "@money/shared";
import { useMemo, useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { useMoney } from "@/lib/currency";
import { usePreference } from "@/lib/preferences";

/**
 * The tunable Axio chart. Three shapes — Composition (stacked bars), Trend (a line per selected category),
 * Total (one spend-per-period line) — over Month/Quarter/Year and an account scope. Colours follow the
 * category (stable slots, capped at five + Other), never the rank.
 */
export function AxioChart({ spend }: { spend: AxioSpendRow[] }) {
	const { fmt, fmtc } = useMoney();
	const [granularity, setGranularity] = usePreference("explorer.granularity");
	const [mode, setMode] = usePreference("explorer.mode");
	const [scope, setScope] = usePreference("explorer.scope");

	// Default selection = top-5 categories in scope; the user can narrow via the picker.
	const top5 = useMemo(
		() => topAxioCategories(spend, 5, scope),
		[spend, scope],
	);
	const [selected, setSelected] = useState<string[] | null>(null);
	const categories = selected ?? top5;

	const series = useMemo(
		() => axioSeries(spend, { granularity, scope, categories }),
		[spend, granularity, scope, categories],
	);
	const colors = useMemo(() => axioColors(categories), [categories]);
	const colorOf = (key: string) =>
		key === AXIO_OTHER ? OTHER_COLOR : (colors.get(key) ?? OTHER_COLOR);

	const data = series.map((pt) => ({
		period: pt.period,
		total: pt.total,
		...pt.byCategory,
	}));
	const stackKeys = [...categories, AXIO_OTHER];

	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<Segmented
					value={mode}
					onChange={setMode}
					options={[
						["composition", "Composition"],
						["trend", "Trend"],
						["total", "Total"],
					]}
				/>
				<Segmented
					value={granularity}
					onChange={setGranularity}
					options={[
						["month", "Month"],
						["quarter", "Quarter"],
						["year", "Year"],
					]}
				/>
				<Segmented
					value={scope}
					onChange={setScope}
					options={[
						["all", "All"],
						["cards", "Cards"],
						["direct", "Direct"],
					]}
				/>
			</div>

			{/* Category chips: click to toggle which categories are highlighted (max 5 coloured). */}
			<div className="flex flex-wrap gap-1.5">
				{top5.map((c) => {
					const on = categories.includes(c);
					return (
						<button
							key={c}
							type="button"
							onClick={() =>
								setSelected(
									on
										? categories.filter((x) => x !== c)
										: [...categories, c].slice(0, 5),
								)
							}
							className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
								on
									? "border-transparent text-foreground"
									: "border-border text-muted-foreground"
							}`}
							style={
								on
									? { backgroundColor: colorOf(c), color: "var(--background)" }
									: undefined
							}
						>
							{c}
						</button>
					);
				})}
			</div>

			<div className="h-72 w-full">
				<ResponsiveContainer width="100%" height="100%">
					{mode === "composition" ? (
						<BarChart
							data={data}
							margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
						>
							<Grid />
							<Axes fmtc={fmtc} />
							<Tip fmt={fmt} />
							{stackKeys.map((k, i) => (
								<Bar
									key={k}
									dataKey={k}
									name={k === AXIO_OTHER ? "Other" : k}
									stackId="s"
									fill={colorOf(k)}
									stroke="var(--background)"
									strokeWidth={1}
									maxBarSize={40}
									radius={
										i === stackKeys.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]
									}
								/>
							))}
						</BarChart>
					) : (
						<LineChart
							data={data}
							margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
						>
							<Grid />
							<Axes fmtc={fmtc} />
							<Tip fmt={fmt} />
							{mode === "total" ? (
								<Line
									type="monotone"
									dataKey="total"
									name="Total"
									stroke="var(--foreground)"
									strokeWidth={2}
									dot={false}
									isAnimationActive={false}
								/>
							) : (
								categories.map((k) => (
									<Line
										key={k}
										type="monotone"
										dataKey={k}
										name={k}
										stroke={colorOf(k)}
										strokeWidth={2}
										dot={false}
										isAnimationActive={false}
										connectNulls
									/>
								))
							)}
						</LineChart>
					)}
				</ResponsiveContainer>
			</div>
		</section>
	);
}

function Segmented<T extends string>({
	value,
	onChange,
	options,
}: {
	value: T;
	onChange: (v: T) => void;
	options: [T, string][];
}) {
	return (
		<div className="flex overflow-hidden rounded-lg border border-border text-xs">
			{options.map(([v, label]) => (
				<button
					key={v}
					type="button"
					onClick={() => onChange(v)}
					className={`cursor-pointer px-2.5 py-1 transition-colors ${
						value === v
							? "bg-secondary text-foreground"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					{label}
				</button>
			))}
		</div>
	);
}

function Grid() {
	return (
		<CartesianGrid
			vertical={false}
			stroke="var(--border)"
			strokeDasharray="2 4"
		/>
	);
}

function Axes({ fmtc }: { fmtc: (n: number) => string }) {
	return (
		<>
			<XAxis
				dataKey="period"
				tickLine={false}
				axisLine={false}
				tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
				dy={8}
			/>
			<YAxis
				tickFormatter={(v) => fmtc(v as number)}
				tickLine={false}
				axisLine={false}
				width={52}
				tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
			/>
		</>
	);
}

function Tip({ fmt }: { fmt: (n: number) => string }) {
	return (
		<Tooltip
			cursor={{ fill: "var(--muted)", opacity: 0.4 }}
			formatter={(value: unknown, name: unknown) => [
				fmt(Number(value)),
				String(name),
			]}
			contentStyle={{
				background: "var(--popover)",
				border: "1px solid var(--border)",
				borderRadius: 8,
				fontSize: 13,
			}}
		/>
	);
}
