import {
	type AxioCrossCheckRow,
	type AxioSpendRow,
	cardBillCrossCheck,
	headerSplit,
} from "@money/shared";
import { Button } from "@money/ui/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { DateRange } from "@/components/date-range-picker";
import { useMoney } from "@/lib/currency";
import { formatMonth } from "@/lib/format";
import { orpc } from "@/utils/orpc";
import { AxioCategoryTable } from "./axio-category-table";
import { AxioChart } from "./axio-chart";

/**
 * The Axio spends Explorer (spec 2026-07-23) — an advisory lens. Reads the separate `axio_expenses` ledger,
 * shows the card/direct split up top, a tunable chart, a category table, and a soft M→M+1 cross-check
 * against the statement's card_bill. Owns its own import (unhinged from /import).
 */
export function SpendingExplorer({ range }: { range: DateRange }) {
	const { fmt } = useMoney();
	const status = useQuery(orpc.axio.status.queryOptions());
	const overview = useQuery(
		orpc.axio.overview.queryOptions({
			input: { from: range.from, to: range.to },
		}),
	);
	const refresh = () => {
		void status.refetch();
		void overview.refetch();
	};

	const spend: AxioSpendRow[] = overview.data?.spend ?? [];
	const cardBills = overview.data?.cardBillByMonth ?? [];

	if (status.data && !status.data.ready) {
		return <ImportPanel firstRun onDone={refresh} />;
	}

	const split = headerSplit(spend);
	// A month's card spend settles the NEXT month, so the current/future months have no bill yet — showing
	// them reads as a huge false "unbilled" gap. Keep only months whose settlement month has posted, newest
	// first, last six — enough to tell a persistent gap from a one-off.
	const thisMonth = new Date().toISOString().slice(0, 7);
	const settlements = cardBillCrossCheck(spend, cardBills)
		.filter((r) => r.settleMonth <= thisMonth)
		.slice(-6)
		.reverse();

	return (
		<div className="flex flex-col gap-8">
			<p className="text-muted-foreground text-sm">
				From Axio — your curated categorisation. A separate lens; it doesn’t
				touch the statement, the plan, or the coverage ratio.
			</p>

			{/* Header split — the card question, answered up top. */}
			<div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
				<span className="tnum font-display font-medium text-3xl tracking-tight">
					{fmt(split.total)}
				</span>
				<span className="text-muted-foreground text-sm">
					<span className="text-foreground">{fmt(split.cards)}</span> on cards ·{" "}
					<span className="text-foreground">{fmt(split.direct)}</span> direct
				</span>
			</div>

			<AxioChart spend={spend} />
			<AxioCategoryTable spend={spend} />

			<CardSettlements rows={settlements} />

			<ImportPanel onDone={refresh} />
		</div>
	);
}

/**
 * Recent card settlements: month M's Axio card spend against the statement's card_bill in month M+1. A
 * single month is noise (partial payments, rollover); a run of them shows whether the two ledgers track.
 */
function CardSettlements({ rows }: { rows: AxioCrossCheckRow[] }) {
	const { fmt } = useMoney();
	if (rows.length === 0) return null;
	return (
		<section className="flex flex-col gap-2">
			<h3 className="font-medium text-muted-foreground text-sm">
				Card settlements · Axio spend vs statement bill
			</h3>
			<div className="flex flex-col divide-y divide-border rounded-2xl border border-border border-dashed bg-card/30 px-6">
				<div className="flex items-center gap-3 py-2 text-muted-foreground text-xs">
					<span className="flex-1">Spend month → bill month</span>
					<span className="w-24 text-right">Axio</span>
					<span className="w-24 text-right">Bill</span>
					<span className="w-28 text-right">Gap</span>
				</div>
				{rows.map((r) => {
					// Neither direction is inherently good or bad, so the gap stays neutral — magnitude and
					// direction, no red/green. "Matched" is within ~10% (partial payments and rollover make an
					// exact match unusual even when nothing is wrong).
					const matched =
						Math.abs(r.gap) <= 0.1 * Math.max(r.cardSpend, r.cardBill);
					return (
						<div
							key={r.spendMonth}
							className="tnum flex items-center gap-3 py-2.5 text-sm"
						>
							<span className="flex-1 text-muted-foreground">
								{formatMonth(r.spendMonth)} → {formatMonth(r.settleMonth)}
							</span>
							<span className="w-24 text-right">{fmt(r.cardSpend)}</span>
							<span className="w-24 text-right text-muted-foreground">
								{fmt(r.cardBill)}
							</span>
							<span className="w-28 text-right">
								{matched ? (
									<span className="text-muted-foreground">matched</span>
								) : (
									<>
										{fmt(Math.abs(r.gap))}{" "}
										<span className="text-muted-foreground text-xs">
											{r.gap > 0 ? "unbilled" : "over"}
										</span>
									</>
								)}
							</span>
						</div>
					);
				})}
			</div>
			<p className="text-muted-foreground text-xs">
				Advisory — Axio and the statement are separate ledgers; a persistent gap
				means a spend Axio missed or a transfer you haven’t re-marked. The
				current month is omitted until its bill posts.
			</p>
		</section>
	);
}

function ImportPanel({
	firstRun,
	onDone,
}: {
	firstRun?: boolean;
	onDone: () => void;
}) {
	const fileRef = useRef<HTMLInputElement>(null);
	const [csv, setCsv] = useState<string | null>(null);
	const preview = useMutation(orpc.axio.previewImport.mutationOptions());
	const commit = useMutation(
		orpc.axio.commitImport.mutationOptions({ onSuccess: onDone }),
	);
	const remove = useMutation(
		orpc.axio.removeImport.mutationOptions({ onSuccess: onDone }),
	);
	const { fmt } = useMoney();

	const onFile = async (file: File) => {
		const text = await file.text();
		setCsv(text);
		preview.mutate({ csv: text });
	};

	const p = preview.data;

	return (
		<div className="flex flex-col gap-3 rounded-2xl border border-border px-6 py-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h3 className="font-medium">
					{firstRun ? "Import your Axio export" : "Replace the Axio import"}
				</h3>
				<input
					ref={fileRef}
					type="file"
					accept=".csv,text/csv"
					className="hidden"
					onChange={(e) => {
						const f = e.target.files?.[0];
						if (f) void onFile(f);
					}}
				/>
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={() => fileRef.current?.click()}
				>
					Choose CSV
				</Button>
			</div>
			<p className="text-muted-foreground text-xs">
				Export the full history from Axio and upload it — it replaces the
				previous import. Curate transfers/spends in Axio first.
			</p>

			{p?.ok && (
				<div className="flex flex-col gap-2">
					<p className="text-sm">
						{p.total} rows · {fmt(p.expenseSum)} real spend ·{" "}
						{p.minDate?.slice(0, 7)} → {p.maxDate?.slice(0, 7)}
					</p>
					<div className="flex gap-2">
						<Button
							type="button"
							size="sm"
							disabled={commit.isPending || !csv}
							onClick={() => csv && commit.mutate({ csv })}
						>
							{commit.isPending ? "Importing…" : "Import"}
						</Button>
						{!firstRun && (
							<Button
								type="button"
								size="sm"
								variant="ghost"
								disabled={remove.isPending}
								onClick={() => remove.mutate(undefined)}
							>
								Remove Axio data
							</Button>
						)}
					</div>
				</div>
			)}
			{p && !p.ok && (
				<p className="text-sm" style={{ color: "var(--uncovered)" }}>
					Couldn’t parse that file: {p.error}
				</p>
			)}
			{commit.isError && (
				<p className="text-sm" style={{ color: "var(--uncovered)" }}>
					{(commit.error as Error).message}
				</p>
			)}
		</div>
	);
}
