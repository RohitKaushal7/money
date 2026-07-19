import type { SpendingCategory, SpendingTrends } from "@money/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import {
	formatCompactINR,
	formatDay,
	formatINR,
	formatMonth,
} from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/spending")({
	component: SpendingPage,
});

const OUT = "var(--uncovered)"; // spending rising / over budget = the colour of pressure
const IN = "var(--covered)"; // spending falling / under budget = the colour of relief

function SpendingPage() {
	const q = useQuery(orpc.spending.overview.queryOptions());
	const res = q.data as SpendingTrends | undefined;
	const hasData = !!res && res.months.length > 0;

	return (
		<main className="h-full overflow-y-auto">
			<div className="mx-auto flex max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
				<header className="flex flex-col gap-1">
					<h1 className="font-display font-medium text-3xl tracking-tight">
						Spending
					</h1>
					<p className="text-muted-foreground">
						How much is going out, and which categories are creeping up — each
						month against its own recent norm and your plan budget.
					</p>
				</header>

				{q.isLoading && <Muted>Loading…</Muted>}
				{!q.isLoading && !hasData && <EmptyState />}

				{hasData && res && (
					<>
						<SummaryBar res={res} />
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
function SummaryBar({ res }: { res: SpendingTrends }) {
	const latestMonth = res.months[res.months.length - 1] ?? "";
	const overBudget = res.totalBudget > 0 && res.latestTotal > res.totalBudget;
	return (
		<section className="flex flex-col gap-5 rounded-2xl border border-border bg-card/40 px-6 py-6">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
						Out in {formatMonth(latestMonth)}
					</p>
					<p
						className="tnum font-display font-medium text-3xl leading-none"
						style={{ color: OUT }}
					>
						{formatINR(res.latestTotal)}
					</p>
				</div>
				{res.totalBudget > 0 && (
					<div className="text-right">
						<p className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
							Monthly budget
						</p>
						<p className="tnum font-display font-medium text-2xl text-muted-foreground leading-none">
							{formatINR(res.totalBudget)}
						</p>
					</div>
				)}
			</div>
			{res.totalBudget > 0 && (
				<p className="text-sm" style={{ color: overBudget ? OUT : IN }}>
					{overBudget
						? `${formatINR(res.latestTotal - res.totalBudget)} over budget this month`
						: `${formatINR(res.totalBudget - res.latestTotal)} under budget this month`}
				</p>
			)}
		</section>
	);
}

// ── one category ────────────────────────────────────────────────────────────────────────────────────
function MoverRow({
	cat,
	months,
}: {
	cat: SpendingCategory;
	months: string[];
}) {
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
						{cat.budget > 0 && <> · budget {formatCompactINR(cat.budget)}/mo</>}
					</p>
				</div>
				<Sparkline values={cat.byMonth} budget={cat.budget} months={months} />
				<div className="w-28 shrink-0 text-right">
					<p className="tnum font-medium">{formatINR(cat.latest)}</p>
					<TrendChip cat={cat} />
				</div>
			</button>
			{open && <Drill categoryKey={cat.key} />}
		</li>
	);
}

/** Vertical mini-bars across the window, with a dashed plan-budget reference line. */
function Sparkline({
	values,
	budget,
	months,
}: {
	values: number[];
	budget: number;
	months: string[];
}) {
	const max = Math.max(1, ...values, budget);
	return (
		<div
			className="relative hidden h-9 items-end gap-[3px] sm:flex"
			aria-hidden
		>
			{budget > 0 && (
				<div
					className="absolute inset-x-0 border-muted-foreground/60 border-t border-dashed"
					style={{ bottom: `${(budget / max) * 100}%` }}
					title={`budget ${formatINR(budget)}`}
				/>
			)}
			{values.map((v, i) => {
				const last = i === values.length - 1;
				return (
					<div
						key={months[i]}
						title={`${formatMonth(months[i] ?? "")}: ${formatINR(v)}`}
						className="w-1.5 rounded-sm"
						style={{
							height: `${Math.max(4, (v / max) * 100)}%`,
							backgroundColor: OUT,
							opacity: last ? 1 : 0.35,
						}}
					/>
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
						{formatINR(t.amount)}
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
							{formatCompactINR(b.budget)}/mo
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
