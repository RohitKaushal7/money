import { Skeleton } from "@money/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CoverageHero } from "@/components/dashboard/coverage-hero";
import { MoneyMap } from "@/components/dashboard/money-map";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/")({
	component: DashboardPage,
});

function DashboardPage() {
	const status = useQuery(orpc.analytics.status.queryOptions());
	const summary = useQuery(orpc.analytics.summary.queryOptions());
	const coverage = useQuery(orpc.analytics.coverageRatio.queryOptions());
	const categories = useQuery(orpc.analytics.categoryBreakdown.queryOptions());
	const recent = useQuery(orpc.analytics.recentTransactions.queryOptions());

	const loading = status.isLoading || summary.isLoading || coverage.isLoading;
	const ready = status.data?.ready ?? false;

	const points = coverage.data ?? [];
	const passive = points.reduce(
		(s, p) => s + p.passiveIncomeCash + p.imputedDrawdown,
		0,
	);
	const expenses = points.reduce((s, p) => s + p.expenses, 0);
	const months = summary.data?.months.length ?? points.length;

	return (
		<main className="h-full overflow-y-auto">
			<div className="mx-auto flex max-w-5xl flex-col gap-12 px-5 py-10 sm:px-8 sm:py-14">
				<Masthead
					uncategorized={ready ? (summary.data?.uncategorized ?? 0) : 0}
					total={summary.data?.transactions ?? 0}
				/>

				{loading ? (
					<LoadingState />
				) : !ready ? (
					<EmptyState />
				) : (
					<div className="flex flex-col gap-14">
						<CoverageHero
							passive={passive}
							expenses={expenses}
							months={months}
						/>
						<hr className="border-border" />
						<div className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
							<TrendChart points={points} />
							<MoneyMap rows={categories.data ?? []} />
						</div>
						<hr className="border-border" />
						<RecentActivity rows={recent.data ?? []} />
					</div>
				)}
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
			<div>
				<h1 className="font-display font-medium text-3xl tracking-tight">
					money
				</h1>
				<p className="mt-1 text-muted-foreground text-sm">
					Is passive income covering the life you spend?
				</p>
			</div>
			{uncategorized > 0 && (
				<div className="flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3.5 py-1.5 text-muted-foreground text-xs">
					<span className="size-1.5 rounded-full bg-[var(--uncovered)]" />
					<span className="tnum text-foreground/80">{uncategorized}</span> of{" "}
					<span className="tnum">{total}</span> need a category
				</div>
			)}
		</header>
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
				and run the ingest to see your coverage ratio, spending map, and
				activity.
			</p>
			<code className="rounded-lg bg-foreground px-4 py-2 text-background text-sm">
				bun run ingest
			</code>
		</div>
	);
}

function LoadingState() {
	return (
		<div className="flex flex-col gap-14">
			<div className="flex flex-col gap-6">
				<Skeleton className="h-4 w-40" />
				<Skeleton className="h-32 w-72" />
				<Skeleton className="h-3 w-full" />
			</div>
			<div className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
				<Skeleton className="h-64 w-full" />
				<Skeleton className="h-64 w-full" />
			</div>
		</div>
	);
}
