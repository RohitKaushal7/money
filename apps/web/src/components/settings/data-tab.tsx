import { Button } from "@money/ui/components/button";
import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	type DateRange,
	DateRangePicker,
	resolveRange,
} from "@/components/date-range-picker";
import { csvFilename, downloadCsv } from "@/lib/download";
import { client } from "@/utils/orpc";
import { Section } from "./section";

interface ExportItem {
	/** filename stem */
	dataset: string;
	label: string;
	hint: string;
	/** false → ignores the date range (full history) */
	ranged: boolean;
	run: (range: DateRange) => Promise<{ csv: string; rows: number }>;
}

const ITEMS: ExportItem[] = [
	{
		dataset: "transactions",
		label: "Transactions",
		hint: "Every row in range — date, narration, amount, balance, category, kind.",
		ranged: true,
		run: (r) => client.export.transactions({ dateFrom: r.from, dateTo: r.to }),
	},
	{
		dataset: "investments",
		label: "Investments",
		hint: "Your holdings — principal, current value, rate, maturity, status.",
		ranged: false,
		run: () => client.export.investments(),
	},
	{
		dataset: "recurring-expenses",
		label: "Recurring expenses",
		hint: "The committed monthly outflows behind the coverage KPI.",
		ranged: false,
		run: () => client.export.recurringExpenses(),
	},
	{
		dataset: "spending-by-category",
		label: "Spending by category",
		hint: "Category × month × kind totals in range.",
		ranged: true,
		run: (r) =>
			client.export.spendingByCategory({ dateFrom: r.from, dateTo: r.to }),
	},
	{
		dataset: "coverage-history",
		label: "Coverage history",
		hint: "The north-star KPI per month in range.",
		ranged: true,
		run: (r) =>
			client.export.coverageHistory({ dateFrom: r.from, dateTo: r.to }),
	},
];

export function DataTab() {
	const [range, setRange] = useState<DateRange>(() => resolveRange("all"));
	const [busy, setBusy] = useState<string | null>(null);

	const download = async (item: ExportItem) => {
		setBusy(item.dataset);
		try {
			const { csv, rows } = await item.run(range);
			if (rows === 0) {
				toast.info(`Nothing to export in ${item.label.toLowerCase()}.`);
				return;
			}
			downloadCsv(csvFilename(item.dataset), csv);
			toast.success(`${item.label} — ${rows.toLocaleString()} rows exported.`);
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setBusy(null);
		}
	};

	return (
		<Section title="Export data">
			<p className="text-muted-foreground text-sm">
				Download your data as CSV for spreadsheets or backup. The date range
				below scopes Transactions and Spending; Plan exports in full.
			</p>
			{/* The picker is shared and sized for a pointer; on a phone its controls get the full 44px here. */}
			<div className="max-w-xs max-md:max-w-none max-md:[&_button]:min-h-11">
				<DateRangePicker defaultPreset="all" onChange={setRange} />
			</div>
			<ul className="flex flex-col divide-y divide-border max-md:overflow-hidden max-md:rounded-2xl max-md:border max-md:border-border max-md:bg-card">
				{ITEMS.map((item) => (
					<li
						key={item.dataset}
						className="flex items-center gap-4 py-3 max-md:gap-3 max-md:px-4"
					>
						<div className="flex min-w-0 flex-1 flex-col">
							<span className="font-medium text-sm max-md:text-base">
								{item.label}
								{!item.ranged && (
									<span className="ml-2 text-muted-foreground text-xs">
										full history
									</span>
								)}
							</span>
							<span className="text-muted-foreground text-xs max-md:text-sm">
								{item.hint}
							</span>
						</div>
						<Button
							type="button"
							size="sm"
							variant="outline"
							className="max-md:min-h-11"
							disabled={busy !== null}
							onClick={() => void download(item)}
						>
							{/* "CSV" alone on a phone: the row already says what downloads, and the hint keeps its width. */}
							{busy === item.dataset ? (
								"Preparing…"
							) : (
								<>
									<span className="max-md:hidden">Download CSV</span>
									<Download className="md:hidden" />
									<span className="md:hidden">CSV</span>
								</>
							)}
						</Button>
					</li>
				))}
			</ul>
		</Section>
	);
}
