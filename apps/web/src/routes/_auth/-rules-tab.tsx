import { Button } from "@money/ui/components/button";
import { Input } from "@money/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { groupByKind, kindColor, useCategories } from "@/lib/categories";
import { orpc } from "@/utils/orpc";

/** A rule pre-seeded from a transaction's narration (the "Create rule from this" shortcut). */
export type RulePrefill = {
	pattern: string;
	assignCategoryKey: string;
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

const SELECT_CLASS =
	"h-8 rounded-none border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring dark:bg-input/30";

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

	const invalidate = () => {
		qc.invalidateQueries({ queryKey: orpc.rules.list.queryKey() });
	};

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
		onError: (e: Error) => toast.error(e.message),
	});

	const rows = rulesQ.data ?? [];

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

	const move = (index: number, dir: -1 | 1) => {
		const ids = rows.map((r) => r.id);
		const j = index + dir;
		if (j < 0 || j >= ids.length) return;
		[ids[index], ids[j]] = [ids[j], ids[index]];
		reorder.mutate({ orderedIds: ids });
	};

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
					<label className="flex flex-col gap-1 text-xs">
						<span className="text-muted-foreground">Category</span>
						<select
							value={form.assignCategoryKey}
							onChange={(e) =>
								setForm((f) => ({ ...f, assignCategoryKey: e.target.value }))
							}
							className={`${SELECT_CLASS} min-w-[12rem]`}
						>
							<option value="">— pick —</option>
							{groupByKind(cats, {
								activeOnly: true,
								keepKey: form.assignCategoryKey,
							}).map((g) => (
								<optgroup key={g.kind} label={g.label}>
									{g.cats.map((c) => (
										<option key={c.key} value={c.key}>
											{c.label}
										</option>
									))}
								</optgroup>
							))}
						</select>
					</label>
					{form.advanced && (
						<>
							<label className="flex flex-col gap-1 text-xs">
								<span className="text-muted-foreground">Match</span>
								<select
									value={form.matchType}
									onChange={(e) =>
										setForm((f) => ({
											...f,
											matchType: e.target.value as "substring" | "regex",
										}))
									}
									className={SELECT_CLASS}
								>
									<option value="substring">contains</option>
									<option value="regex">regex</option>
								</select>
							</label>
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
						first).
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
				<ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
					{rows.map((r, i) => {
						const cat = byKey.get(r.assignCategoryKey);
						const bounds = [
							r.minAmount != null ? `≥${r.minAmount}` : null,
							r.maxAmount != null ? `≤${r.maxAmount}` : null,
						]
							.filter(Boolean)
							.join(" ");
						return (
							<li
								key={r.id}
								className={`flex items-center gap-2 px-3 py-2.5 ${r.active ? "" : "opacity-50"}`}
							>
								<div className="flex flex-col">
									<button
										type="button"
										onClick={() => move(i, -1)}
										disabled={i === 0 || reorder.isPending}
										className="text-muted-foreground hover:text-foreground disabled:opacity-30"
										title="Move up"
									>
										<ChevronUp className="size-3.5" />
									</button>
									<button
										type="button"
										onClick={() => move(i, 1)}
										disabled={i === rows.length - 1 || reorder.isPending}
										className="text-muted-foreground hover:text-foreground disabled:opacity-30"
										title="Move down"
									>
										<ChevronDown className="size-3.5" />
									</button>
								</div>
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<code className="truncate text-sm">{r.pattern}</code>
										<span className="rounded-full bg-secondary px-1.5 py-0.5 text-[0.6rem] text-secondary-foreground uppercase tracking-wide">
											{r.matchType === "regex" ? "regex" : "contains"}
										</span>
										{bounds && (
											<span className="tnum text-muted-foreground text-xs">
												{bounds}
											</span>
										)}
									</div>
									<span
										className="text-xs"
										style={{ color: kindColor(r.assignKind) }}
									>
										→ {cat?.label ?? r.assignCategoryKey}
									</span>
								</div>
								<button
									type="button"
									onClick={() => update.mutate({ id: r.id, active: !r.active })}
									className="rounded-full px-2 py-0.5 text-[0.65rem] text-muted-foreground uppercase tracking-wide hover:text-foreground"
									title={r.active ? "Disable rule" : "Enable rule"}
								>
									{r.active ? "on" : "off"}
								</button>
								<button
									type="button"
									onClick={() =>
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
									className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
									title="Edit"
								>
									<Pencil className="size-3.5" />
								</button>
								<button
									type="button"
									onClick={() => remove.mutate({ id: r.id })}
									className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
									title="Delete"
								>
									<Trash2 className="size-3.5" />
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
