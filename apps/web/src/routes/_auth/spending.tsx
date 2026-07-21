import {
	type CoverageLadder,
	type SpendingCategory,
	type SpendingInsights,
	type SpendingTrends,
	spendingInsights,
} from "@money/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import {
	type DateRange,
	DateRangePicker,
	resolveRange,
} from "@/components/date-range-picker";
import { SpendingHistory } from "@/components/spending/spending-history";
import { useMoney } from "@/lib/currency";
import { formatDay, formatMonth } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/spending")({
	component: SpendingPage,
});

const OUT = "var(--uncovered)"; // spending rising / over budget = the colour of pressure
const IN = "var(--covered)"; // spending falling / under budget = the colour of relief

function SpendingPage() {
	const [range, setRange] = useState<DateRange>(() => resolveRange("last-24m"));
	const q = useQuery(
		orpc.spending.overview.queryOptions({
			input: { from: range.from, to: range.to },
		}),
	);
	const res = q.data as SpendingTrends | undefined;
	const hasData = !!res && res.months.length > 0;
	// One computation shared by the summary, the level strip and the chart, so the three can never disagree
	// about what a typical month costs or whether this one is finished.
	const insights = useMemo(() => (res ? spendingInsights(res) : null), [res]);

	return (
		<main className="h-full overflow-y-auto">
			<div className="mx-auto flex max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
				<header className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex flex-col gap-1">
						<h1 className="font-display font-medium text-3xl tracking-tight">
							Spending
						</h1>
						<p className="max-w-xl text-muted-foreground">
							How much is going out, and which categories are creeping up — each
							month against its own recent norm and your plan budget.
						</p>
					</div>
					<DateRangePicker defaultPreset="last-24m" onChange={setRange} />
				</header>

				{q.isLoading && <Muted>Loading…</Muted>}
				{!q.isLoading && !hasData && <EmptyState />}

				{hasData && res && insights && (
					<>
						<SummaryBar res={res} insights={insights} />
						<LevelStrip res={res} insights={insights} />
						<SpendingHistory res={res} insights={insights} />
						<section className="flex flex-col">
							<SectionHead>
								Categories{" "}
								<span className="text-muted-foreground">
									· biggest movers first
								</span>
							</SectionHead>
							<ul className="flex flex-col">
								{res.categories.map((c) => (
									<MoverRow key={c.key} cat={c} months={res.months} />
								))}
							</ul>
						</section>
						{res.budgetedNoActual.length > 0 && (
							<BudgetedNoActual items={res.budgetedNoActual} />
						)}
					</>
				)}
			</div>
		</main>
	);
}

// ── summary ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * The month so far, judged fairly.
 *
 * Two corrections over a raw total-vs-budget comparison, both of which flipped a real reading on this
 * data. **Lumpy categories are held out**: an annual tax payment landing in one month out of twenty-four
 * is not a monthly budget overrun, and counting it turned "₹830 over" into "₹40,240 over". **A month in
 * progress says so**: three weeks of spending compared against a full month's budget is not a verdict.
 */
function SummaryBar({
	res,
	insights,
}: {
	res: SpendingTrends;
	insights: SpendingInsights;
}) {
	const { fmt } = useMoney();
	const latestMonth = res.months[res.months.length - 1] ?? "";
	const hasBudget = res.totalBudget > 0;
	// Judge the recurring side only — that is what the plan budgets.
	const diff = insights.latestRecurring - res.totalBudget;
	const overBudget = diff > 0;
	return (
		<section className="flex flex-col gap-5 rounded-2xl border border-border bg-card/40 px-6 py-6">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
						Out in {formatMonth(latestMonth)}
						{insights.latestIsPartial && (
							<span className="ml-2 normal-case tracking-normal">
								· {insights.daysElapsed} of {insights.daysInMonth} days
							</span>
						)}
					</p>
					<p
						className="tnum font-display font-medium text-3xl leading-none"
						style={{ color: OUT }}
					>
						{fmt(res.latestTotal)}
					</p>
					{insights.latestOneOff > 0 && (
						<p className="mt-2 text-muted-foreground text-sm">
							<span className="tnum">{fmt(insights.latestRecurring)}</span>{" "}
							recurring ·{" "}
							<span className="tnum">{fmt(insights.latestOneOff)}</span> one-off
							<span className="text-muted-foreground/70">
								{" "}
								({insights.oneOffLabels.join(", ")})
							</span>
						</p>
					)}
				</div>
				{hasBudget && (
					<div className="text-right">
						<p className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
							Monthly budget
						</p>
						<p className="tnum font-display font-medium text-2xl text-muted-foreground leading-none">
							{fmt(res.totalBudget)}
						</p>
					</div>
				)}
			</div>
			{hasBudget && (
				<p className="text-sm" style={{ color: overBudget ? OUT : IN }}>
					{fmt(Math.abs(Math.round(diff)))} {overBudget ? "over" : "under"}{" "}
					budget
					{insights.latestOneOff > 0 && " on recurring spend"}
					{insights.latestIsPartial && (
						<span className="text-muted-foreground">
							{" "}
							— with {insights.daysInMonth - insights.daysElapsed} days still to
							go
						</span>
					)}
				</p>
			)}
		</section>
	);
}

/**
 * The two facts the movers table can't tell you: what a month actually costs against what the plan says it
 * costs, and whether that is moving. The budget gap matters beyond this page — it is the denominator of the
 * north-star coverage ratio, so a plan that understates reality overstates how free you are.
 */
function LevelStrip({
	res,
	insights,
}: {
	res: SpendingTrends;
	insights: SpendingInsights;
}) {
	const { fmt } = useMoney();
	const ladder = useQuery(orpc.plan.ladder.queryOptions());
	const passive = (ladder.data as CoverageLadder | undefined)?.total.income;
	const planRatio = (ladder.data as CoverageLadder | undefined)?.total.ratio;
	const actualRatio =
		passive != null && insights.average > 0 ? passive / insights.average : null;
	const over = (insights.vsBudgetPct ?? 0) > 0;
	const yoyUp = (insights.yoy?.pct ?? 0) > 0;

	if (insights.average <= 0) return null;

	return (
		<section className="grid gap-x-8 gap-y-6 rounded-2xl border border-border px-6 py-6 sm:grid-cols-2 lg:grid-cols-3">
			<Figure
				label="Typical month"
				value={fmt(Math.round(insights.average))}
				note={
					insights.vsBudgetPct == null
						? "average over this window"
						: `${signedPct(insights.vsBudgetPct)} vs the ${fmt(res.totalBudget)} plan budget`
				}
				tone={insights.vsBudgetPct == null ? undefined : over ? OUT : IN}
			/>

			{insights.yoy && (
				<Figure
					label={`Last ${insights.yoy.recentMonths} months`}
					value={`${fmt(Math.round(insights.yoy.recent))} /mo`}
					note={
						insights.yoy.pct == null
							? "no prior period to compare"
							: `${signedPct(insights.yoy.pct)} vs the ${insights.yoy.priorMonths} mo before, at ${fmt(Math.round(insights.yoy.prior))} /mo`
					}
					tone={insights.yoy.pct == null ? undefined : yoyUp ? OUT : IN}
				/>
			)}

			{actualRatio != null && (
				<Figure
					label="Covered by passive income"
					value={`${actualRatio.toFixed(2)}×`}
					note={
						planRatio != null
							? `${planRatio.toFixed(2)}× when measured against the plan`
							: "against what you actually spend"
					}
					tone={actualRatio >= 1 ? IN : OUT}
				/>
			)}
		</section>
	);
}

function Figure({
	label,
	value,
	note,
	tone,
}: {
	label: string;
	value: string;
	note: string;
	tone?: string;
}) {
	return (
		<div className="flex flex-col gap-1">
			<p className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
				{label}
			</p>
			<p className="tnum font-display font-medium text-2xl leading-none">
				{value}
			</p>
			<p className="text-xs" style={tone ? { color: tone } : undefined}>
				{note}
			</p>
		</div>
	);
}

/** signed one-decimal percent, e.g. +28.3% / −4.1% */
function signedPct(r: number): string {
	const v = r * 100;
	return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
}

// ── one category ────────────────────────────────────────────────────────────────────────────────────
function MoverRow({
	cat,
	months,
}: {
	cat: SpendingCategory;
	months: string[];
}) {
	const { fmt, fmtc } = useMoney();
	const [open, setOpen] = useState(false);
	return (
		<li className="border-border border-b">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex w-full items-center gap-4 py-3.5 text-left transition-colors hover:bg-secondary/30"
			>
				<ChevronRight
					className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
				/>
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium">{cat.label}</p>
					<p className="text-muted-foreground text-xs">
						{cat.n} txn{cat.n === 1 ? "" : "s"}
						{cat.budget > 0 && <> · budget {fmtc(cat.budget)}/mo</>}
					</p>
				</div>
				<Sparkline values={cat.byMonth} budget={cat.budget} months={months} />
				<div className="w-28 shrink-0 text-right">
					<p className="tnum font-medium">{fmt(cat.latest)}</p>
					<TrendChip cat={cat} />
				</div>
			</button>
			{open && <Drill categoryKey={cat.key} />}
		</li>
	);
}

/** Vertical mini-bars across the window, with a dashed plan-budget reference line and a hover label. */
function Sparkline({
	values,
	budget,
	months,
}: {
	values: number[];
	budget: number;
	months: string[];
}) {
	const { fmt } = useMoney();
	const [hover, setHover] = useState<number | null>(null);
	const max = Math.max(1, ...values, budget);
	return (
		<div
			className="relative hidden h-9 items-end gap-[3px] sm:flex"
			onMouseLeave={() => setHover(null)}
			aria-hidden
		>
			{budget > 0 && (
				<div
					className="pointer-events-none absolute inset-x-0 border-muted-foreground/60 border-t border-dashed"
					style={{ bottom: `${(budget / max) * 100}%` }}
				/>
			)}
			{values.map((v, i) => {
				const last = i === values.length - 1;
				const active = hover === i;
				return (
					// full-height column → a comfortable hit target for the thin bar it holds
					// biome-ignore lint/a11y/noStaticElementInteractions: decorative aria-hidden sparkline; hover only surfaces a value label already shown numerically in the row
					<div
						key={months[i]}
						onMouseEnter={() => setHover(i)}
						className="relative flex h-full w-1.5 cursor-default items-end"
					>
						<div
							className="w-full rounded-sm transition-opacity"
							style={{
								height: `${Math.max(4, (v / max) * 100)}%`,
								backgroundColor: OUT,
								opacity: last || active ? 1 : 0.35,
							}}
						/>
						{active && (
							<div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[0.65rem] shadow-md">
								<span className="text-muted-foreground">
									{formatMonth(months[i] ?? "")}
								</span>{" "}
								<span className="tnum font-medium text-popover-foreground">
									{fmt(v)}
								</span>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

/** The move-vs-norm chip plus, when budgeted, an over/under-budget readout. */
function TrendChip({ cat }: { cat: SpendingCategory }) {
	const Icon =
		cat.trend === "up"
			? TrendingUp
			: cat.trend === "down"
				? TrendingDown
				: Minus;
	const color =
		cat.trend === "up" ? OUT : cat.trend === "down" ? IN : undefined;
	const label =
		cat.deltaPct == null
			? cat.trend === "up"
				? "new"
				: "—"
			: `${cat.deltaPct >= 0 ? "+" : "−"}${Math.round(Math.abs(cat.deltaPct) * 100)}%`;
	return (
		<div className="flex flex-col items-end gap-0.5">
			<span
				className="flex items-center gap-1 text-xs"
				style={{ color: color ?? "var(--muted-foreground)" }}
			>
				<Icon className="size-3.5" />
				{label}
			</span>
			{cat.overBudgetPct != null && (
				<span
					className="text-[0.65rem]"
					style={{ color: cat.overBudgetPct > 0 ? OUT : IN }}
				>
					{cat.overBudgetPct > 0
						? `${Math.round(cat.overBudgetPct * 100)}% over`
						: `${Math.round(-cat.overBudgetPct * 100)}% under`}
				</span>
			)}
		</div>
	);
}

/** Drill-in: the individual transactions filed under this category (lazy-loaded on expand). */
function Drill({ categoryKey }: { categoryKey: string }) {
	const { fmt } = useMoney();
	const q = useQuery(
		orpc.spending.categoryTransactions.queryOptions({
			input: { categoryKey },
		}),
	);
	const txns = q.data ?? [];
	return (
		<div className="mb-2 ml-8 flex flex-col rounded-lg bg-secondary/25 px-3 py-1">
			{q.isLoading && (
				<p className="py-2 text-muted-foreground text-xs">Loading…</p>
			)}
			{!q.isLoading && txns.length === 0 && (
				<p className="py-2 text-muted-foreground text-xs">No transactions.</p>
			)}
			{txns.map((t) => (
				<div
					key={t.txnId}
					className="flex items-center gap-3 border-border/60 border-b py-2 last:border-b-0"
				>
					<span className="tnum w-14 shrink-0 text-muted-foreground text-xs">
						{formatDay(t.date)}
					</span>
					<span className="min-w-0 flex-1 truncate text-xs">{t.narration}</span>
					<span className="tnum shrink-0 text-xs" style={{ color: OUT }}>
						{fmt(t.amount)}
					</span>
				</div>
			))}
		</div>
	);
}

// ── budgeted but not yet seen in the statement ────────────────────────────────────────────────────────
function BudgetedNoActual({
	items,
}: {
	items: SpendingTrends["budgetedNoActual"];
}) {
	const { fmtc } = useMoney();
	return (
		<section className="rounded-2xl border border-border border-dashed bg-card/30 px-6 py-5">
			<p className="mb-2 text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
				Budgeted · nothing categorised yet
			</p>
			<ul className="flex flex-wrap gap-x-6 gap-y-1.5">
				{items.map((b) => (
					<li key={b.key} className="text-sm">
						<span className="text-foreground/80">{b.label}</span>{" "}
						<span className="tnum text-muted-foreground">
							{fmtc(b.budget)}/mo
						</span>
					</li>
				))}
			</ul>
			<p className="mt-3 text-muted-foreground text-xs">
				These have a plan budget but no statement spend tagged to them — improve
				the rules (or retag on Reconcile) to see them trend here.
			</p>
		</section>
	);
}

// ── bits ────────────────────────────────────────────────────────────────────────────────────────────
function SectionHead({ children }: { children: React.ReactNode }) {
	return (
		<div className="border-border border-b-2 pb-2">
			<h2 className="font-display font-medium text-lg">{children}</h2>
		</div>
	);
}

function Muted({ children }: { children: React.ReactNode }) {
	return <p className="py-4 text-muted-foreground text-sm">{children}</p>;
}

function EmptyState() {
	return (
		<div className="flex flex-col items-start gap-4 rounded-2xl border border-border border-dashed px-8 py-16">
			<p className="font-display font-medium text-2xl">
				No spending to show yet
			</p>
			<p className="max-w-md text-muted-foreground">
				Drop your SBI statement export into{" "}
				<code className="rounded bg-muted px-1.5 py-0.5 text-sm">
					data/raw/
				</code>{" "}
				and run the ingest to see where your money goes over time.
			</p>
			<code className="rounded-lg bg-foreground px-4 py-2 text-background text-sm">
				bun run ingest
			</code>
		</div>
	);
}
