import { type AxioSpendRow, axioColors, categoryTotals } from "@money/shared";
import { useMemo } from "react";
import { useMoney } from "@/lib/currency";

/** Advisory category table for the window: category · total · share · count. Sorted biggest first. */
export function AxioCategoryTable({ spend }: { spend: AxioSpendRow[] }) {
	const { fmt } = useMoney();
	const rows = useMemo(() => categoryTotals(spend), [spend]);
	const grand = rows.reduce((s, r) => s + r.total, 0);
	const colors = useMemo(() => axioColors(rows.map((r) => r.category)), [rows]);

	if (rows.length === 0) return null;

	return (
		<section className="flex flex-col gap-2">
			<h3 className="font-medium text-muted-foreground text-sm">
				Categories · this window
			</h3>
			<div className="flex flex-col divide-y divide-border">
				{rows.map((r) => (
					<div
						key={r.category}
						className="tnum flex items-center gap-3 py-2 text-sm max-md:min-h-14"
					>
						<span
							className="size-2.5 shrink-0 rounded-[3px]"
							style={{ backgroundColor: colors.get(r.category) }}
						/>
						<span className="flex min-w-0 flex-1 flex-col">
							<span className="truncate">{r.category}</span>
							{/* On a phone the share and count sit under the name, named, instead of in two
							    unlabelled narrow columns. */}
							<span className="text-muted-foreground text-xs md:hidden">
								{grand > 0 ? Math.round((r.total / grand) * 100) : 0}% ·{" "}
								{r.count} txn{r.count === 1 ? "" : "s"}
							</span>
						</span>
						<span className="w-12 text-right text-muted-foreground text-xs max-md:hidden">
							{grand > 0 ? Math.round((r.total / grand) * 100) : 0}%
						</span>
						<span className="w-10 text-right text-muted-foreground text-xs max-md:hidden">
							{r.count}
						</span>
						<span className="w-24 text-right font-medium">{fmt(r.total)}</span>
					</div>
				))}
			</div>
		</section>
	);
}
