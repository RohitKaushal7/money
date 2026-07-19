import { CATEGORIES, type Kind } from "@money/shared";
import { Button } from "@money/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	ChevronLeft,
	ChevronRight,
	Plus,
	RefreshCw,
	RotateCcw,
	Scissors,
	Search,
	Trash2,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { formatDay, formatINR } from "@/lib/format";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/transactions")({
	component: TransactionsPage,
});

const PAGE = 100;
const IN = "var(--covered)";
const PENDING_C = "oklch(0.74 0.15 66)"; // amber — an edit not yet baked
const tint = (c: string, pct: number) =>
	`color-mix(in oklab, ${c} ${pct}%, transparent)`;

const KIND_LABEL: Record<Kind, string> = {
	passive_income: "Passive income",
	active_income: "Active income",
	expense: "Expense",
	investment: "Investment",
	transfer: "Transfer",
};
const KIND_ORDER: Kind[] = [
	"passive_income",
	"active_income",
	"expense",
	"investment",
	"transfer",
];
const CAT_GROUPS = KIND_ORDER.map((kind) => ({
	kind,
	label: KIND_LABEL[kind],
	cats: CATEGORIES.filter((c) => c.kind === kind),
}));

/** One colour per kind, so the category column reads at a glance. Tuned to the warm "data journal" palette. */
const KIND_COLOR: Record<Kind, string> = {
	passive_income: "var(--covered)", // green — the money that buys freedom
	active_income: "oklch(0.66 0.12 235)", // blue — income, but earned
	expense: "var(--uncovered)", // red — the denominator
	investment: "oklch(0.64 0.15 300)", // violet — asset moves
	transfer: "var(--muted-foreground)", // neutral — excluded from the KPI
};
const kindColor = (kind: string) =>
	KIND_COLOR[kind as Kind] ?? "var(--muted-foreground)";

/** contribution/coupon/… tags that link a manual split line to an investment cashflow (spec §4). */
const CASHFLOW_TYPES = [
	{ value: "", label: "— flow —" },
	{ value: "coupon", label: "Coupon (interest)" },
	{ value: "redemption", label: "Principal returned" },
	{ value: "dividend", label: "Dividend" },
	{ value: "contribution", label: "Contribution" },
	{ value: "maturity", label: "Maturity" },
];

interface Txn {
	txnId: string;
	date: string;
	narration: string;
	amount: number;
	balance: number;
	bakedCategoryKey: string;
	categoryKey: string;
	kind: string;
	hasOverride: boolean;
	overrideNote: string | null;
	manualSplitCount: number;
}

const SELECT_CLASS =
	"h-9 rounded-md border border-input bg-background px-2 text-foreground text-sm shadow-xs outline-none [color-scheme:light] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:[color-scheme:dark]";

function TransactionsPage() {
	const qc = useQueryClient();
	const [searchInput, setSearchInput] = useState("");
	const [search, setSearch] = useState("");
	const [month, setMonth] = useState("");
	const [kind, setKind] = useState("");
	const [uncatOnly, setUncatOnly] = useState(false);
	const [offset, setOffset] = useState(0);
	const [splitOpen, setSplitOpen] = useState<string | null>(null);

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
				limit: PAGE,
				offset,
			},
		}),
	);
	const rows = (txnQ.data?.transactions ?? []) as Txn[];
	const total = txnQ.data?.total ?? 0;
	const pending = txnQ.data?.pendingRetag ?? 0;

	const retag = useMutation({
		mutationFn: () => client.ingest.retag(),
		onSuccess: (r) => {
			toast.success(
				`Re-tagged — ${r.uncategorized} of ${r.transactions} still uncategorised.`,
			);
			qc.invalidateQueries();
		},
		onError: (e) => toast.error(e.message),
	});

	const onFilter =
		<T,>(setter: (v: T) => void) =>
		(v: T) => {
			setter(v);
			setOffset(0);
		};

	return (
		<main className="h-full overflow-y-auto">
			<div className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-10 sm:px-8 sm:py-14">
				<header className="flex flex-col gap-1">
					<h1 className="font-display font-medium text-3xl tracking-tight">
						Transactions
					</h1>
					<p className="text-muted-foreground">
						Every statement row, uncategorised first. Fix a category inline or
						split a mixed payout — then re-tag to apply it to your reports.
					</p>
				</header>

				{pending > 0 && (
					<RetagBanner
						pending={pending}
						busy={retag.isPending}
						onRetag={() => retag.mutate()}
					/>
				)}

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
						<p className="py-6 text-muted-foreground text-sm">Loading…</p>
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
									setSplitOpen((cur) => (cur === t.txnId ? null : t.txnId))
								}
								onChanged={() => qc.invalidateQueries()}
							/>
						))}
					</ul>
				</section>

				<Pager
					offset={offset}
					page={PAGE}
					total={total}
					shown={rows.length}
					onPrev={() => setOffset((o) => Math.max(0, o - PAGE))}
					onNext={() => setOffset((o) => o + PAGE)}
				/>
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
			<select
				value={month}
				onChange={(e) => onMonth(e.target.value)}
				className={SELECT_CLASS}
			>
				<option value="">All months</option>
				{months.map((m) => (
					<option
						key={m}
						value={m}
						className="bg-popover text-popover-foreground"
					>
						{m}
					</option>
				))}
			</select>
			<select
				value={kind}
				onChange={(e) => onKind(e.target.value)}
				className={SELECT_CLASS}
			>
				<option value="">All kinds</option>
				{KIND_ORDER.map((k) => (
					<option
						key={k}
						value={k}
						className="bg-popover text-popover-foreground"
					>
						{KIND_LABEL[k]}
					</option>
				))}
			</select>
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
		</div>
	);
}

// ── one transaction ───────────────────────────────────────────────────────────────────────────────────
function TxnRow({
	txn,
	open,
	onToggleSplit,
	onChanged,
}: {
	txn: Txn;
	open: boolean;
	onToggleSplit: () => void;
	onChanged: () => void;
}) {
	const setOverride = useMutation(orpc.overrides.set.mutationOptions());
	const clearOverride = useMutation(orpc.overrides.clear.mutationOptions());
	const isSplit = txn.manualSplitCount > 0;
	// an edit that DuckDB hasn't baked yet (drives the amber dot)
	const rowPending = isSplit
		? true
		: txn.hasOverride && txn.categoryKey !== txn.bakedCategoryKey;
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
					className="mt-0.5 size-1.5 shrink-0 rounded-full"
					style={{ background: rowPending ? PENDING_C : "transparent" }}
					title={rowPending ? "Edited — re-tag to apply" : undefined}
				/>
				<div className="tnum w-10 shrink-0 text-muted-foreground text-xs">
					{formatDay(txn.date)}
				</div>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm" title={txn.narration}>
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
						<select
							value={txn.categoryKey}
							disabled={busy}
							onChange={(e) => apply(e.target.value)}
							className={`${SELECT_CLASS} min-w-0 flex-1 font-medium`}
							style={{
								color: kindColor(txn.kind),
								borderColor: tint(kindColor(txn.kind), 35),
								background: tint(kindColor(txn.kind), 7),
							}}
						>
							{CAT_GROUPS.map((g) => (
								<optgroup key={g.kind} label={g.label}>
									{g.cats.map((c) => (
										<option
											key={c.key}
											value={c.key}
											className="bg-popover text-popover-foreground"
										>
											{c.label}
										</option>
									))}
								</optgroup>
							))}
						</select>
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

// ── split editor ──────────────────────────────────────────────────────────────────────────────────────
interface Line {
	amount: string;
	categoryKey: string;
	cashflowType: string;
}

function SplitEditor({
	txn,
	onClose,
	onChanged,
}: {
	txn: Txn;
	onClose: () => void;
	onChanged: () => void;
}) {
	const existingQ = useQuery(
		orpc.splits.get.queryOptions({ input: { txnId: txn.txnId } }),
	);
	const setSplit = useMutation(orpc.splits.set.mutationOptions());
	const clearSplit = useMutation(orpc.splits.clear.mutationOptions());
	const [lines, setLines] = useState<Line[] | null>(null);

	// seed the editor once the existing lines load (or default to the whole amount on one line)
	useEffect(() => {
		if (lines != null || existingQ.data == null) return;
		if (existingQ.data.length > 0) {
			setLines(
				existingQ.data.map((l) => ({
					amount: String(l.amount),
					categoryKey: l.categoryKey,
					cashflowType: l.cashflowType ?? "",
				})),
			);
		} else {
			setLines([
				{
					amount: txn.amount.toFixed(2),
					categoryKey:
						txn.categoryKey === "uncategorized" ? "" : txn.categoryKey,
					cashflowType: "",
				},
			]);
		}
	}, [existingQ.data, lines, txn.amount, txn.categoryKey]);

	if (lines == null) {
		return (
			<div className="px-6 pb-4 text-muted-foreground text-xs">Loading…</div>
		);
	}

	const sum = lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);
	const remainder = txn.amount - sum;
	const balanced = Math.abs(remainder) < 0.01;
	const allTagged = lines.every((l) => l.categoryKey !== "");
	const canSave = balanced && allTagged && lines.length >= 1;

	const update = (i: number, patch: Partial<Line>) =>
		setLines((ls) =>
			(ls ?? []).map((l, j) => (j === i ? { ...l, ...patch } : l)),
		);
	const add = () =>
		setLines((ls) => [
			...(ls ?? []),
			{ amount: remainder.toFixed(2), categoryKey: "", cashflowType: "" },
		]);
	const remove = (i: number) =>
		setLines((ls) => (ls ?? []).filter((_, j) => j !== i));

	const save = () =>
		setSplit.mutate(
			{
				txnId: txn.txnId,
				lines: lines.map((l) => ({
					amount: Number(l.amount),
					categoryKey: l.categoryKey,
					cashflowType: l.cashflowType || undefined,
				})),
			},
			{
				onSuccess: () => {
					toast.success("Split saved — re-tag to apply.");
					onChanged();
					onClose();
				},
				onError: (e) => toast.error(e.message),
			},
		);
	const clear = () =>
		clearSplit.mutate(
			{ txnId: txn.txnId },
			{
				onSuccess: () => {
					toast.success("Split removed.");
					onChanged();
					onClose();
				},
				onError: (e) => toast.error(e.message),
			},
		);

	const busy = setSplit.isPending || clearSplit.isPending;

	return (
		<div className="mb-3 ml-6 flex flex-col gap-3 rounded-lg border border-border bg-card/40 px-4 py-4">
			<div className="flex items-center justify-between">
				<p className="font-medium text-sm">
					Split {formatINR(txn.amount, { decimals: true })} into lines
				</p>
				<button
					type="button"
					onClick={onClose}
					className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary/60"
				>
					<X className="size-4" />
				</button>
			</div>

			<div className="flex flex-col gap-2">
				{lines.map((l, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: lines are a positional, editable list
					<div key={i} className="flex flex-wrap items-center gap-2">
						<input
							type="number"
							step="0.01"
							value={l.amount}
							onChange={(e) => update(i, { amount: e.target.value })}
							className="tnum h-9 w-28 rounded-md border border-input bg-background px-2 text-right text-foreground text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
						/>
						<select
							value={l.categoryKey}
							onChange={(e) => update(i, { categoryKey: e.target.value })}
							className={`${SELECT_CLASS} min-w-[10rem] flex-1`}
						>
							<option value="">— category —</option>
							{CAT_GROUPS.map((g) => (
								<optgroup key={g.kind} label={g.label}>
									{g.cats.map((c) => (
										<option
											key={c.key}
											value={c.key}
											className="bg-popover text-popover-foreground"
										>
											{c.label}
										</option>
									))}
								</optgroup>
							))}
						</select>
						<select
							value={l.cashflowType}
							onChange={(e) => update(i, { cashflowType: e.target.value })}
							className={`${SELECT_CLASS} w-40`}
						>
							{CASHFLOW_TYPES.map((c) => (
								<option
									key={c.value}
									value={c.value}
									className="bg-popover text-popover-foreground"
								>
									{c.label}
								</option>
							))}
						</select>
						<button
							type="button"
							onClick={() => remove(i)}
							disabled={lines.length === 1}
							className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-40"
						>
							<Trash2 className="size-3.5" />
						</button>
					</div>
				))}
			</div>

			<div className="flex items-center justify-between">
				<Button variant="ghost" size="sm" onClick={add}>
					<Plus className="size-4" /> Add line
				</Button>
				<p className="tnum text-xs">
					<span className="text-muted-foreground">Remainder </span>
					<span style={{ color: balanced ? IN : PENDING_C }}>
						{formatINR(remainder, { decimals: true })}
					</span>
				</p>
			</div>

			<div className="flex items-center justify-end gap-2">
				{existingQ.data && existingQ.data.length > 0 && (
					<Button
						variant="ghost"
						size="sm"
						onClick={clear}
						disabled={busy}
						className="mr-auto text-muted-foreground"
					>
						<Trash2 className="size-4" /> Remove split
					</Button>
				)}
				<Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
					Cancel
				</Button>
				<Button size="sm" onClick={save} disabled={!canSave || busy}>
					{busy ? "Saving…" : "Save split"}
				</Button>
			</div>
			{!balanced && (
				<p className="text-right text-muted-foreground text-xs">
					Lines must sum to {formatINR(txn.amount, { decimals: true })}.
				</p>
			)}
		</div>
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
				>
					<ChevronLeft className="size-4" /> Prev
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={onNext}
					disabled={offset + page >= total}
				>
					Next <ChevronRight className="size-4" />
				</Button>
			</div>
		</div>
	);
}
