import { CATEGORY_BY_KEY } from "@money/shared";
import { useMoney } from "@/lib/currency";
import { formatDay } from "@/lib/format";
import { SectionHead } from "./trend-chart";

interface TransactionRow {
	txnId: string;
	date: string;
	narration: string;
	amount: number;
	balance: number;
	kind: string | null;
	categoryKey: string | null;
}

const KIND_COLOR: Record<string, string> = {
	passive_income: "var(--covered)",
	expense: "var(--uncovered)",
	investment: "var(--chart-4)",
	active_income: "var(--primary)",
	transfer: "var(--muted-foreground)",
};

interface RecentActivityProps {
	rows: TransactionRow[];
}

export function RecentActivity({ rows }: RecentActivityProps) {
	const m = useMoney();
	const items = rows.slice(0, 12);
	return (
		<section className="flex flex-col gap-5">
			<SectionHead title="Recent activity" />
			<ul className="flex flex-col">
				{items.map((t) => {
					const credit = t.amount >= 0;
					const category = t.categoryKey ?? "uncategorized";
					const label = CATEGORY_BY_KEY.get(category)?.label ?? category;
					const chipColor =
						KIND_COLOR[t.kind ?? "transfer"] ?? "var(--muted-foreground)";
					return (
						<li
							key={t.txnId}
							className="grid grid-cols-[3rem_1fr_auto] items-center gap-4 border-border/60 border-b py-3 last:border-0"
						>
							<span className="tnum text-muted-foreground text-xs">
								{formatDay(t.date)}
							</span>
							<div className="min-w-0">
								<p className="truncate text-sm">
									{prettyNarration(t.narration)}
								</p>
								<span
									className="mt-0.5 inline-flex items-center gap-1.5 text-[0.7rem] text-muted-foreground"
									title={t.kind ?? ""}
								>
									<span
										className="size-1.5 rounded-full"
										style={{ backgroundColor: chipColor }}
									/>
									{label}
								</span>
							</div>
							<span
								className="tnum text-right font-medium text-sm"
								style={{
									color: credit ? "var(--covered)" : "var(--foreground)",
								}}
							>
								{credit ? "+" : "−"}
								{m.fmt(Math.abs(t.amount))}
							</span>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

/** SBI narrations are dense; show the most human part first. */
function prettyNarration(raw: string): string {
	return raw
		.replace(/\s+0\d{10,}.*$/, "") // trailing ref no + branch tail
		.replace(/\bAT \d+.*$/, "")
		.trim();
}
