import {
	ArrowLeftRight,
	ArrowUpRight,
	Briefcase,
	CircleHelp,
	Sprout,
	TrendingUp,
} from "lucide-react";
import type { ReactNode } from "react";
import { kindColor } from "@/lib/categories";
import { groupByDay } from "@/lib/day-groups";
import { cleanMerchant } from "@/lib/merchant";

/**
 * The phone's transaction list: rows grouped under sticky day headings, each row a merchant over its
 * category with the amount on the right. One component for Transactions and Overview's recent activity, so
 * the same payment looks the same in both places.
 *
 * Phone only. Desktop keeps its tables, where a date column has the width to sit in.
 */

export type TxnListItem = {
	id: string;
	/** `YYYY-MM-DD` */
	date: string;
	narration: string;
	/** signed: credit +, debit − */
	amount: number;
	kind: string | null;
	categoryKey: string | null;
	categoryLabel: string;
	/** an edit not yet baked into the reports (amber, like the desktop dot) */
	pending?: boolean;
	/** replaces the category line, e.g. "Split · 3 lines" */
	note?: string;
};

export const PENDING_COLOR = "oklch(0.74 0.15 66)";

const tint = (c: string, pct: number) =>
	`color-mix(in oklab, ${c} ${pct}%, transparent)`;

/** Whole rupees when there are no paise, so a list of round amounts doesn't end in a column of ".00". */
export function wholeOrPaise(
	abs: number,
	formatINR: (v: number, opts?: { decimals?: boolean }) => string,
): string {
	return formatINR(abs, { decimals: Math.round(abs * 100) % 100 !== 0 });
}

const KIND_ICON: Record<string, typeof Sprout> = {
	passive_income: Sprout,
	active_income: Briefcase,
	expense: ArrowUpRight,
	investment: TrendingUp,
	transfer: ArrowLeftRight,
};

/** A 40px tile in the Kind's colour, so the column of icons reads as the KPI axis at a glance. */
export function KindTile({
	kind,
	uncategorized,
}: {
	kind: string | null;
	uncategorized?: boolean;
}) {
	const color = uncategorized
		? "var(--muted-foreground)"
		: kindColor(kind ?? "transfer");
	const Icon = uncategorized
		? CircleHelp
		: (KIND_ICON[kind ?? ""] ?? CircleHelp);
	return (
		<span
			aria-hidden="true"
			className="grid size-10 shrink-0 place-items-center rounded-full"
			style={{ background: tint(color, 14), color }}
		>
			<Icon className="size-[18px]" strokeWidth={2} />
		</span>
	);
}

export function DayGroupedTxnList({
	rows,
	formatAmount,
	onSelect,
	selectedId,
}: {
	rows: TxnListItem[];
	/** a magnitude → its display string; the caller owns currency and privacy masking */
	formatAmount: (abs: number) => string;
	/** omit for a read-only list */
	onSelect?: (id: string) => void;
	selectedId?: string | null;
}) {
	return (
		<div className="flex flex-col">
			{groupByDay(rows).map((g) => (
				<section key={g.day} aria-label={g.label} className="flex flex-col">
					{/* sticky inside the page's own scroll pane, which starts under the phone top bar */}
					<h3 className="sticky top-0 z-10 -mx-5 bg-background/95 px-5 pt-3 pb-1.5 font-medium text-muted-foreground text-sm backdrop-blur-md">
						{g.label}
					</h3>
					<ul className="flex flex-col">
						{g.rows.map((t) => (
							<li key={t.id}>
								<TxnListRow
									txn={t}
									amount={formatAmount(Math.abs(t.amount))}
									onSelect={onSelect}
									selected={selectedId === t.id}
								/>
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}

function TxnListRow({
	txn,
	amount,
	onSelect,
	selected,
}: {
	txn: TxnListItem;
	amount: string;
	onSelect?: (id: string) => void;
	selected?: boolean;
}) {
	const credit = txn.amount >= 0;
	const uncategorized =
		(txn.categoryKey ?? "uncategorized") === "uncategorized";
	const body: ReactNode = (
		<>
			<KindTile kind={txn.kind} uncategorized={uncategorized} />
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-medium text-base leading-snug">
					{cleanMerchant(txn.narration)}
				</span>
				<span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-sm leading-snug">
					{txn.pending && (
						<span
							className="size-1.5 shrink-0 rounded-full"
							style={{ background: PENDING_COLOR }}
						/>
					)}
					<span
						className="truncate"
						style={txn.note ? { color: PENDING_COLOR } : undefined}
					>
						{txn.note ?? txn.categoryLabel}
					</span>
				</span>
			</span>
			<span
				className="tnum shrink-0 text-right text-base"
				style={{ color: credit ? "var(--covered)" : undefined }}
			>
				{credit ? "+" : "−"}
				{amount}
			</span>
		</>
	);
	const cls =
		"-mx-2 flex min-h-16 w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2 text-left";
	if (!onSelect) return <div className={cls}>{body}</div>;
	return (
		<button
			type="button"
			onClick={() => onSelect(txn.id)}
			className={`pressable ${cls} transition-colors active:bg-secondary ${selected ? "bg-secondary/70" : ""}`}
		>
			{body}
		</button>
	);
}
