import { Sheet, SheetRow } from "@money/ui/components/sheet";
import { useMutation } from "@tanstack/react-query";
import {
	ChevronDown,
	ChevronRight,
	Download,
	Ellipsis,
	ListPlus,
	RefreshCw,
	RotateCcw,
	Scissors,
	Search,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CategoryPicker } from "@/components/categories/category-picker";
import { DateInput } from "@/components/date-input";
import {
	type DateRange,
	type RangePreset,
	resolveRange,
} from "@/components/date-range-picker";
import { KindTile, wholeOrPaise } from "@/components/txn-list";
import {
	KIND_COLOR,
	KIND_LABEL,
	KIND_ORDER,
	kindColor,
	useCategories,
} from "@/lib/categories";
import { formatDate, useFormat } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { cleanMerchant } from "@/lib/merchant";
import { orpc } from "@/utils/orpc";
import {
	IN,
	isRowPending,
	PENDING_C,
	SplitEditor,
	type Txn,
	tint,
} from "./split-editor";

/*
 * The phone's Transactions: one search field and a row of filter chips above a day-grouped list, and a sheet
 * per transaction for everything the desktop row does inline (category, revert, rule, split).
 */

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];
/** "2026-07" → "July 2026" */
const monthName = (ym: string) => {
	const [y, m] = ym.split("-");
	return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
};

const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
	{ key: "all", label: "All time" },
	{ key: "this-month", label: "This month" },
	{ key: "this-quarter", label: "This quarter" },
	{ key: "last-12m", label: "Last 12 months" },
	{ key: "last-24m", label: "Last 24 months" },
	{ key: "this-fy", label: "This FY" },
	{ key: "last-fy", label: "Last FY" },
	{ key: "custom", label: "Custom range" },
];

// ── filters ───────────────────────────────────────────────────────────────────────────────────────────

/** A filter chip: a pill, filled while its filter is narrowing the list. */
function Chip({
	active,
	onClick,
	children,
	chevron = true,
}: {
	active: boolean;
	onClick: () => void;
	children: ReactNode;
	chevron?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={`pressable flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm transition-colors ${
				active
					? "border-transparent bg-foreground text-background"
					: "border-border bg-card text-foreground"
			}`}
		>
			{children}
			{chevron && <ChevronDown className="size-4 opacity-60" />}
		</button>
	);
}

export function PhoneTxnFilters({
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
	onRange,
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
	onRange: (r: DateRange) => void;
}) {
	const [open, setOpen] = useState<null | "month" | "kind" | "range">(null);
	const [preset, setPreset] = useState<RangePreset>("all");
	const [from, setFrom] = useState<string | null>("");
	const [to, setTo] = useState<string | null>("");
	// a stable ref, as in DateRangePicker, so the emit doesn't depend on the caller's callback identity
	const onRangeRef = useRef(onRange);
	onRangeRef.current = onRange;
	useEffect(() => {
		onRangeRef.current(
			resolveRange(preset, from ?? undefined, to ?? undefined),
		);
	}, [preset, from, to]);

	const close = () => setOpen(null);
	const pick = (apply: () => void) => {
		haptics.selected();
		apply();
		close();
	};
	const rangeLabel =
		preset === "custom" && (from || to)
			? `${from ? formatDate(from) : "…"} – ${to ? formatDate(to) : "…"}`
			: (RANGE_PRESETS.find((p) => p.key === preset)?.label ?? "Range");

	return (
		<div className="flex flex-col gap-3">
			<label className="flex h-11 items-center gap-2 rounded-full bg-secondary pr-1 pl-4">
				<Search className="size-4 shrink-0 text-muted-foreground" />
				<input
					type="search"
					value={search}
					onChange={(e) => onSearch(e.target.value)}
					placeholder="Search narration"
					enterKeyHint="search"
					aria-label="Search narration"
					className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
				/>
				{search && (
					<button
						type="button"
						aria-label="Clear search"
						onClick={() => onSearch("")}
						className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground active:bg-background/60"
					>
						<X className="size-4" />
					</button>
				)}
			</label>

			{/* the chips scroll sideways rather than wrap, bleeding to the screen edge so the cut-off chip says "more" */}
			<div className="scrollbar-none -mx-5 flex gap-2 overflow-x-auto px-5">
				<Chip active={month !== ""} onClick={() => setOpen("month")}>
					{month ? monthName(month) : "Month"}
				</Chip>
				<Chip active={kind !== ""} onClick={() => setOpen("kind")}>
					{kind ? (
						<>
							<span
								className="size-2 rounded-full"
								style={{ background: kindColor(kind) }}
							/>
							{KIND_LABEL[kind as keyof typeof KIND_LABEL] ?? kind}
						</>
					) : (
						"Kind"
					)}
				</Chip>
				<Chip
					active={uncatOnly}
					chevron={false}
					onClick={() => {
						haptics.selected();
						onUncatOnly(!uncatOnly);
					}}
				>
					Uncategorised
					<span className="tnum opacity-70">{uncategorized}</span>
				</Chip>
				<Chip active={preset !== "all"} onClick={() => setOpen("range")}>
					{rangeLabel}
				</Chip>
			</div>

			<Sheet
				open={open === "month"}
				onOpenChange={(o) => !o && close()}
				title="Month"
			>
				<div className="flex flex-col">
					<SheetRow
						selected={month === ""}
						onClick={() => pick(() => onMonth(""))}
					>
						All months
					</SheetRow>
					{[...months].reverse().map((m) => (
						<SheetRow
							key={m}
							selected={month === m}
							onClick={() => pick(() => onMonth(m))}
						>
							{monthName(m)}
						</SheetRow>
					))}
				</div>
			</Sheet>

			{/* the colour legend lives here on a phone: this is where the colours are chosen */}
			<Sheet
				open={open === "kind"}
				onOpenChange={(o) => !o && close()}
				title="Kind"
				description="Every category rolls up to one of these. The colour marks it in the list."
			>
				<div className="flex flex-col">
					<SheetRow
						selected={kind === ""}
						onClick={() => pick(() => onKind(""))}
					>
						All kinds
					</SheetRow>
					{KIND_ORDER.map((k) => (
						<SheetRow
							key={k}
							selected={kind === k}
							onClick={() => pick(() => onKind(k))}
						>
							<span className="inline-flex items-center gap-3">
								<span
									className="size-2.5 shrink-0 rounded-full"
									style={{ background: KIND_COLOR[k] }}
								/>
								{KIND_LABEL[k]}
							</span>
						</SheetRow>
					))}
				</div>
			</Sheet>

			<Sheet
				open={open === "range"}
				onOpenChange={(o) => !o && close()}
				title="Date range"
			>
				<div className="flex flex-col">
					{RANGE_PRESETS.map((p) => (
						<SheetRow
							key={p.key}
							selected={preset === p.key}
							onClick={() => {
								haptics.selected();
								setPreset(p.key);
								// custom stays open for the two dates; a preset is the whole answer
								if (p.key !== "custom") close();
							}}
						>
							{p.label}
						</SheetRow>
					))}
				</div>
				{preset === "custom" && (
					<div className="grid grid-cols-2 gap-3 pt-1">
						<label
							htmlFor="txn-range-from"
							className="flex flex-col gap-1.5 text-muted-foreground text-sm"
						>
							From
							<DateInput
								id="txn-range-from"
								aria-label="From date"
								value={from}
								max={to || undefined}
								onChange={setFrom}
								inputClassName="h-11 rounded-xl text-base"
							/>
						</label>
						<label
							htmlFor="txn-range-to"
							className="flex flex-col gap-1.5 text-muted-foreground text-sm"
						>
							To
							<DateInput
								id="txn-range-to"
								aria-label="To date"
								value={to}
								min={from || undefined}
								onChange={setTo}
								inputClassName="h-11 rounded-xl text-base"
							/>
						</label>
					</div>
				)}
			</Sheet>
		</div>
	);
}

// ── page actions (⋯ beside the title) ──────────────────────────────────────────────────────────────────

export function PhoneTxnActions({
	exporting,
	onExport,
	retagging,
	onRetag,
}: {
	exporting: boolean;
	onExport: () => Promise<void>;
	retagging: boolean;
	onRetag: () => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button
				type="button"
				aria-label="More actions"
				onClick={() => setOpen(true)}
				className="pressable grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card text-foreground md:hidden"
			>
				<Ellipsis className="size-5" />
			</button>
			<Sheet open={open} onOpenChange={setOpen} title="Transactions">
				<div className="flex flex-col">
					<SheetRow
						disabled={exporting}
						onClick={() => {
							void onExport().then(() => setOpen(false));
						}}
						trailing={
							exporting ? (
								<span className="text-muted-foreground text-sm">
									Preparing…
								</span>
							) : undefined
						}
					>
						<span className="inline-flex items-center gap-3">
							<Download className="size-5 text-muted-foreground" />
							Export CSV
						</span>
					</SheetRow>
					<SheetRow
						disabled={retagging}
						onClick={() => {
							onRetag();
							setOpen(false);
						}}
					>
						<span className="inline-flex items-center gap-3">
							<RefreshCw
								className={`size-5 text-muted-foreground ${retagging ? "animate-spin" : ""}`}
							/>
							{retagging ? "Re-tagging…" : "Re-tag every transaction"}
						</span>
					</SheetRow>
				</div>
				<p className="text-muted-foreground text-sm">
					Export downloads the list as filtered. Re-tag runs every transaction
					through your current rules.
				</p>
			</Sheet>
		</>
	);
}

// ── one transaction's sheet ─────────────────────────────────────────────────────────────────────────────

const LONG_WEEKDAY = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];
/** "2026-07-26" → "Sunday, 26 July 2026" */
function longDate(iso: string): string {
	const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
	if (!y || !m || !d) return formatDate(iso);
	const day = new Date(y, m - 1, d, 12).getDay();
	return `${LONG_WEEKDAY[day]}, ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

export function TxnSheet({
	txn,
	open,
	onOpenChange,
	onChanged,
	onCreateRule,
}: {
	txn: Txn | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onChanged: () => void;
	onCreateRule: (txn: Txn) => void;
}) {
	const { formatINR } = useFormat();
	const catsQ = useCategories();
	const [view, setView] = useState<"detail" | "category" | "split">("detail");
	const setOverride = useMutation(orpc.overrides.set.mutationOptions());
	const clearOverride = useMutation(orpc.overrides.clear.mutationOptions());

	// every opening starts on the details, whatever the last transaction was left on
	const txnId = txn?.txnId;
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset when a different transaction opens
	useEffect(() => {
		setView("detail");
	}, [txnId, open]);

	if (!txn) return null;

	const isSplit = txn.manualSplitCount > 0;
	const pending = isRowPending(txn);
	const credit = txn.amount >= 0;
	const busy = setOverride.isPending || clearOverride.isPending;
	const cats = catsQ.data ?? [];
	const current = cats.find((c) => c.key === txn.categoryKey);

	const apply = (categoryKey: string) => {
		if (categoryKey === txn.categoryKey) {
			setView("detail");
			return;
		}
		setOverride.mutate(
			{ txnId: txn.txnId, categoryKey },
			{
				onSuccess: () => {
					haptics.saved();
					onChanged();
					setView("detail");
				},
				onError: (e) => {
					haptics.refused();
					toast.error(e.message);
				},
			},
		);
	};
	const revert = () =>
		clearOverride.mutate(
			{ txnId: txn.txnId },
			{
				onSuccess: () => {
					haptics.saved();
					onChanged();
				},
				onError: (e) => toast.error(e.message),
			},
		);

	const title =
		view === "category"
			? "Category"
			: view === "split"
				? `Split ${wholeOrPaise(Math.abs(txn.amount), formatINR)}`
				: cleanMerchant(txn.narration);

	return (
		<Sheet open={open} onOpenChange={onOpenChange} title={title}>
			{view === "detail" && (
				<>
					<div className="flex flex-col gap-1">
						<p
							className="tnum font-display font-medium text-4xl tracking-tight"
							style={{ color: credit ? IN : undefined }}
						>
							{credit ? "+" : "−"}
							{wholeOrPaise(Math.abs(txn.amount), formatINR)}
						</p>
						<p className="text-muted-foreground text-sm">
							{longDate(txn.date)}
						</p>
					</div>
					<p className="select-text break-words rounded-xl bg-secondary/60 px-3 py-2.5 font-mono text-sm leading-relaxed">
						{txn.narration}
					</p>
					{pending && (
						<p
							className="flex items-center gap-2 text-sm"
							style={{ color: PENDING_C }}
						>
							<span
								className="size-1.5 rounded-full"
								style={{ background: PENDING_C }}
							/>
							Edited — re-tag to apply it to your reports
						</p>
					)}

					<div className="flex flex-col">
						<p className="pt-1 pb-1 font-medium text-muted-foreground text-sm">
							Category
						</p>
						{isSplit ? (
							<p
								className="rounded-xl px-3 py-3 text-base"
								style={{ color: PENDING_C, background: tint(PENDING_C, 12) }}
							>
								Split · {txn.manualSplitCount} lines
							</p>
						) : (
							<SheetRow
								onClick={() => setView("category")}
								disabled={busy}
								trailing={
									<ChevronRight className="size-5 shrink-0 text-muted-foreground" />
								}
							>
								<span className="inline-flex items-center gap-3">
									<KindTile
										kind={txn.kind}
										uncategorized={txn.categoryKey === "uncategorized"}
									/>
									<span style={{ color: kindColor(txn.kind) }}>
										{current?.label ?? txn.categoryKey}
									</span>
								</span>
							</SheetRow>
						)}
					</div>

					<div className="flex flex-col">
						{txn.hasOverride && !isSplit && (
							<SheetRow onClick={revert} disabled={busy}>
								<span className="inline-flex items-center gap-3">
									<RotateCcw className="size-5 text-muted-foreground" />
									Revert to the rule's category
								</span>
							</SheetRow>
						)}
						<SheetRow onClick={() => onCreateRule(txn)}>
							<span className="inline-flex items-center gap-3">
								<ListPlus className="size-5 text-muted-foreground" />
								Create a rule from this narration
							</span>
						</SheetRow>
						<SheetRow onClick={() => setView("split")}>
							<span className="inline-flex items-center gap-3">
								<Scissors className="size-5 text-muted-foreground" />
								{isSplit ? "Edit split" : "Split into lines"}
							</span>
						</SheetRow>
					</div>
				</>
			)}

			{view === "category" && (
				<CategoryPicker
					value={txn.categoryKey}
					onPick={apply}
					onBack={() => setView("detail")}
					disabled={busy}
				/>
			)}

			{view === "split" && (
				<SplitEditor
					embedded
					txn={txn}
					onClose={() => setView("detail")}
					onChanged={onChanged}
				/>
			)}
		</Sheet>
	);
}
