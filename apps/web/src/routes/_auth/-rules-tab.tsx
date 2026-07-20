import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@money/ui/components/button";
import { Input } from "@money/ui/components/input";
import { Select } from "@money/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { groupByKind, kindColor, useCategories } from "@/lib/categories";
import { orpc } from "@/utils/orpc";

/** A rule pre-seeded from a transaction's narration (the "Create rule from this" shortcut). */
export type RulePrefill = {
	pattern: string;
	assignCategoryKey: string;
};

type Rule = {
	id: number;
	priority: number;
	matchType: string;
	pattern: string;
	assignKind: string;
	assignCategoryKey: string;
	assignInvestmentId: number | null;
	minAmount: number | null;
	maxAmount: number | null;
	active: boolean;
	createdAt: Date;
	updatedAt: Date;
};

type FormState = {
	editingId: number | null;
	pattern: string;
	matchType: "substring" | "regex";
	assignCategoryKey: string;
	minAmount: string;
	maxAmount: string;
	advanced: boolean;
};

const EMPTY: FormState = {
	editingId: null,
	pattern: "",
	matchType: "substring",
	assignCategoryKey: "",
	minAmount: "",
	maxAmount: "",
	advanced: false,
};

export function RulesTab({
	prefill,
	onConsumePrefill,
}: {
	prefill: RulePrefill | null;
	onConsumePrefill: () => void;
}) {
	const qc = useQueryClient();
	const rulesQ = useQuery(orpc.rules.list.queryOptions());
	const catsQ = useCategories();
	const cats = catsQ.data ?? [];
	const byKey = new Map(cats.map((c) => [c.key, c]));
	const [form, setForm] = useState<FormState>(EMPTY);

	const rulesKey = orpc.rules.list.queryKey();
	const invalidate = () => qc.invalidateQueries({ queryKey: rulesKey });

	// "Create rule from this transaction" → open the add-form pre-seeded, then consume the prefill.
	useEffect(() => {
		if (!prefill) return;
		setForm({
			...EMPTY,
			pattern: prefill.pattern,
			assignCategoryKey: prefill.assignCategoryKey,
		});
		onConsumePrefill();
	}, [prefill, onConsumePrefill]);

	const create = useMutation({
		...orpc.rules.create.mutationOptions(),
		onSuccess: () => {
			invalidate();
			setForm(EMPTY);
			toast.success("Rule added — Re-tag to apply.");
		},
		onError: (e: Error) => toast.error(e.message),
	});
	const update = useMutation({
		...orpc.rules.update.mutationOptions(),
		onSuccess: () => {
			invalidate();
			setForm(EMPTY);
		},
		onError: (e: Error) => toast.error(e.message),
	});
	const remove = useMutation({
		...orpc.rules.remove.mutationOptions(),
		onSuccess: invalidate,
		onError: (e: Error) => toast.error(e.message),
	});
	const reorder = useMutation({
		...orpc.rules.reorder.mutationOptions(),
		onSuccess: invalidate,
		onError: (e: Error) => {
			toast.error(e.message);
			invalidate(); // roll the optimistic order back to server truth
		},
	});

	const rows = (rulesQ.data ?? []) as Rule[];

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const onDragEnd = (e: DragEndEvent) => {
		const { active, over } = e;
		if (!over || active.id === over.id) return;
		const oldIndex = rows.findIndex((r) => r.id === active.id);
		const newIndex = rows.findIndex((r) => r.id === over.id);
		if (oldIndex < 0 || newIndex < 0) return;
		const next = arrayMove(rows, oldIndex, newIndex);
		qc.setQueryData(rulesKey, next); // optimistic
		reorder.mutate({ orderedIds: next.map((r) => r.id) });
	};

	const submit = () => {
		if (!form.pattern.trim() || !form.assignCategoryKey) {
			toast.error("A pattern and a category are required.");
			return;
		}
		const cat = byKey.get(form.assignCategoryKey);
		if (!cat) {
			toast.error("Pick a valid category.");
			return;
		}
		const payload = {
			pattern: form.pattern.trim(),
			matchType: form.matchType,
			assignCategoryKey: form.assignCategoryKey,
			assignKind: cat.kind as
				| "active_income"
				| "passive_income"
				| "expense"
				| "investment"
				| "transfer",
			minAmount: form.minAmount === "" ? null : Number(form.minAmount),
			maxAmount: form.maxAmount === "" ? null : Number(form.maxAmount),
		};
		if (form.editingId != null) {
			update.mutate({ id: form.editingId, ...payload });
		} else {
			create.mutate(payload);
		}
	};

	const categoryGroups = groupByKind(cats, {
		activeOnly: true,
		keepKey: form.assignCategoryKey,
	}).map((g) => ({
		label: g.label,
		color: kindColor(g.kind),
		options: g.cats.map((c) => ({ value: c.key, label: c.label })),
	}));

	const busy = create.isPending || update.isPending;

	return (
		<section className="flex flex-col gap-6">
			{/* add / edit form */}
			<div className="flex flex-col gap-3 rounded-xl border border-border bg-card/40 px-4 py-4">
				<div className="flex items-center justify-between">
					<h3 className="font-medium text-sm">
						{form.editingId != null ? "Edit rule" : "Add a rule"}
					</h3>
					<button
						type="button"
						onClick={() => setForm((f) => ({ ...f, advanced: !f.advanced }))}
						className="text-muted-foreground text-xs hover:text-foreground"
					>
						{form.advanced ? "Hide advanced" : "Advanced"}
					</button>
				</div>
				<div className="flex flex-wrap items-end gap-2">
					<label
						htmlFor="rule-pattern"
						className="flex flex-1 flex-col gap-1 text-xs"
					>
						<span className="text-muted-foreground">
							Narration {form.matchType === "regex" ? "regex" : "contains"}
						</span>
						<Input
							id="rule-pattern"
							value={form.pattern}
							onChange={(e) =>
								setForm((f) => ({ ...f, pattern: e.target.value }))
							}
							placeholder="e.g. SWIGGY"
							className="min-w-[12rem]"
						/>
					</label>
					<div className="flex flex-col gap-1 text-xs">
						<span className="text-muted-foreground">Category</span>
						<Select
							aria-label="Category"
							value={form.assignCategoryKey}
							onValueChange={(v) =>
								setForm((f) => ({ ...f, assignCategoryKey: v }))
							}
							placeholder="— pick —"
							groups={categoryGroups}
							className="min-w-[12rem]"
						/>
					</div>
					{form.advanced && (
						<>
							<div className="flex flex-col gap-1 text-xs">
								<span className="text-muted-foreground">Match</span>
								<Select
									aria-label="Match type"
									value={form.matchType}
									onValueChange={(v) =>
										setForm((f) => ({
											...f,
											matchType: v as "substring" | "regex",
										}))
									}
									options={[
										{ value: "substring", label: "contains" },
										{ value: "regex", label: "regex" },
									]}
									className="w-32"
								/>
							</div>
							<label htmlFor="rule-min" className="flex flex-col gap-1 text-xs">
								<span className="text-muted-foreground">Min ₹</span>
								<Input
									id="rule-min"
									type="number"
									value={form.minAmount}
									onChange={(e) =>
										setForm((f) => ({ ...f, minAmount: e.target.value }))
									}
									className="w-24"
									placeholder="—"
								/>
							</label>
							<label htmlFor="rule-max" className="flex flex-col gap-1 text-xs">
								<span className="text-muted-foreground">Max ₹</span>
								<Input
									id="rule-max"
									type="number"
									value={form.maxAmount}
									onChange={(e) =>
										setForm((f) => ({ ...f, maxAmount: e.target.value }))
									}
									className="w-24"
									placeholder="—"
								/>
							</label>
						</>
					)}
					<Button onClick={submit} disabled={busy}>
						{form.editingId != null ? "Save" : <Plus className="size-4" />}
						{form.editingId != null ? "" : "Add"}
					</Button>
					{form.editingId != null && (
						<Button variant="ghost" onClick={() => setForm(EMPTY)}>
							<X className="size-4" /> Cancel
						</Button>
					)}
				</div>
				{form.advanced && (
					<p className="text-muted-foreground text-xs">
						Amount bounds are signed INR (credits +, debits −). A regex matches
						the cleaned narration. First matching rule wins (top of the list
						first) — drag to reorder.
					</p>
				)}
			</div>

			{/* rule list */}
			{rows.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No rules yet. Add one above, or use “Create rule from this” on a
					transaction.
				</p>
			) : (
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					modifiers={[restrictToVerticalAxis]}
					onDragEnd={onDragEnd}
				>
					<SortableContext
						items={rows.map((r) => r.id)}
						strategy={verticalListSortingStrategy}
					>
						<ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
							{rows.map((r) => (
								<SortableRuleRow
									key={r.id}
									rule={r}
									catLabel={byKey.get(r.assignCategoryKey)?.label}
									onEdit={() =>
										setForm({
											editingId: r.id,
											pattern: r.pattern,
											matchType:
												r.matchType === "regex" ? "regex" : "substring",
											assignCategoryKey: r.assignCategoryKey,
											minAmount: r.minAmount == null ? "" : String(r.minAmount),
											maxAmount: r.maxAmount == null ? "" : String(r.maxAmount),
											advanced: r.minAmount != null || r.maxAmount != null,
										})
									}
									onToggle={() =>
										update.mutate({ id: r.id, active: !r.active })
									}
									onDelete={() => remove.mutate({ id: r.id })}
								/>
							))}
						</ul>
					</SortableContext>
				</DndContext>
			)}
		</section>
	);
}

function SortableRuleRow({
	rule,
	catLabel,
	onEdit,
	onToggle,
	onDelete,
}: {
	rule: Rule;
	catLabel: string | undefined;
	onEdit: () => void;
	onToggle: () => void;
	onDelete: () => void;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: rule.id });
	const bounds = [
		rule.minAmount != null ? `≥${rule.minAmount}` : null,
		rule.maxAmount != null ? `≤${rule.maxAmount}` : null,
	]
		.filter(Boolean)
		.join(" ");
	return (
		<li
			ref={setNodeRef}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
				opacity: isDragging ? 0.6 : 1,
				zIndex: isDragging ? 10 : undefined,
			}}
			className={`flex items-center gap-2 bg-background px-3 py-2.5 ${rule.active ? "" : "opacity-50"}`}
		>
			<button
				type="button"
				className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
				title="Drag to reorder"
				{...attributes}
				{...listeners}
			>
				<GripVertical className="size-4" />
			</button>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2">
					<code className="truncate text-sm">{rule.pattern}</code>
					<span className="rounded-full bg-secondary px-1.5 py-0.5 text-[0.6rem] text-secondary-foreground uppercase tracking-wide">
						{rule.matchType === "regex" ? "regex" : "contains"}
					</span>
					{bounds && (
						<span className="tnum text-muted-foreground text-xs">{bounds}</span>
					)}
				</div>
				<span className="text-xs" style={{ color: kindColor(rule.assignKind) }}>
					→ {catLabel ?? rule.assignCategoryKey}
				</span>
			</div>
			<button
				type="button"
				onClick={onToggle}
				className="rounded-full px-2 py-0.5 text-[0.65rem] text-muted-foreground uppercase tracking-wide hover:text-foreground"
				title={rule.active ? "Disable rule" : "Enable rule"}
			>
				{rule.active ? "on" : "off"}
			</button>
			<button
				type="button"
				onClick={onEdit}
				className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
				title="Edit"
			>
				<Pencil className="size-3.5" />
			</button>
			<button
				type="button"
				onClick={onDelete}
				className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
				title="Delete"
			>
				<Trash2 className="size-3.5" />
			</button>
		</li>
	);
}
