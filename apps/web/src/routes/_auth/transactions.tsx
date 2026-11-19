import { Button } from "@money/ui/components/button";
import { Select } from "@money/ui/components/select";
import { useIsPhone } from "@money/ui/hooks/use-media-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	ChevronLeft,
	ChevronRight,
	ListPlus,
	RefreshCw,
	RotateCcw,
	Scissors,
	Search,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { DateRangePicker } from "@/components/date-range-picker";
import { TabBar } from "@/components/tab-bar";
import {
	PhoneTxnActions,
	PhoneTxnFilters,
	TxnSheet,
} from "@/components/transactions/phone";
import {
	IN,
	isRowPending,
	PENDING_C,
	SplitEditor,
	type Txn,
	tint,
} from "@/components/transactions/split-editor";
import { DayGroupedTxnList, wholeOrPaise } from "@/components/txn-list";
import {
	groupByKind,
	KIND_COLOR,
	KIND_LABEL,
	KIND_ORDER,
	kindColor,
	useCategories,
} from "@/lib/categories";
import { csvFilename, downloadCsv } from "@/lib/download";
import { formatDate, useFormat } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { client, orpc } from "@/utils/orpc";
import { CategoriesTab } from "./-categories-tab";
import { type RulePrefill, RulesTab } from "./-rules-tab";

const TXN_TABS = [
	{ key: "transactions", label: "Transactions" },
	{ key: "rules", label: "Rules" },
	{ key: "categories", label: "Categories" },
] as const;

type TxnTab = (typeof TXN_TABS)[number]["key"];

export const Route = createFileRoute("/_auth/transactions")({
	// `?month=YYYY-MM` seeds the month filter — e.g. drilling in from the spending-history chart.
	validateSearch: (search: Record<string, unknown>): { month?: string } => ({
		month: typeof search.month === "string" ? search.month : undefined,
	}),
	component: TransactionsPage,
});

const PAGE = 100;

function TransactionsPage() {
	const qc = useQueryClient();
	const { month: monthParam } = Route.useSearch();
	const [searchInput, setSearchInput] = useState("");
	const [search, setSearch] = useState("");
	const [month, setMonth] = useState(monthParam ?? "");
	const [kind, setKind] = useState("");
	const [uncatOnly, setUncatOnly] = useState(false);
	const [dateFrom, setDateFrom] = useState("");
	const [dateTo, setDateTo] = useState("");
	const [offset, setOffset] = useState(0);
	const [splitOpen, setSplitOpen] = useState<string | null>(null);
	const [tab, setTab] = useState<TxnTab>("transactions");
	const [rulePrefill, setRulePrefill] = useState<RulePrefill | null>(null);
	const phone = useIsPhone();
	const { formatINR } = useFormat();
	// The phone's open transaction. A snapshot as well as the id, so the sheet keeps its contents while it
	// slides away, and still shows the row after an edit takes it out of a filtered list.
	const [sheetTxn, setSheetTxn] = useState<Txn | null>(null);
	const [sheetOpen, setSheetOpen] = useState(false);
	const catsQ = useCategories();

	// debounce the search box; any filter change resets to the first page
	useEffect(() => {
		const t = setTimeout(() => {
			setSearch(searchInput);
			setOffset(0);
		}, 250);
		return () => clearTimeout(t);
	}, [searchInput]);

	const summaryQ = useQuery(orpc.analytics.summary.queryOptions());
	const months = summaryQ.data?.months ?? [];

	const txnQ = useQuery(
		orpc.analytics.transactions.queryOptions({
			input: {
				search: search || undefined,
				month: month || undefined,
				kind: kind || undefined,
				uncategorizedOnly: uncatOnly || undefined,
				dateFrom: dateFrom || undefined,
				dateTo: dateTo || undefined,
				limit: PAGE,
				offset,
			},
		}),
	);
	const rows = (txnQ.data?.transactions ?? []) as Txn[];
	const openTxn = sheetTxn
		? (rows.find((r) => r.txnId === sheetTxn.txnId) ?? sheetTxn)
		: null;
	const catLabel = new Map((catsQ.data ?? []).map((c) => [c.key, c.label]));
	const total = txnQ.data?.total ?? 0;
	const pending = txnQ.data?.pendingRetag ?? 0;

	const retag = useMutation({
		mutationFn: () => client.ingest.retag(),
		onSuccess: (r) => {
			haptics.saved();
			toast.success(
				`Re-tagged — ${r.uncategorized} of ${r.transactions} still uncategorised.`,
			);
			qc.invalidateQueries();
		},
		onError: (e) => toast.error(e.message),
	});

	// Export the current filtered view (all matching rows, not just this page) as CSV.
	const [exporting, setExporting] = useState(false);
	const exportCsv = async () => {
		setExporting(true);
		try {
			const { csv, rows: n } = await client.export.transactions({
				search: search || undefined,
				month: month || undefined,
				kind: kind || undefined,
				uncategorizedOnly: uncatOnly || undefined,
				dateFrom: dateFrom || undefined,
				dateTo: dateTo || undefined,
			});
			if (n === 0) {
				toast.info("No transactions match these filters.");
				return;
			}
			downloadCsv(csvFilename("transactions"), csv);
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setExporting(false);
		}
	};

	const createRule = (t: Txn) => {
		setRulePrefill({ pattern: t.narration, assignCategoryKey: t.categoryKey });
		setTab("rules");
	};

	const onFilter =
		<T,>(setter: (v: T) => void) =>
		(v: T) => {
			setter(v);
			setOffset(0);
		};

	return (
		<main className="h-full overflow-y-auto">
			<div className="mx-auto flex max-w-4xl flex-col gap-6 px-5 pt-3 pb-8 max-md:gap-5 sm:px-8 sm:py-14">
				<header className="flex flex-wrap items-start justify-between gap-3 max-md:flex-nowrap max-md:items-center">
					<div className="flex flex-col gap-1">
						<h1 className="font-display font-medium text-3xl tracking-tight">
							Transactions
						</h1>
						<p className="max-w-xl text-muted-foreground max-md:hidden">
							Every statement row, newest first. Fix a category inline or split
							a mixed payout — then re-tag to apply it to your reports.
						</p>
					</div>
					<PhoneTxnActions
						exporting={exporting}
						onExport={exportCsv}
						retagging={retag.isPending}
						onRetag={() => retag.mutate()}
					/>
					<div className="flex flex-wrap items-center gap-2 max-md:hidden">
						<Button
							size="sm"
							variant="outline"
							onClick={() => void exportCsv()}
							disabled={exporting}
							title="Download the current filtered view as CSV"
						>
							{exporting ? "Preparing…" : "Export CSV"}
						</Button>
						{/* Always-available re-tag — inline edits bump `pending` (shown in the banner below), but rule
						    changes don't, so this button is the way to re-run every transaction through the rules. */}
						{pending === 0 && (
							<Button
								size="sm"
								variant="outline"
								onClick={() => retag.mutate()}
								disabled={retag.isPending}
								title="Re-run every transaction through the current rules"
							>
								<RefreshCw
									className={`size-4 ${retag.isPending ? "animate-spin" : ""}`}
								/>
								{retag.isPending ? "Re-tagging…" : "Re-tag"}
							</Button>
						)}
					</div>
				</header>

				{pending > 0 && (
					<RetagBanner
						pending={pending}
						busy={retag.isPending}
						onRetag={() => retag.mutate()}
					/>
				)}

				<TabBar tabs={TXN_TABS} active={tab} onSelect={setTab} />

				{tab === "rules" && (
					<RulesTab
						prefill={rulePrefill}
						onConsumePrefill={() => setRulePrefill(null)}
					/>
				)}
				{tab === "categories" && <CategoriesTab />}

				{tab === "transactions" && phone && (
					<>
						<PhoneTxnFilters
							search={searchInput}
							onSearch={setSearchInput}
							month={month}
							onMonth={onFilter(setMonth)}
							months={months}
							kind={kind}
							onKind={onFilter(setKind)}
							uncatOnly={uncatOnly}
							onUncatOnly={onFilter(setUncatOnly)}
							uncategorized={summaryQ.data?.uncategorized ?? 0}
							onRange={(r) => {
								setDateFrom(r.from ?? "");
								setDateTo(r.to ?? "");
								setOffset(0);
							}}
						/>
						<section className="-mt-2 flex flex-col">
							{txnQ.isLoading && (
								<p className="py-6 text-muted-foreground text-sm">Loading…</p>
							)}
							{!txnQ.isLoading && rows.length === 0 && (
								<p className="py-6 text-muted-foreground text-sm">
									No transactions match these filters.
								</p>
							)}
							<DayGroupedTxnList
								rows={rows.map((t) => ({
									id: t.txnId,
									date: t.date,
									narration: t.narration,
									amount: t.amount,
									kind: t.kind,
									categoryKey: t.categoryKey,
									categoryLabel: catLabel.get(t.categoryKey) ?? t.categoryKey,
									pending: isRowPending(t),
									note:
										t.manualSplitCount > 0
											? `Split · ${t.manualSplitCount} lines`
											: undefined,
								}))}
								formatAmount={(abs) => wholeOrPaise(abs, formatINR)}
								selectedId={sheetOpen ? openTxn?.txnId : null}
								onSelect={(id) => {
									const t = rows.find((r) => r.txnId === id);
									if (!t) return;
									setSheetTxn(t);
									setSheetOpen(true);
								}}
							/>
						</section>
						<TxnSheet
							txn={openTxn}
							open={sheetOpen}
							onOpenChange={setSheetOpen}
							onChanged={() => qc.invalidateQueries()}
							onCreateRule={(t) => {
								setSheetOpen(false);
								createRule(t);
							}}
						/>
					</>
				)}

				{tab === "transactions" && (
					<>
						{!phone && (
							<>
								<Filters
									search={searchInput}
									onSearch={setSearchInput}
									month={month}
									onMonth={onFilter(setMonth)}
									months={months}
									kind={kind}
									onKind={onFilter(setKind)}
									uncatOnly={uncatOnly}
									onUncatOnly={onFilter(setUncatOnly)}
									uncategorized={summaryQ.data?.uncategorized ?? 0}
									onDateFrom={onFilter(setDateFrom)}
									onDateTo={onFilter(setDateTo)}
								/>

								<div className="-mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-xs">
									{KIND_ORDER.map((k) => (
										<span key={k} className="flex items-center gap-1.5">
											<span
												className="size-2 rounded-full"
												style={{ background: KIND_COLOR[k] }}
											/>
											{KIND_LABEL[k]}
										</span>
									))}
								</div>

								<section className="flex flex-col">
									{txnQ.isLoading && (
										<p className="py-6 text-muted-foreground text-sm">
											Loading…
										</p>
									)}
									{!txnQ.isLoading && rows.length === 0 && (
										<p className="py-6 text-muted-foreground text-sm">
											No transactions match these filters.
										</p>
									)}
									<ul className="flex flex-col">
										{rows.map((t) => (
											<TxnRow
												key={t.txnId}
												txn={t}
												open={splitOpen === t.txnId}
												onToggleSplit={() =>
													setSplitOpen((cur) =>
														cur === t.txnId ? null : t.txnId,
													)
												}
												onChanged={() => qc.invalidateQueries()}
												onCreateRule={() => createRule(t)}
											/>
										))}
									</ul>
								</section>
							</>
						)}

						<Pager
							offset={offset}
							page={PAGE}
							total={total}
							shown={rows.length}
							onPrev={() => setOffset((o) => Math.max(0, o - PAGE))}
							onNext={() => setOffset((o) => o + PAGE)}
						/>
					</>
				)}
			</div>
		</main>
	);
}

// ── re-tag banner ─────────────────────────────────────────────────────────────────────────────────────
function RetagBanner({
	pending,
	busy,
	onRetag,
}: {
	pending: number;
	busy: boolean;
	onRetag: () => void;
}) {
	return (
		<div
			className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
			style={{
				borderColor: tint(PENDING_C, 40),
				background: tint(PENDING_C, 8),
			}}
		>
			<p className="text-sm">
				<span className="tnum font-medium" style={{ color: PENDING_C }}>
					{pending}
				</span>{" "}
				categorisation change{pending === 1 ? "" : "s"} not yet applied to your
				reports (Spending, Reconcile, the KPI).
			</p>
			<Button size="sm" onClick={onRetag} disabled={busy}>
				<RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
				{busy ? "Re-tagging…" : "Re-tag now"}
			</Button>
		</div>
	);
}

// ── filters ───────────────────────────────────────────────────────────────────────────────────────────
function Filters({
	search,
	onSearch,
	month,
	onMonth,
	months,
	kind,
	onKind,
	uncatOnly,
	onUncatOnly,
	uncategorized,
	onDateFrom,
	onDateTo,
}: {
	search: string;
	onSearch: (v: string) => void;
	month: string;
	onMonth: (v: string) => void;
	months: string[];
	kind: string;
	onKind: (v: string) => void;
	uncatOnly: boolean;
	onUncatOnly: (v: boolean) => void;
	uncategorized: number;
	onDateFrom: (v: string) => void;
	onDateTo: (v: string) => void;
}) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			<div className="relative min-w-[12rem] flex-1">
				<Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				<input
					value={search}
					onChange={(e) => onSearch(e.target.value)}
					placeholder="Search narration…"
					className="h-9 w-full rounded-md border border-input bg-background pr-3 pl-8 text-foreground text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
				/>
			</div>
			<Select
				aria-label="Month"
				value={month}
				onValueChange={onMonth}
				options={[
					{ value: "", label: "All months" },
					...months.map((m) => ({ value: m, label: m })),
				]}
				className="h-9 w-auto min-w-[8rem] rounded-md"
			/>
			<Select
				aria-label="Kind"
				value={kind}
				onValueChange={onKind}
				options={[
					{ value: "", label: "All kinds" },
					...KIND_ORDER.map((k) => ({ value: k, label: KIND_LABEL[k] })),
				]}
				className="h-9 w-auto min-w-[8rem] rounded-md"
			/>
			<button
				type="button"
				onClick={() => onUncatOnly(!uncatOnly)}
				className={`flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors ${
					uncatOnly
						? "border-ring bg-secondary text-secondary-foreground"
						: "border-input bg-background text-muted-foreground hover:text-foreground"
				}`}
			>
				Uncategorised
				<span className="tnum text-xs opacity-70">{uncategorized}</span>
			</button>
			<DateRangePicker
				defaultPreset="all"
				onChange={(r) => {
					onDateFrom(r.from ?? "");
					onDateTo(r.to ?? "");
				}}
			/>
		</div>
	);
}

// ── one transaction ───────────────────────────────────────────────────────────────────────────────────
function TxnRow({
	txn,
	open,
	onToggleSplit,
	onChanged,
	onCreateRule,
}: {
	txn: Txn;
	open: boolean;
	onToggleSplit: () => void;
	onChanged: () => void;
	onCreateRule: () => void;
}) {
	const { formatINR } = useFormat();
	const catsQ = useCategories();
	const groups = groupByKind(catsQ.data ?? [], {
		activeOnly: true,
		keepKey: txn.categoryKey,
	});
	const setOverride = useMutation(orpc.overrides.set.mutationOptions());
	const clearOverride = useMutation(orpc.overrides.clear.mutationOptions());
	const isSplit = txn.manualSplitCount > 0;
	// an edit that DuckDB hasn't baked yet (drives the amber dot)
	const rowPending = isRowPending(txn);
	const credit = txn.amount >= 0;

	const busy = setOverride.isPending || clearOverride.isPending;
	const apply = (categoryKey: string) =>
		setOverride.mutate(
			{ txnId: txn.txnId, categoryKey },
			{ onSuccess: onChanged, onError: (e) => toast.error(e.message) },
		);
	const revert = () =>
		clearOverride.mutate(
			{ txnId: txn.txnId },
			{ onSuccess: onChanged, onError: (e) => toast.error(e.message) },
		);

	return (
		<li className="border-border border-b">
			<div className="flex items-center gap-3 py-3">
				<span
					className="size-1.5 shrink-0 rounded-full"
					style={{ background: rowPending ? PENDING_C : "transparent" }}
					title={rowPending ? "Edited — re-tag to apply" : undefined}
				/>
				<div className="tnum w-14 shrink-0 text-muted-foreground text-xs">
					{formatDate(txn.date)}
				</div>
				<div className="min-w-0 flex-1">
					<p className="line-clamp-2 text-sm" title={txn.narration}>
						{txn.narration}
					</p>
				</div>
				<span
					className="tnum w-24 shrink-0 text-right text-sm"
					style={{ color: credit ? IN : undefined }}
				>
					{credit ? "+" : "−"}
					{formatINR(Math.abs(txn.amount), { decimals: true })}
				</span>
				<div className="flex w-56 shrink-0 items-center justify-end gap-1">
					{isSplit ? (
						<span
							className="flex-1 truncate rounded-md px-2 py-1.5 text-xs"
							style={{ color: PENDING_C, background: tint(PENDING_C, 12) }}
						>
							Split · {txn.manualSplitCount} lines
						</span>
					) : (
						<Select
							aria-label="Category"
							value={txn.categoryKey}
							disabled={busy}
							onValueChange={apply}
							groups={groups.map((g) => ({
								label: g.label,
								color: kindColor(g.kind),
								options: g.cats.map((c) => ({ value: c.key, label: c.label })),
							}))}
							className="min-w-0 flex-1 rounded-md font-medium"
							style={{
								color: kindColor(txn.kind),
								borderColor: tint(kindColor(txn.kind), 35),
								background: tint(kindColor(txn.kind), 7),
							}}
						/>
					)}
					{txn.hasOverride && !isSplit && (
						<button
							type="button"
							title="Revert to the rule-assigned category"
							onClick={revert}
							disabled={busy}
							className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-50"
						>
							<RotateCcw className="size-3.5" />
						</button>
					)}
					<button
						type="button"
						title="Create a rule from this narration"
						onClick={onCreateRule}
						className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
					>
						<ListPlus className="size-3.5" />
					</button>
					<button
						type="button"
						title={isSplit ? "Edit split" : "Split into lines"}
						onClick={onToggleSplit}
						className={`grid size-8 shrink-0 place-items-center rounded-md hover:bg-secondary/60 hover:text-foreground ${
							open || isSplit ? "text-foreground" : "text-muted-foreground"
						}`}
					>
						<Scissors className="size-3.5" />
					</button>
				</div>
			</div>
			{open && (
				<SplitEditor txn={txn} onClose={onToggleSplit} onChanged={onChanged} />
			)}
		</li>
	);
}

// ── pager ─────────────────────────────────────────────────────────────────────────────────────────────
function Pager({
	offset,
	page,
	total,
	shown,
	onPrev,
	onNext,
}: {
	offset: number;
	page: number;
	total: number;
	shown: number;
	onPrev: () => void;
	onNext: () => void;
}): ReactNode {
	if (total === 0) return null;
	const from = offset + 1;
	const to = offset + shown;
	return (
		<div className="flex items-center justify-between text-muted-foreground text-sm">
			<span className="tnum">
				{from}–{to} of {total}
			</span>
			<div className="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={onPrev}
					disabled={offset === 0}
					className="max-md:h-11 max-md:px-4"
				>
					<ChevronLeft className="size-4" /> Prev
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={onNext}
					disabled={offset + page >= total}
					className="max-md:h-11 max-md:px-4"
				>
					Next <ChevronRight className="size-4" />
				</Button>
			</div>
		</div>
	);
}
