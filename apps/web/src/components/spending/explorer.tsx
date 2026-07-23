import {
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
	const cross = cardBillCrossCheck(spend, cardBills).at(-1); // most recent settled month

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

			{cross && cross.cardSpend > 0 && (
				<CrossCheck
					label={`${formatMonth(cross.spendMonth)} card spend`}
					settle={formatMonth(cross.settleMonth)}
					cardSpend={fmt(cross.cardSpend)}
					cardBill={fmt(cross.cardBill)}
					gap={fmt(Math.abs(cross.gap))}
					over={cross.gap > 0}
				/>
			)}

			<ImportPanel onDone={refresh} />
		</div>
	);
}

function CrossCheck({
	label,
	settle,
	cardSpend,
	cardBill,
	gap,
	over,
}: {
	label: string;
	settle: string;
	cardSpend: string;
	cardBill: string;
	gap: string;
	over: boolean;
}) {
	return (
		<div className="rounded-2xl border border-border border-dashed bg-card/30 px-6 py-5 text-sm">
			<p className="text-muted-foreground">
				{label} <span className="text-foreground">{cardSpend}</span> → settled{" "}
				{settle} as card&nbsp;bill{" "}
				<span className="text-foreground">{cardBill}</span> ·{" "}
				<span style={{ color: over ? "var(--uncovered)" : "var(--covered)" }}>
					{gap} {over ? "unbilled" : "over-billed"}
				</span>
			</p>
			<p className="mt-1 text-muted-foreground text-xs">
				Advisory — Axio and the statement are separate ledgers; a persistent gap
				means a spend Axio missed or a transfer you haven’t re-marked.
			</p>
		</div>
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
