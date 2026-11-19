import { Button } from "@money/ui/components/button";
import { Select } from "@money/ui/components/select";
import { SheetRow } from "@money/ui/components/sheet";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	BackRow,
	CategoryPicker,
	PickerField,
} from "@/components/categories/category-picker";
import { groupByKind, kindColor, useCategories } from "@/lib/categories";
import { useFormat } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { orpc } from "@/utils/orpc";

export interface Txn {
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

export const IN = "var(--covered)";
export const PENDING_C = "oklch(0.74 0.15 66)"; // amber — an edit not yet baked
export const tint = (c: string, pct: number) =>
	`color-mix(in oklab, ${c} ${pct}%, transparent)`;

/** an edit that DuckDB hasn't baked yet (drives the amber dot) */
export const isRowPending = (t: Txn) =>
	t.manualSplitCount > 0 ||
	(t.hasOverride && t.categoryKey !== t.bakedCategoryKey);

/** contribution/coupon/… tags that link a manual split line to an investment cashflow (spec §4). */
const CASHFLOW_TYPES = [
	{ value: "", label: "— flow —" },
	{ value: "coupon", label: "Coupon (interest)" },
	{ value: "redemption", label: "Principal returned" },
	{ value: "dividend", label: "Dividend" },
	{ value: "contribution", label: "Contribution" },
	{ value: "maturity", label: "Maturity" },
];

interface Line {
	amount: string;
	categoryKey: string;
	cashflowType: string;
}

/**
 * Split one statement row into category lines that sum to it.
 *
 * `embedded` is the phone's version, inside the transaction's sheet: the sheet already says what is being
 * split and has its own close, so the card's border and header go, and each line stacks into full-width
 * fields instead of a row that would need a desktop's width.
 */
export function SplitEditor({
	txn,
	onClose,
	onChanged,
	embedded = false,
}: {
	txn: Txn;
	onClose: () => void;
	onChanged: () => void;
	embedded?: boolean;
}) {
	const { formatINR } = useFormat();
	const existingQ = useQuery(
		orpc.splits.get.queryOptions({ input: { txnId: txn.txnId } }),
	);
	const setSplit = useMutation(orpc.splits.set.mutationOptions());
	const clearSplit = useMutation(orpc.splits.clear.mutationOptions());
	const catsQ = useCategories();
	const groups = groupByKind(catsQ.data ?? []);
	const [lines, setLines] = useState<Line[] | null>(null);
	// embedded only: the line whose category or flow is being picked, in place of the lines
	const [picking, setPicking] = useState<{
		line: number;
		field: "category" | "flow";
	} | null>(null);

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
			<div
				className={`text-muted-foreground ${embedded ? "py-6 text-sm" : "px-6 pb-4 text-xs"}`}
			>
				Loading…
			</div>
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
					if (embedded) haptics.saved();
					onChanged();
					onClose();
				},
				onError: (e) => {
					if (embedded) haptics.refused();
					toast.error(e.message);
				},
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
	const catByKey = new Map((catsQ.data ?? []).map((c) => [c.key, c]));

	if (embedded && picking) {
		const line = lines[picking.line];
		const done = () => setPicking(null);
		return picking.field === "category" ? (
			<CategoryPicker
				value={line?.categoryKey ?? ""}
				activeOnly={false}
				onBack={done}
				onPick={(v) => {
					update(picking.line, { categoryKey: v });
					done();
				}}
			/>
		) : (
			<>
				<BackRow onClick={done} />
				<div className="flex flex-col">
					{CASHFLOW_TYPES.map((o) => (
						<SheetRow
							key={o.value}
							selected={(line?.cashflowType ?? "") === o.value}
							onClick={() => {
								update(picking.line, { cashflowType: o.value });
								done();
							}}
						>
							{o.value === "" ? "No investment flow" : o.label}
						</SheetRow>
					))}
				</div>
			</>
		);
	}

	const categoryGroups = groups.map((g) => ({
		label: g.label,
		color: kindColor(g.kind),
		options: g.cats.map((c) => ({ value: c.key, label: c.label })),
	}));

	return (
		<div
			className={
				embedded
					? "flex flex-col gap-4"
					: "mb-3 ml-6 flex flex-col gap-3 rounded-lg border border-border bg-card/40 px-4 py-4"
			}
		>
			{embedded && <BackRow onClick={onClose} />}
			{!embedded && (
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
			)}

			<div className={`flex flex-col ${embedded ? "gap-4" : "gap-2"}`}>
				{lines.map((l, i) =>
					embedded ? (
						<div
							key={i}
							className="flex flex-col gap-2 rounded-2xl bg-secondary/50 p-3"
						>
							<div className="flex items-center gap-2">
								<input
									type="number"
									step="0.01"
									aria-label={`Line ${i + 1} amount`}
									value={l.amount}
									onChange={(e) => update(i, { amount: e.target.value })}
									className="tnum h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-right text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
								/>
								<button
									type="button"
									aria-label={`Remove line ${i + 1}`}
									onClick={() => remove(i)}
									disabled={lines.length === 1}
									className="grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground active:bg-secondary disabled:opacity-40"
								>
									<Trash2 className="size-4" />
								</button>
							</div>
							<PickerField
								label="Category"
								value={catByKey.get(l.categoryKey)?.label}
								color={
									catByKey.get(l.categoryKey)
										? kindColor(catByKey.get(l.categoryKey)?.kind ?? "")
										: undefined
								}
								onClick={() => setPicking({ line: i, field: "category" })}
							/>
							<PickerField
								label="Investment flow"
								value={
									CASHFLOW_TYPES.find(
										(o) => o.value !== "" && o.value === l.cashflowType,
									)?.label ?? "None"
								}
								onClick={() => setPicking({ line: i, field: "flow" })}
							/>
						</div>
					) : (
						<div key={i} className="flex flex-wrap items-center gap-2">
							<input
								type="number"
								step="0.01"
								value={l.amount}
								onChange={(e) => update(i, { amount: e.target.value })}
								className="tnum h-9 w-28 rounded-md border border-input bg-background px-2 text-right text-foreground text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
							/>
							<Select
								aria-label="Line category"
								value={l.categoryKey}
								onValueChange={(v) => update(i, { categoryKey: v })}
								placeholder="— category —"
								groups={categoryGroups}
								className="h-9 min-w-[10rem] flex-1 rounded-md"
							/>
							<Select
								aria-label="Cashflow type"
								value={l.cashflowType}
								onValueChange={(v) => update(i, { cashflowType: v })}
								options={CASHFLOW_TYPES}
								className="h-9 w-40 rounded-md"
							/>
							<button
								type="button"
								onClick={() => remove(i)}
								disabled={lines.length === 1}
								className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-40"
							>
								<Trash2 className="size-3.5" />
							</button>
						</div>
					),
				)}
			</div>

			<div className="flex items-center justify-between">
				<Button variant="ghost" size="sm" onClick={add}>
					<Plus className="size-4" /> Add line
				</Button>
				<p className={`tnum ${embedded ? "text-sm" : "text-xs"}`}>
					<span className="text-muted-foreground">Remainder </span>
					<span style={{ color: balanced ? IN : PENDING_C }}>
						{formatINR(remainder, { decimals: true })}
					</span>
				</p>
			</div>

			<div
				className={`flex items-center gap-2 ${embedded ? "flex-wrap" : "justify-end"}`}
			>
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
				<Button
					variant="outline"
					size="sm"
					onClick={onClose}
					disabled={busy}
					className={embedded ? "ml-auto" : undefined}
				>
					Cancel
				</Button>
				<Button size="sm" onClick={save} disabled={!canSave || busy}>
					{busy ? "Saving…" : "Save split"}
				</Button>
			</div>
			{!balanced && (
				<p
					className={`text-right text-muted-foreground ${embedded ? "text-sm" : "text-xs"}`}
				>
					Lines must sum to {formatINR(txn.amount, { decimals: true })}.
				</p>
			)}
		</div>
	);
}
