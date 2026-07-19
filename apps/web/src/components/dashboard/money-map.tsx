import { CATEGORY_BY_KEY } from "@money/shared";
import { useMoney } from "@/lib/currency";
import { SectionHead } from "./trend-chart";

interface CategoryRow {
	month: string;
	categoryKey: string;
	kind: string;
	amount: number;
	n: number;
}

interface MoneyMapProps {
	rows: CategoryRow[];
}

/** "Where's my money" — expense categories ranked by spend, as an editorial bar list. */
export function MoneyMap({ rows }: MoneyMapProps) {
	const m = useMoney();
	const byCategory = new Map<string, { amount: number; n: number }>();
	for (const row of rows) {
		if (row.kind !== "expense") continue;
		const cur = byCategory.get(row.categoryKey) ?? { amount: 0, n: 0 };
		cur.amount += -row.amount; // expense magnitude (debits are negative)
		cur.n += row.n;
		byCategory.set(row.categoryKey, cur);
	}
	const items = [...byCategory.entries()]
		.map(([key, v]) => ({ key, ...v }))
		.sort((a, b) => b.amount - a.amount)
		.slice(0, 7);
	const max = items[0]?.amount ?? 1;
	const total = items.reduce((sum, i) => sum + i.amount, 0);

	if (items.length === 0) {
		return (
			<section className="flex flex-col gap-5">
				<SectionHead title="Where's my money" />
				<p className="text-muted-foreground text-sm">
					No categorised expenses yet.
				</p>
			</section>
		);
	}

	return (
		<section className="flex flex-col gap-5">
			<SectionHead
				title="Where's my money"
				aside={
					<span className="text-muted-foreground text-xs">
						{m.fmt(total)} total
					</span>
				}
			/>
			<ul className="flex flex-col gap-4">
				{items.map((item) => {
					const label = CATEGORY_BY_KEY.get(item.key)?.label ?? item.key;
					const share = Math.round((item.amount / total) * 100);
					return (
						<li key={item.key} className="flex flex-col gap-1.5">
							<div className="flex items-baseline justify-between gap-4">
								<span className="truncate font-medium text-sm">{label}</span>
								<span className="tnum shrink-0 font-display text-base">
									{m.fmt(item.amount)}
								</span>
							</div>
							<div className="flex items-center gap-3">
								<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
									<div
										className="h-full rounded-full"
										style={{
											width: `${Math.max(2, (item.amount / max) * 100)}%`,
											backgroundColor: "var(--uncovered)",
										}}
									/>
								</div>
								<span className="tnum w-8 shrink-0 text-right text-muted-foreground text-xs">
									{share}%
								</span>
							</div>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
