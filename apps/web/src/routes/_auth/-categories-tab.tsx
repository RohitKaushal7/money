import { type ColorSlot, isColorSlot, slotVar } from "@money/shared";
import { Button } from "@money/ui/components/button";
import { Input } from "@money/ui/components/input";
import { Select } from "@money/ui/components/select";
import { Sheet, SheetRow } from "@money/ui/components/sheet";
import { useIsPhone } from "@money/ui/hooks/use-media-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	Check,
	ChevronRight,
	Eye,
	EyeOff,
	Lock,
	Pencil,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArmedDelete } from "@/components/armed-delete";
import {
	BackRow,
	PickerField,
	SwitchRow,
} from "@/components/categories/category-picker";
import { ColorPin, ColorSlotGrid } from "@/components/categories/color-pin";
import {
	type CategoryItem,
	groupByKind,
	isIncomeKind,
	KIND_LABEL,
	KIND_ORDER,
	kindColor,
	useCategories,
} from "@/lib/categories";
import { orpc } from "@/utils/orpc";

const KIND_OPTIONS = KIND_ORDER.map((k) => ({
	value: k,
	label: KIND_LABEL[k],
}));

export function CategoriesTab() {
	const qc = useQueryClient();
	const catsQ = useCategories();
	const cats = catsQ.data ?? [];
	// Who already holds each slot. Sharing is allowed — two categories only clash if they appear in the
	// same chart together — so the picker reports the overlap instead of refusing the pick.
	const slotUsers = useMemo(() => {
		const m = new Map<ColorSlot, string[]>();
		for (const c of cats) {
			if (!isColorSlot(c.colorSlot)) continue;
			m.set(c.colorSlot, [...(m.get(c.colorSlot) ?? []), c.label]);
		}
		return m;
	}, [cats]);
	// Everything, not just the list: a category's name and colour show up across spending and transactions.
	const invalidate = () => {
		qc.invalidateQueries();
	};

	const [label, setLabel] = useState("");
	const [kind, setKind] = useState<string>("expense");
	const [taxable, setTaxable] = useState(false);
	const phone = useIsPhone();
	const [addOpen, setAddOpen] = useState(false);
	// the category open in the phone's editor sheet, by id so it follows the list as it refetches
	const [editId, setEditId] = useState<number | null>(null);
	const editing = cats.find((c) => c.id === editId) ?? null;

	const create = useMutation({
		...orpc.categories.create.mutationOptions(),
		onSuccess: () => {
			invalidate();
			setLabel("");
			setKind("expense");
			setTaxable(false);
			setAddOpen(false);
			toast.success("Category added.");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const submit = () => {
		if (!label.trim()) {
			toast.error("A label is required.");
			return;
		}
		create.mutate({
			label: label.trim(),
			kind: kind as
				| "active_income"
				| "passive_income"
				| "expense"
				| "investment"
				| "transfer",
			taxable: isIncomeKind(kind) ? taxable : undefined,
		});
	};

	return (
		<section className="flex flex-col gap-6">
			{phone && (
				<>
					<Button
						variant="outline"
						className="h-11 w-full"
						onClick={() => setAddOpen(true)}
					>
						<Plus className="size-4" /> Add a category
					</Button>
					<CategorySheet
						open={addOpen}
						onClose={() => setAddOpen(false)}
						title="Add a category"
						label={label}
						onLabel={setLabel}
						kind={kind}
						onKind={setKind}
						kindLocked={false}
						taxable={taxable}
						onTaxable={setTaxable}
						busy={create.isPending}
						saveLabel="Add category"
						onSave={submit}
					>
						<p className="text-muted-foreground text-sm">
							Every category rolls up to one of the fixed Kinds (the KPI axis).
						</p>
					</CategorySheet>
					{editing && (
						<EditCategorySheet
							key={editing.id}
							cat={editing}
							slotUsers={slotUsers}
							onClose={() => setEditId(null)}
							onChanged={invalidate}
						/>
					)}
				</>
			)}
			<div
				className={`flex flex-col gap-3 rounded-xl border border-border bg-card/40 px-4 py-4 ${phone ? "hidden" : ""}`}
			>
				<h3 className="font-medium text-sm">Add a category</h3>
				<div className="flex flex-wrap items-end gap-2">
					<label
						htmlFor="new-cat-label"
						className="flex flex-1 flex-col gap-1 text-xs"
					>
						<span className="text-muted-foreground">Label</span>
						<Input
							id="new-cat-label"
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder="e.g. School fees"
							className="min-w-[12rem]"
						/>
					</label>
					<div className="flex flex-col gap-1 text-xs">
						<span className="text-muted-foreground">Kind</span>
						<Select
							aria-label="Kind"
							value={kind}
							onValueChange={setKind}
							options={KIND_OPTIONS}
							className="w-40"
						/>
					</div>
					{isIncomeKind(kind) && (
						<label className="flex h-8 items-center gap-1.5 text-xs">
							<input
								type="checkbox"
								checked={taxable}
								onChange={(e) => setTaxable(e.target.checked)}
							/>
							<span className="text-muted-foreground">Taxable income</span>
						</label>
					)}
					<Button onClick={submit} disabled={create.isPending}>
						<Plus className="size-4" /> Add
					</Button>
				</div>
				<p className="text-muted-foreground text-xs">
					Every category rolls up to one of the fixed Kinds (the KPI axis).
					Built-in categories are locked — you can rename or hide them, but not
					delete them.
				</p>
			</div>

			{groupByKind(cats).map((g) => (
				<div key={g.kind} className="flex flex-col gap-2">
					<h3
						className="border-border border-b pb-1 font-medium text-sm"
						style={{ color: kindColor(g.kind) }}
					>
						{g.label}
					</h3>
					<ul className="flex flex-col divide-y divide-border">
						{g.cats.map((c) =>
							phone ? (
								<PhoneCategoryRow
									key={c.id}
									cat={c}
									onOpen={() => setEditId(c.id)}
								/>
							) : (
								<CategoryRow
									key={c.id}
									cat={c}
									slotUsers={slotUsers}
									onChanged={invalidate}
								/>
							),
						)}
					</ul>
				</div>
			))}
		</section>
	);
}

function CategoryRow({
	cat,
	slotUsers,
	onChanged,
}: {
	slotUsers: Map<ColorSlot, string[]>;
	cat: CategoryItem;
	onChanged: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const [label, setLabel] = useState(cat.label);
	const [kind, setKind] = useState(cat.kind);
	const [taxable, setTaxable] = useState(Boolean(cat.taxable));

	const update = useMutation({
		...orpc.categories.update.mutationOptions(),
		onSuccess: () => {
			onChanged();
			setEditing(false);
		},
		onError: (e: Error) => toast.error(e.message),
	});
	const remove = useMutation({
		...orpc.categories.remove.mutationOptions(),
		onSuccess: onChanged,
		onError: (e: Error) => toast.error(e.message),
	});

	const referenced = cat.refRules > 0 || cat.refTxns > 0;

	if (editing) {
		return (
			<li className="flex flex-wrap items-center gap-2 py-2.5">
				<Input
					value={label}
					onChange={(e) => setLabel(e.target.value)}
					className="w-48"
				/>
				{!cat.system && (
					<>
						<Select
							aria-label="Kind"
							value={kind}
							onValueChange={setKind}
							options={KIND_OPTIONS}
							className="w-40"
						/>
						{isIncomeKind(kind) && (
							<label className="flex items-center gap-1.5 text-xs">
								<input
									type="checkbox"
									checked={taxable}
									onChange={(e) => setTaxable(e.target.checked)}
								/>
								<span className="text-muted-foreground">Taxable</span>
							</label>
						)}
					</>
				)}
				<Button
					size="sm"
					disabled={update.isPending}
					onClick={() =>
						update.mutate({
							id: cat.id,
							label: label.trim() || cat.label,
							...(cat.system
								? {}
								: {
										kind: kind as never,
										taxable: isIncomeKind(kind) ? taxable : null,
									}),
						})
					}
				>
					<Check className="size-3.5" /> Save
				</Button>
				<Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
					<X className="size-3.5" /> Cancel
				</Button>
			</li>
		);
	}

	return (
		<li
			className={`flex items-center gap-2 py-2.5 ${cat.active ? "" : "opacity-45"}`}
		>
			{cat.system && (
				<Lock
					className="size-3 shrink-0 text-muted-foreground"
					aria-label="Built-in (locked)"
				/>
			)}
			<span className="min-w-0 flex-1 truncate text-sm">
				{cat.label}
				{!cat.active && (
					<span className="ml-2 text-muted-foreground text-xs">hidden</span>
				)}
			</span>
			{referenced && (
				<span className="tnum text-muted-foreground text-xs">
					{cat.refRules > 0 &&
						`${cat.refRules} rule${cat.refRules === 1 ? "" : "s"}`}
					{cat.refRules > 0 && cat.refTxns > 0 && " · "}
					{cat.refTxns > 0 &&
						`${cat.refTxns} txn${cat.refTxns === 1 ? "" : "s"}`}
				</span>
			)}
			<ColorPin
				slot={isColorSlot(cat.colorSlot) ? cat.colorSlot : null}
				slotUsers={slotUsers}
				onPick={(slot) => update.mutate({ id: cat.id, colorSlot: slot })}
				disabled={update.isPending}
			/>
			<button
				type="button"
				onClick={() => update.mutate({ id: cat.id, active: !cat.active })}
				className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
				title={cat.active ? "Hide from pickers" : "Show in pickers"}
			>
				{cat.active ? (
					<EyeOff className="size-3.5" />
				) : (
					<Eye className="size-3.5" />
				)}
			</button>
			<button
				type="button"
				onClick={() => {
					setLabel(cat.label);
					setKind(cat.kind);
					setTaxable(Boolean(cat.taxable));
					setEditing(true);
				}}
				className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
				title="Edit"
			>
				<Pencil className="size-3.5" />
			</button>
			{!cat.system && (
				<button
					type="button"
					onClick={() => remove.mutate({ id: cat.id })}
					disabled={remove.isPending}
					className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-40"
					title={
						referenced
							? "In use — reassign references first"
							: "Delete category"
					}
				>
					<Trash2 className="size-3.5" />
				</button>
			)}
		</li>
	);
}

const refSummary = (cat: CategoryItem) =>
	[
		cat.refRules > 0 && `${cat.refRules} rule${cat.refRules === 1 ? "" : "s"}`,
		cat.refTxns > 0 && `${cat.refTxns} txn${cat.refTxns === 1 ? "" : "s"}`,
	]
		.filter(Boolean)
		.join(" · ");

/** A phone row: the whole row opens the editor, where hide, colour, rename and delete live. */
function PhoneCategoryRow({
	cat,
	onOpen,
}: {
	cat: CategoryItem;
	onOpen: () => void;
}) {
	const refs = refSummary(cat);
	const slot = isColorSlot(cat.colorSlot) ? cat.colorSlot : null;
	return (
		<li>
			<button
				type="button"
				onClick={onOpen}
				className="-mx-2 flex min-h-14 w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2 text-left active:bg-secondary/60"
			>
				<span
					className={`size-3.5 shrink-0 rounded-full ${slot ? "" : "border border-muted-foreground/50 border-dashed"}`}
					style={slot ? { backgroundColor: slotVar(slot) } : undefined}
					aria-hidden="true"
				/>
				<span
					className={`flex min-w-0 flex-1 flex-col ${cat.active ? "" : "opacity-50"}`}
				>
					<span className="truncate text-base">{cat.label}</span>
					{(refs || !cat.active || cat.system) && (
						<span className="tnum truncate text-muted-foreground text-sm">
							{[cat.system && "Built-in", !cat.active && "Hidden", refs]
								.filter(Boolean)
								.join(" · ")}
						</span>
					)}
				</span>
				{cat.system && (
					<Lock
						className="size-3.5 shrink-0 text-muted-foreground"
						aria-label="Built-in (locked)"
					/>
				)}
				<ChevronRight className="size-4 shrink-0 text-muted-foreground" />
			</button>
		</li>
	);
}

/** The label / Kind / taxable form as a phone sheet, with the Kind as a picker step. Shared by add and edit. */
function CategorySheet({
	open,
	onClose,
	title,
	label,
	onLabel,
	kind,
	onKind,
	kindLocked,
	taxable,
	onTaxable,
	busy,
	saveLabel,
	onSave,
	children,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	label: string;
	onLabel: (v: string) => void;
	kind: string;
	onKind: (v: string) => void;
	/** built-in categories keep their Kind */
	kindLocked: boolean;
	taxable: boolean;
	onTaxable: (v: boolean) => void;
	busy: boolean;
	saveLabel: string;
	onSave: () => void;
	children?: ReactNode;
}) {
	const [pickingKind, setPickingKind] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: every opening starts on the form
	useEffect(() => setPickingKind(false), [open]);
	return (
		<Sheet
			open={open}
			onOpenChange={(o) => !o && onClose()}
			title={pickingKind ? "Kind" : title}
			footer={
				pickingKind ? undefined : (
					<Button className="h-11 w-full" onClick={onSave} disabled={busy}>
						{busy ? "Saving…" : saveLabel}
					</Button>
				)
			}
		>
			{pickingKind ? (
				<>
					<BackRow onClick={() => setPickingKind(false)} />
					<div className="flex flex-col">
						{KIND_ORDER.map((k) => (
							<SheetRow
								key={k}
								selected={k === kind}
								onClick={() => {
									onKind(k);
									setPickingKind(false);
								}}
							>
								<span className="inline-flex items-center gap-3">
									<span
										className="size-2.5 shrink-0 rounded-full"
										style={{ background: kindColor(k) }}
									/>
									{KIND_LABEL[k]}
								</span>
							</SheetRow>
						))}
					</div>
				</>
			) : (
				<>
					<label htmlFor="cat-label-phone" className="flex flex-col gap-1.5">
						<span className="text-muted-foreground text-sm">Label</span>
						<Input
							id="cat-label-phone"
							value={label}
							onChange={(e) => onLabel(e.target.value)}
							placeholder="e.g. School fees"
							className="h-11 rounded-xl text-base"
						/>
					</label>
					{kindLocked ? (
						<p className="flex items-center gap-2 text-muted-foreground text-sm">
							<Lock className="size-3.5" /> Built-in: rename or hide it, but its
							Kind is fixed.
						</p>
					) : (
						<>
							<PickerField
								label="Kind"
								value={KIND_LABEL[kind as keyof typeof KIND_LABEL]}
								color={kindColor(kind)}
								onClick={() => setPickingKind(true)}
							/>
							{isIncomeKind(kind) && (
								<SwitchRow
									label="Taxable income"
									checked={taxable}
									onChange={onTaxable}
								/>
							)}
						</>
					)}
					{children}
				</>
			)}
		</Sheet>
	);
}

function EditCategorySheet({
	cat,
	slotUsers,
	onClose,
	onChanged,
}: {
	cat: CategoryItem;
	slotUsers: Map<ColorSlot, string[]>;
	onClose: () => void;
	onChanged: () => void;
}) {
	const [open, setOpen] = useState(true);
	const [label, setLabel] = useState(cat.label);
	const [kind, setKind] = useState(cat.kind);
	const [taxable, setTaxable] = useState(Boolean(cat.taxable));
	// let the sheet slide away before the parent drops it
	const close = () => {
		setOpen(false);
		setTimeout(onClose, 300);
	};

	const update = useMutation({
		...orpc.categories.update.mutationOptions(),
		onSuccess: onChanged,
		onError: (e: Error) => toast.error(e.message),
	});
	const remove = useMutation({
		...orpc.categories.remove.mutationOptions(),
		onSuccess: () => {
			onChanged();
			close();
		},
		onError: (e: Error) => toast.error(e.message),
	});
	const referenced = cat.refRules > 0 || cat.refTxns > 0;

	return (
		<CategorySheet
			open={open}
			onClose={close}
			title="Edit category"
			label={label}
			onLabel={setLabel}
			kind={kind}
			onKind={setKind}
			kindLocked={cat.system}
			taxable={taxable}
			onTaxable={setTaxable}
			busy={update.isPending}
			saveLabel="Save"
			onSave={() =>
				update.mutate(
					{
						id: cat.id,
						label: label.trim() || cat.label,
						...(cat.system
							? {}
							: {
									kind: kind as never,
									taxable: isIncomeKind(kind) ? taxable : null,
								}),
					},
					{ onSuccess: close },
				)
			}
		>
			<div className="flex flex-col gap-2 pt-1">
				<span className="text-muted-foreground text-sm">Colour</span>
				<ColorSlotGrid
					slot={isColorSlot(cat.colorSlot) ? cat.colorSlot : null}
					slotUsers={slotUsers}
					self={cat.label}
					disabled={update.isPending}
					onPick={(slot) => update.mutate({ id: cat.id, colorSlot: slot })}
				/>
			</div>
			<SwitchRow
				label="Show in pickers"
				hint={
					cat.active
						? "Hide it to keep it off the category lists."
						: "Hidden from the category lists."
				}
				checked={cat.active}
				disabled={update.isPending}
				onChange={(v) => update.mutate({ id: cat.id, active: v })}
			/>
			{referenced && (
				<p className="tnum text-muted-foreground text-sm">
					Used by {refSummary(cat)}.
				</p>
			)}
			{!cat.system && (
				<ArmedDelete
					label="Delete category"
					title={
						referenced
							? "In use — reassign references first"
							: "Delete category"
					}
					size="sm"
					disabled={remove.isPending}
					onConfirm={() => remove.mutate({ id: cat.id })}
					className="h-11 self-start"
				/>
			)}
		</CategorySheet>
	);
}
