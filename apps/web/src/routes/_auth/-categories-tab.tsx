import { type ColorSlot, isColorSlot } from "@money/shared";
import { Button } from "@money/ui/components/button";
import { Input } from "@money/ui/components/input";
import { Select } from "@money/ui/components/select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	Check,
	Eye,
	EyeOff,
	Lock,
	Pencil,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ColorPin } from "@/components/categories/color-pin";
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
	const invalidate = () => {
		qc.invalidateQueries({ queryKey: orpc.categories.list.queryKey() });
	};

	const [label, setLabel] = useState("");
	const [kind, setKind] = useState<string>("expense");
	const [taxable, setTaxable] = useState(false);

	const create = useMutation({
		...orpc.categories.create.mutationOptions(),
		onSuccess: () => {
			invalidate();
			setLabel("");
			setKind("expense");
			setTaxable(false);
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
			<div className="flex flex-col gap-3 rounded-xl border border-border bg-card/40 px-4 py-4">
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
						{g.cats.map((c) => (
							<CategoryRow
								key={c.id}
								cat={c}
								slotUsers={slotUsers}
								onChanged={invalidate}
							/>
						))}
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
