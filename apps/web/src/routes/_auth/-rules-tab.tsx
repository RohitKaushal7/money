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
import { Sheet } from "@money/ui/components/sheet";
import { useIsPhone } from "@money/ui/hooks/use-media-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronRight,
	GripVertical,
	Pencil,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArmedDelete } from "@/components/armed-delete";
import {
	CategoryPicker,
	PickerField,
	SwitchRow,
} from "@/components/categories/category-picker";
import { groupByKind, kindColor, useCategories } from "@/lib/categories";
import { haptics } from "@/lib/haptics";
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
	const phone = useIsPhone();
	// The phone edits a rule in a sheet rather than the card above the list, which needs a desktop's width.
	const [sheetOpen, setSheetOpen] = useState(false);
	const [sheetActive, setSheetActive] = useState(true);
	const closeSheet = () => {
		setSheetOpen(false);
		setForm(EMPTY);
	};

	const rulesKey = orpc.rules.list.queryKey();
	// Everything, not just the rule list: rules decide how transactions are categorised, so spending and
	// transaction views read from them too.
	const invalidate = () => qc.invalidateQueries();

	// "Create rule from this transaction" → open the add-form pre-seeded, then consume the prefill.
	useEffect(() => {
		if (!prefill) return;
		setForm({
			...EMPTY,
			pattern: prefill.pattern,
			assignCategoryKey: prefill.assignCategoryKey,
		});
		setSheetActive(true);
		setSheetOpen(true);
		onConsumePrefill();
	}, [prefill, onConsumePrefill]);

	const create = useMutation({
		...orpc.rules.create.mutationOptions(),
		onSuccess: () => {
			invalidate();
			setForm(EMPTY);
			setSheetOpen(false);
			toast.success("Rule added — Re-tag to apply.");
		},
		onError: (e: Error) => toast.error(e.message),
	});
	const update = useMutation({
		...orpc.rules.update.mutationOptions(),
		onSuccess: () => {
			invalidate();
			setForm(EMPTY);
			setSheetOpen(false);
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

	const submit = (opts?: { active?: boolean }) => {
		if (!form.pattern.trim() || !form.assignCategoryKey) {
			if (phone) haptics.refused();
			toast.error("A pattern and a category are required.");
			return;
		}
		const cat = byKey.get(form.assignCategoryKey);
		if (!cat) {
			if (phone) haptics.refused();
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
			update.mutate({ id: form.editingId, ...payload, ...opts });
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
	const editRule = (r: Rule) =>
		setForm({
			editingId: r.id,
			pattern: r.pattern,
			matchType: r.matchType === "regex" ? "regex" : "substring",
			assignCategoryKey: r.assignCategoryKey,
			minAmount: r.minAmount == null ? "" : String(r.minAmount),
			maxAmount: r.maxAmount == null ? "" : String(r.maxAmount),
			advanced: r.minAmount != null || r.maxAmount != null,
		});

	return (
		<section className="flex flex-col gap-6">
			{phone && (
				<>
					<Button
						variant="outline"
						className="h-11 w-full"
						onClick={() => {
							setForm(EMPTY);
							setSheetActive(true);
							setSheetOpen(true);
						}}
					>
						<Plus className="size-4" /> Add a rule
					</Button>
					<PhoneRuleSheet
						open={sheetOpen}
						onClose={closeSheet}
						form={form}
						setForm={setForm}
						active={sheetActive}
						onActive={setSheetActive}
						catLabel={byKey.get(form.assignCategoryKey)?.label}
						catKind={byKey.get(form.assignCategoryKey)?.kind}
						busy={busy}
						onSave={() =>
							submit(
								form.editingId != null ? { active: sheetActive } : undefined,
							)
						}
						onDelete={() => {
							if (form.editingId == null) return;
							remove.mutate({ id: form.editingId });
							closeSheet();
						}}
					/>
				</>
			)}

			{/* add / edit form */}
			<div
				className={`flex flex-col gap-3 rounded-xl border border-border bg-card/40 px-4 py-4 ${phone ? "hidden" : ""}`}
			>
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
					<Button onClick={() => submit()} disabled={busy}>
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
									phone={phone}
									catLabel={byKey.get(r.assignCategoryKey)?.label}
									onEdit={() => {
										editRule(r);
										if (phone) {
											setSheetActive(r.active);
											setSheetOpen(true);
										}
									}}
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
	phone,
	catLabel,
	onEdit,
	onToggle,
	onDelete,
}: {
	rule: Rule;
	phone: boolean;
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
	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.6 : 1,
		zIndex: isDragging ? 10 : undefined,
	};
	if (phone) {
		// The handle keeps drag-to-reorder; the rest of the row is one tap target that opens the editor,
		// where enable, edit and delete live.
		return (
			<li
				ref={setNodeRef}
				style={style}
				className="flex items-stretch bg-background first:rounded-t-xl last:rounded-b-xl"
			>
				<button
					type="button"
					className="grid w-11 shrink-0 touch-none place-items-center text-muted-foreground"
					aria-label="Drag to reorder"
					{...attributes}
					{...listeners}
				>
					<GripVertical className="size-5" />
				</button>
				<button
					type="button"
					onClick={onEdit}
					className="flex min-h-16 min-w-0 flex-1 items-center gap-2 py-2.5 pr-3 text-left active:bg-secondary/60"
				>
					<span
						className={`flex min-w-0 flex-1 flex-col gap-0.5 ${rule.active ? "" : "opacity-50"}`}
					>
						<code className="truncate text-sm">{rule.pattern}</code>
						<span
							className="truncate text-sm"
							style={{ color: kindColor(rule.assignKind) }}
						>
							→ {catLabel ?? rule.assignCategoryKey}
						</span>
						<span className="tnum truncate text-muted-foreground text-xs">
							{rule.matchType === "regex" ? "regex" : "contains"}
							{bounds && ` · ${bounds}`}
						</span>
					</span>
					{!rule.active && (
						<span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-muted-foreground text-xs">
							Off
						</span>
					)}
					<ChevronRight className="size-4 shrink-0 text-muted-foreground" />
				</button>
			</li>
		);
	}
	return (
		<li
			ref={setNodeRef}
			style={style}
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

/** The phone's rule editor: the desktop card's fields, stacked, with the category as a picker step. */
function PhoneRuleSheet({
	open,
	onClose,
	form,
	setForm,
	active,
	onActive,
	catLabel,
	catKind,
	busy,
	onSave,
	onDelete,
}: {
	open: boolean;
	onClose: () => void;
	form: FormState;
	setForm: (f: (prev: FormState) => FormState) => void;
	active: boolean;
	onActive: (v: boolean) => void;
	catLabel: string | undefined;
	catKind: string | undefined;
	busy: boolean;
	onSave: () => void;
	onDelete: () => void;
}) {
	const [picking, setPicking] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: every opening starts on the form
	useEffect(() => setPicking(false), [open]);
	const editing = form.editingId != null;
	return (
		<Sheet
			open={open}
			onOpenChange={(o) => !o && onClose()}
			title={picking ? "Category" : editing ? "Edit rule" : "Add a rule"}
			footer={
				picking ? undefined : (
					<Button className="h-11 w-full" onClick={onSave} disabled={busy}>
						{busy ? "Saving…" : editing ? "Save rule" : "Add rule"}
					</Button>
				)
			}
		>
			{picking ? (
				<CategoryPicker
					value={form.assignCategoryKey}
					onBack={() => setPicking(false)}
					onPick={(v) => {
						setForm((f) => ({ ...f, assignCategoryKey: v }));
						setPicking(false);
					}}
				/>
			) : (
				<>
					<label htmlFor="rule-pattern-phone" className="flex flex-col gap-1.5">
						<span className="text-muted-foreground text-sm">
							Narration {form.matchType === "regex" ? "regex" : "contains"}
						</span>
						<Input
							id="rule-pattern-phone"
							value={form.pattern}
							onChange={(e) =>
								setForm((f) => ({ ...f, pattern: e.target.value }))
							}
							placeholder="e.g. SWIGGY"
							autoCapitalize="characters"
							className="h-11 rounded-xl text-base"
						/>
					</label>
					<PickerField
						label="Category"
						value={catLabel}
						color={catKind ? kindColor(catKind) : undefined}
						placeholder="Pick a category"
						onClick={() => setPicking(true)}
					/>
					<div className="flex flex-col gap-1.5">
						<span className="text-muted-foreground text-sm">Match</span>
						<div className="flex rounded-full bg-secondary p-1">
							{(["substring", "regex"] as const).map((m) => (
								<button
									key={m}
									type="button"
									aria-pressed={form.matchType === m}
									onClick={() => setForm((f) => ({ ...f, matchType: m }))}
									className={`h-9 flex-1 rounded-full text-sm ${form.matchType === m ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}
								>
									{m === "regex" ? "Regex" : "Contains"}
								</button>
							))}
						</div>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<label htmlFor="rule-min-phone" className="flex flex-col gap-1.5">
							<span className="text-muted-foreground text-sm">Min ₹</span>
							<Input
								id="rule-min-phone"
								type="number"
								value={form.minAmount}
								onChange={(e) =>
									setForm((f) => ({ ...f, minAmount: e.target.value }))
								}
								placeholder="—"
								className="h-11 rounded-xl text-base"
							/>
						</label>
						<label htmlFor="rule-max-phone" className="flex flex-col gap-1.5">
							<span className="text-muted-foreground text-sm">Max ₹</span>
							<Input
								id="rule-max-phone"
								type="number"
								value={form.maxAmount}
								onChange={(e) =>
									setForm((f) => ({ ...f, maxAmount: e.target.value }))
								}
								placeholder="—"
								className="h-11 rounded-xl text-base"
							/>
						</label>
					</div>
					<p className="text-muted-foreground text-sm">
						Amount bounds are signed INR (credits +, debits −). First matching
						rule wins, top of the list first; drag the handle to reorder.
					</p>
					{editing && (
						<>
							<SwitchRow
								label="Enabled"
								hint="A disabled rule is skipped on re-tag."
								checked={active}
								onChange={onActive}
							/>
							<ArmedDelete
								label="Delete rule"
								title="Delete rule"
								size="sm"
								onConfirm={onDelete}
								className="h-11 self-start"
							/>
						</>
					)}
				</>
			)}
		</Sheet>
	);
}
