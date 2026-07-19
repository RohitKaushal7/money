import { Skeleton } from "@money/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CoverageHero } from "@/components/dashboard/coverage-hero";
import { MoneyMap } from "@/components/dashboard/money-map";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/")({
	component: DashboardPage,
});

function DashboardPage() {
	const coverage = useQuery(orpc.plan.coverage.queryOptions());
	const status = useQuery(orpc.analytics.status.queryOptions());
	const summary = useQuery(orpc.analytics.summary.queryOptions());
	const categories = useQuery(orpc.analytics.categoryBreakdown.queryOptions());
	const recent = useQuery(orpc.analytics.recentTransactions.queryOptions());

	const cov = coverage.data;
	const planEmpty = !!cov && cov.passiveIncome === 0 && cov.expenses === 0;
	const statementReady = status.data?.ready ?? false;

	return (
		<main className="h-full overflow-y-auto">
			<div className="mx-auto flex max-w-5xl flex-col gap-14 px-5 py-10 sm:px-8 sm:py-14">
				<Masthead
					uncategorized={
						statementReady ? (summary.data?.uncategorized ?? 0) : 0
					}
					total={summary.data?.transactions ?? 0}
				/>

				{/* THE PLAN — the north-star KPI, driven by your investments + recurring expenses */}
				{coverage.isLoading ? (
					<HeroSkeleton />
				) : planEmpty ? (
					<PlanEmpty />
				) : cov ? (
					<CoverageHero
						interest={cov.interest}
						drawdown={cov.drawdown}
						expenses={cov.expenses}
						ratio={cov.ratio}
					/>
				) : null}

				<hr className="border-border" />

				{/* ACTUALS — what actually happened, from your SBI statement */}
				<section className="flex flex-col gap-8">
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<h2 className="font-medium text-[0.7rem] text-muted-foreground uppercase tracking-[0.22em]">
							Actuals · from your statement
						</h2>
						{statementReady && (
							<span className="text-muted-foreground text-xs">
								<span className="tnum text-foreground/70">
									{summary.data?.transactions ?? 0}
								</span>{" "}
								transactions
							</span>
						)}
					</div>

					{status.isLoading ? (
						<ActualsSkeleton />
					) : !statementReady ? (
						<EmptyState />
					) : (
						<div className="flex flex-col gap-14">
							<MoneyMap rows={categories.data ?? []} />
							<hr className="border-border" />
							<RecentActivity rows={recent.data ?? []} />
						</div>
					)}
				</section>
			</div>
		</main>
	);
}

function Masthead({
	uncategorized,
	total,
}: {
	uncategorized: number;
	total: number;
}) {
	return (
		<header className="flex flex-wrap items-end justify-between gap-4">
			<h1 className="font-display font-medium text-3xl tracking-tight">
				Overview
			</h1>
			<div className="flex items-center gap-3">
				{uncategorized > 0 && (
					<div className="flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3.5 py-1.5 text-muted-foreground text-xs">
						<span className="size-1.5 rounded-full bg-[var(--uncovered)]" />
						<span className="tnum text-foreground/80">{uncategorized}</span> of{" "}
						<span className="tnum">{total}</span> need a category
					</div>
				)}
				<Link
					to="/plan"
					className="rounded-full border border-border px-3.5 py-1.5 font-medium text-xs transition-colors hover:bg-secondary"
				>
					Manage plan →
				</Link>
			</div>
		</header>
	);
}

function PlanEmpty() {
	return (
		<div className="flex flex-col items-start gap-4 rounded-2xl border border-border border-dashed px-8 py-16">
			<p className="font-display font-medium text-2xl">Your plan is empty</p>
			<p className="max-w-md text-muted-foreground">
				Coverage is driven by your <strong>plan</strong> — the investments that
				throw off interest, and the recurring expenses they need to cover. Add a
				few to watch the ratio climb toward being free.
			</p>
			<Link
				to="/plan"
				className="rounded-lg bg-foreground px-4 py-2 font-medium text-background text-sm"
			>
				Build your plan →
			</Link>
		</div>
	);
}

function EmptyState() {
	return (
		<div className="flex flex-col items-start gap-4 rounded-2xl border border-border border-dashed px-8 py-16">
			<p className="font-display font-medium text-2xl">
				No statement ingested yet
			</p>
			<p className="max-w-md text-muted-foreground">
				Drop your SBI statement export into{" "}
				<code className="rounded bg-muted px-1.5 py-0.5 text-sm">
					data/raw/
				</code>{" "}
				and run the ingest to see where your money actually goes.
			</p>
			<code className="rounded-lg bg-foreground px-4 py-2 text-background text-sm">
				bun run ingest
			</code>
		</div>
	);
}

function HeroSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			<Skeleton className="h-4 w-48" />
			<Skeleton className="h-32 w-72" />
			<Skeleton className="h-3 w-full" />
		</div>
	);
}

function ActualsSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			<Skeleton className="h-56 w-full" />
			<Skeleton className="h-40 w-full" />
		</div>
	);
}
