import {
	CATEGORIES,
	CATEGORY_BY_KEY,
	INVESTMENT_TYPES,
	type Investment,
	type InvestmentType,
	monthlyAmount,
	type RecurringExpense,
} from "@money/shared";
import { Button } from "@money/ui/components/button";
import { Input } from "@money/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, ChevronRight, Pencil, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { formatINR } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/plan")({ component: PlanPage });

/** Recurring-expense categories, sourced from the single shared taxonomy so budgets stay aligned to spend. */
const EXPENSE_CATEGORY_OPTIONS = [
	{ value: "", label: "— none —" },
	...CATEGORIES.filter((c) => c.kind === "expense").map((c) => ({
		value: c.key,
		label: c.label,
	})),
];

type IncomeClass = "income" | "growth";
type Payout = "cash" | "accrue";
type ExpenseCadence = "monthly" | "quarterly" | "half_yearly" | "yearly";

interface InvestmentDraft {
	name: string;
	type: InvestmentType;
	incomeClass: IncomeClass;
	group?: string;
	payout?: Payout;
	platform?: string;
	currentValue?: number;
	annualRate?: number;
	expectedMonthlyInterest?: number;
	maturityDate?: string;
}
interface RecurringDraft {
	name: string;
	amount: number;
	cadence: ExpenseCadence;
	category?: string;
}

// mirrors @money/shared HoldingRollup (kept local to avoid importing server-only shapes)
interface Rollup {
	group: string | null;
	name: string;
	value: number;
	rate: number | null;
	monthly: number;
	share: number;
	incomeClass: IncomeClass;
	members: Investment[];
	maturityDate?: string;
}
interface Tier {
	income: number;
	ratio: number | null;
}
interface Ladder {
	expenses: number;
	cash: Tier;
	fixed: Tier;
	total: Tier;
}

const TYPE_LABEL: Record<InvestmentType, string> = {
	bond: "Bond",
	p2p: "P2P",
	fd: "FD",
	ncd: "NCD",
	savings: "Savings",
	equity: "Equity",
	mutual_fund: "Mutual fund",
	gold: "Gold",
	other: "Other",
};
const EXPENSE_CADENCES: ExpenseCadence[] = [
	"monthly",
	"quarterly",
	"half_yearly",
	"yearly",
];
const CADENCE_LABEL: Record<string, string> = {
	monthly: "/mo",
	quarterly: "/qtr",
	half_yearly: "/6mo",
	yearly: "/yr",
};

const IN = "var(--covered)";
const OUT = "var(--uncovered)";
const tint = (c: string, pct: number) =>
	`color-mix(in oklab, ${c} ${pct}%, transparent)`;
const ratioStr = (r: number | null) => (r == null ? "—" : `${r.toFixed(2)}×`);
const pct1 = (r: number | null) =>
	r == null ? "—" : `${(r * 100).toFixed(1)}%`;

function PlanPage() {
	const qc = useQueryClient();
	const invalidate = () => qc.invalidateQueries();

	const ladder = useQuery(orpc.plan.ladder.queryOptions());
	const wealth = useQuery(orpc.plan.wealth.queryOptions());
	const recurring = useQuery(orpc.plan.recurring.queryOptions());

	const rollups = (wealth.data?.rollups ?? []) as Rollup[];
	const recs = [...(recurring.data ?? [])].sort(
		(a, b) => monthlyAmount(b) - monthlyAmount(a),
	);
	const maxIn = Math.max(1, ...rollups.map((r) => r.monthly));
	const maxOut = Math.max(1, ...recs.map(monthlyAmount));

	return (
		<main className="h-full overflow-y-auto">
			<div className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
				<header className="flex flex-col gap-1">
					<h1 className="font-display font-medium text-3xl tracking-tight">
						Plan
					</h1>
					<p className="text-muted-foreground">
						Passive income you expect vs the recurring life it has to cover —
						laddered from cash-in-hand up to total return.
					</p>
				</header>

				<LadderCard ladder={ladder.data as Ladder | undefined} />

				<div className="grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2">
					<IncomingColumn rollups={rollups} max={maxIn} onDone={invalidate} />
					<OutgoingColumn rows={recs} max={maxOut} onDone={invalidate} />
				</div>
			</div>
		</main>
	);
}

// ── coverage ladder ───────────────────────────────────────────────────────────────────────────────────
function LadderCard({ ladder }: { ladder: Ladder | undefined }) {
	const total = ladder?.total.ratio ?? null;
	const free = total != null && total >= 1;
	const accent = free ? IN : OUT;
	const tiers = [
		{ key: "cash", label: "Cash in hand", t: ladder?.cash },
		{ key: "fixed", label: "+ Fixed income", t: ladder?.fixed },
		{ key: "total", label: "+ Total return", t: ladder?.total },
	];
	return (
		<section className="flex flex-col gap-5 rounded-2xl border border-border bg-card/40 px-6 py-6">
			<div className="flex items-end justify-between">
				<div>
					<p className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
						Coverage
					</p>
					<p
						className="tnum font-display font-medium text-5xl leading-none"
						style={{ color: accent }}
					>
						{ratioStr(total)}
					</p>
				</div>
				<div className="text-right">
					<p
						className="tnum font-display font-medium text-xl"
						style={{ color: OUT }}
					>
						{formatINR(ladder?.expenses ?? 0)}
					</p>
					<p className="text-muted-foreground text-xs">recurring / mo</p>
				</div>
			</div>
			<div className="flex flex-col gap-2.5">
				{tiers.map(({ key, label, t }) => {
					const r = t?.ratio ?? 0;
					return (
						<div key={key} className="flex items-center gap-3">
							<span className="w-28 shrink-0 text-muted-foreground text-xs">
								{label}
							</span>
							<div className="relative h-5 flex-1 overflow-hidden rounded bg-muted/60">
								<div
									className="h-full rounded transition-[width] duration-500"
									style={{
										width: `${Math.min(100, r * 100)}%`,
										background: tint(IN, key === "total" ? 55 : 30),
									}}
								/>
								{/* 1.0× marker */}
								<div className="absolute inset-y-0 right-0 w-px bg-foreground/30" />
							</div>
							<span
								className="tnum w-14 shrink-0 text-right font-medium text-sm"
								style={{ color: IN }}
							>
								{ratioStr(t?.ratio ?? null)}
							</span>
							<span className="tnum w-20 shrink-0 text-right text-muted-foreground text-xs">
								{formatINR(t?.income ?? 0)}
							</span>
						</div>
					);
				})}
			</div>
			<p className="text-muted-foreground text-xs">
				The right edge is <span className="text-foreground/70">1.0×</span> —
				passive income fully covers recurring expenses. Cash ⊆ fixed-income ⊆
				total return.
			</p>
		</section>
	);
}

// ── Incoming (grouped investments) ────────────────────────────────────────────────────────────────────
function IncomingColumn({
	rollups,
	max,
	onDone,
}: {
	rollups: Rollup[];
	max: number;
	onDone: () => void;
}) {
	const [editing, setEditing] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const add = useMutation({
		...orpc.plan.addInvestment.mutationOptions(),
		onSuccess: onDone,
	});
	const update = useMutation({
		...orpc.plan.updateInvestment.mutationOptions(),
		onSuccess: onDone,
	});
	const del = useMutation({
		...orpc.plan.deleteInvestment.mutationOptions(),
		onSuccess: onDone,
	});

	const editRow = (inv: Investment) => (
		<InvestmentForm
			initial={inv}
			pending={update.isPending}
			submitLabel="Save"
			onCancel={() => setEditing(null)}
			onDelete={() => {
				del.mutate({ id: Number(inv.id) });
				setEditing(null);
			}}
			onSubmit={(d) => {
				update.mutate({ id: Number(inv.id), ...d });
				setEditing(null);
			}}
		/>
	);

	return (
		<section className="flex flex-col">
			<ColHeader tone={IN} label="Incoming" />
			<ul className="flex flex-col">
				{rollups.length === 0 && !adding && <Empty>No holdings yet.</Empty>}
				{rollups.map((r) =>
					r.group ? (
						<GroupRow
							key={`g:${r.group}`}
							rollup={r}
							pct={(r.monthly / max) * 100}
							editing={editing}
							setEditing={setEditing}
							editRow={editRow}
						/>
					) : editing === r.members[0]?.id ? (
						<li key={r.members[0]?.id} className="border-border border-b py-2">
							{r.members[0] && editRow(r.members[0])}
						</li>
					) : (
						<StandaloneRow
							key={r.members[0]?.id ?? r.name}
							rollup={r}
							pct={(r.monthly / max) * 100}
							onEdit={() => setEditing(r.members[0]?.id ?? null)}
							onDelete={() =>
								r.members[0] && del.mutate({ id: Number(r.members[0].id) })
							}
						/>
					),
				)}
			</ul>
			{adding ? (
				<div className="border-border border-t py-2">
					<InvestmentForm
						pending={add.isPending}
						submitLabel="Add"
						onCancel={() => setAdding(false)}
						onSubmit={(d) => {
							add.mutate(d);
							setAdding(false);
						}}
					/>
				</div>
			) : (
				<AddButton onClick={() => setAdding(true)}>Add holding</AddButton>
			)}
		</section>
	);
}

function StandaloneRow({
	rollup,
	pct,
	onEdit,
	onDelete,
}: {
	rollup: Rollup;
	pct: number;
	onEdit: () => void;
	onDelete: () => void;
}) {
	return (
		<li className="group relative flex items-center gap-3 border-border border-b py-2.5">
			<Depth pct={pct} side="right" tone={IN} />
			<RowActions onEdit={onEdit} onDelete={onDelete} />
			<div className="relative min-w-0 flex-1">
				<p className="truncate font-medium">{rollup.name}</p>
				<p className="text-muted-foreground text-xs">
					{rollup.incomeClass === "growth" ? "growth" : "income"}
					{rollup.rate != null ? ` · ${pct1(rollup.rate)}` : ""}
				</p>
			</div>
			<Amount value={rollup.value} monthly={rollup.monthly} />
		</li>
	);
}

function GroupRow({
	rollup,
	pct,
	editing,
	setEditing,
	editRow,
}: {
	rollup: Rollup;
	pct: number;
	editing: string | null;
	setEditing: (id: string | null) => void;
	editRow: (inv: Investment) => ReactNode;
}) {
	const [open, setOpen] = useState(false);
	return (
		<li className="border-border border-b">
			<div className="group relative flex items-center gap-3 py-2.5">
				<Depth pct={pct} side="right" tone={IN} />
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					className="relative flex min-w-0 flex-1 items-center gap-2 text-left"
				>
					<ChevronRight
						className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
					/>
					<span className="min-w-0">
						<span className="block truncate font-medium">{rollup.name}</span>
						<span className="block text-muted-foreground text-xs">
							{rollup.members.length} holdings
							{rollup.rate != null ? ` · ${pct1(rollup.rate)} wtd` : ""}
						</span>
					</span>
				</button>
				<Amount value={rollup.value} monthly={rollup.monthly} />
			</div>
			{open && (
				<ul className="mb-2 flex flex-col gap-px border-border border-l pl-3">
					{rollup.members.map((m) =>
						editing === m.id ? (
							<li key={m.id} className="py-2">
								{editRow(m)}
							</li>
						) : (
							<MemberRow key={m.id} inv={m} onEdit={() => setEditing(m.id)} />
						),
					)}
				</ul>
			)}
		</li>
	);
}

function MemberRow({ inv, onEdit }: { inv: Investment; onEdit: () => void }) {
	const monthly =
		inv.expectedMonthlyInterest ??
		((inv.currentValue ?? 0) * (inv.annualRate ?? 0)) / 12;
	return (
		<li className="group flex items-center gap-3 py-1.5">
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm">{inv.name}</p>
				<p className="text-muted-foreground text-xs">
					{formatINR(inv.currentValue ?? 0)}
					{inv.annualRate != null ? ` · ${pct1(inv.annualRate)}` : ""}
					{inv.maturityDate ? ` · ${inv.maturityDate}` : ""}
				</p>
			</div>
			<span className="tnum text-sm" style={{ color: IN }}>
				{formatINR(monthly)}
				<span className="text-[0.6rem] text-muted-foreground">/mo</span>
			</span>
			<button
				type="button"
				onClick={onEdit}
				aria-label={`Edit ${inv.name}`}
				className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100"
			>
				<Pencil className="size-3.5" />
			</button>
		</li>
	);
}

function Amount({ value, monthly }: { value: number; monthly: number }) {
	return (
		<div className="relative text-right">
			<p className="tnum font-medium" style={{ color: IN }}>
				{formatINR(monthly)}
				<span className="text-[0.6rem] text-muted-foreground"> /mo</span>
			</p>
			<p className="tnum text-muted-foreground text-xs">{formatINR(value)}</p>
		</div>
	);
}

// ── Outgoing (recurring expenses) ─────────────────────────────────────────────────────────────────────
function OutgoingColumn({
	rows,
	max,
	onDone,
}: {
	rows: RecurringExpense[];
	max: number;
	onDone: () => void;
}) {
	const [editing, setEditing] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const add = useMutation({
		...orpc.plan.addRecurring.mutationOptions(),
		onSuccess: onDone,
	});
	const update = useMutation({
		...orpc.plan.updateRecurring.mutationOptions(),
		onSuccess: onDone,
	});
	const del = useMutation({
		...orpc.plan.deleteRecurring.mutationOptions(),
		onSuccess: onDone,
	});

	return (
		<section className="flex flex-col">
			<ColHeader tone={OUT} label="Outgoing" side="right" />
			<ul className="flex flex-col">
				{rows.length === 0 && !adding && (
					<Empty>No recurring expenses yet.</Empty>
				)}
				{rows.map((exp) =>
					editing === exp.id ? (
						<li key={exp.id} className="border-border border-b py-2">
							<ExpenseForm
								initial={exp}
								pending={update.isPending}
								submitLabel="Save"
								onCancel={() => setEditing(null)}
								onDelete={() => {
									del.mutate({ id: Number(exp.id) });
									setEditing(null);
								}}
								onSubmit={(d) => {
									update.mutate({ id: Number(exp.id), ...d });
									setEditing(null);
								}}
							/>
						</li>
					) : (
						<OutgoingRow
							key={exp.id}
							exp={exp}
							pct={(monthlyAmount(exp) / max) * 100}
							onEdit={() => setEditing(exp.id)}
							onDelete={() => del.mutate({ id: Number(exp.id) })}
						/>
					),
				)}
			</ul>
			{adding ? (
				<div className="border-border border-t py-2">
					<ExpenseForm
						pending={add.isPending}
						submitLabel="Add"
						onCancel={() => setAdding(false)}
						onSubmit={(d) => {
							add.mutate(d);
							setAdding(false);
						}}
					/>
				</div>
			) : (
				<AddButton onClick={() => setAdding(true)}>
					Add recurring expense
				</AddButton>
			)}
		</section>
	);
}

function OutgoingRow({
	exp,
	pct,
	onEdit,
	onDelete,
}: {
	exp: RecurringExpense;
	pct: number;
	onEdit: () => void;
	onDelete: () => void;
}) {
	return (
		<li className="group relative flex items-center gap-3 border-border border-b py-2.5">
			<Depth pct={pct} side="left" tone={OUT} />
			<div className="relative text-left">
				<p className="tnum font-medium" style={{ color: OUT }}>
					{formatINR(monthlyAmount(exp))}
				</p>
				<p className="text-[0.6rem] text-muted-foreground">
					{exp.cadence === "monthly"
						? "/mo"
						: `${formatINR(exp.amount)}${CADENCE_LABEL[exp.cadence] ?? ""}`}
				</p>
			</div>
			<div className="relative min-w-0 flex-1 text-right">
				<p className="truncate font-medium">{exp.name}</p>
				{exp.category && (
					<p className="text-muted-foreground text-xs">
						{CATEGORY_BY_KEY.get(exp.category)?.label ?? exp.category}
					</p>
				)}
			</div>
			<RowActions onEdit={onEdit} onDelete={onDelete} />
		</li>
	);
}

// ── forms ─────────────────────────────────────────────────────────────────────────────────────────────
function InvestmentForm({
	initial,
	pending,
	submitLabel,
	onSubmit,
	onCancel,
	onDelete,
}: {
	initial?: Investment;
	pending: boolean;
	submitLabel: string;
	onSubmit: (d: InvestmentDraft) => void;
	onCancel?: () => void;
	onDelete?: () => void;
}) {
	const [cls, setCls] = useState<IncomeClass>(initial?.incomeClass ?? "income");
	const [payout, setPayout] = useState<Payout>(
		(initial?.payout as Payout) ?? "cash",
	);
	const [name, setName] = useState(initial?.name ?? "");
	const [type, setType] = useState<InvestmentType>(initial?.type ?? "bond");
	const [group, setGroup] = useState(initial?.group ?? "");
	const [platform, setPlatform] = useState(initial?.platform ?? "");
	const [value, setValue] = useState(str(initial?.currentValue));
	const [ratePct, setRatePct] = useState(
		initial?.annualRate != null
			? String(Math.round(initial.annualRate * 1000) / 10)
			: "",
	);
	const [monthly, setMonthly] = useState(str(initial?.expectedMonthlyInterest));
	const [maturity, setMaturity] = useState(initial?.maturityDate ?? "");

	function submit(e: FormEvent) {
		e.preventDefault();
		if (!name.trim()) return;
		const d: InvestmentDraft = { name: name.trim(), type, incomeClass: cls };
		if (group.trim()) d.group = group.trim();
		if (platform.trim()) d.platform = platform.trim();
		if (value) d.currentValue = Number(value);
		if (ratePct) d.annualRate = Number(ratePct) / 100;
		if (maturity.trim()) d.maturityDate = maturity.trim();
		if (cls === "income") {
			d.payout = payout;
			if (monthly) d.expectedMonthlyInterest = Number(monthly);
		}
		onSubmit(d);
	}

	return (
		<form onSubmit={submit} className="flex flex-col gap-2.5">
			<div className="flex flex-wrap gap-2">
				<Pill active={cls === "income"} onClick={() => setCls("income")}>
					Income
				</Pill>
				<Pill active={cls === "growth"} onClick={() => setCls("growth")}>
					Growth
				</Pill>
				{cls === "income" && (
					<>
						<span className="w-2" />
						<Pill active={payout === "cash"} onClick={() => setPayout("cash")}>
							Cash payout
						</Pill>
						<Pill
							active={payout === "accrue"}
							onClick={() => setPayout("accrue")}
						>
							Accrues
						</Pill>
					</>
				)}
			</div>
			<div className="grid grid-cols-2 gap-2">
				<Field label="Name">
					<Input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Wint T1"
						required
					/>
				</Field>
				<Field label="Type">
					<NativeSelect
						value={type}
						onChange={(v) => setType(v as InvestmentType)}
						options={INVESTMENT_TYPES.map((t) => ({
							value: t,
							label: TYPE_LABEL[t],
						}))}
					/>
				</Field>
				<Field label="Group (optional)">
					<Input
						value={group}
						onChange={(e) => setGroup(e.target.value)}
						placeholder="SustVest, Wint, FDs…"
					/>
				</Field>
				<Field label="Platform">
					<Input
						value={platform}
						onChange={(e) => setPlatform(e.target.value)}
						placeholder="provider"
					/>
				</Field>
				<Field label="Value ₹">
					<Input
						type="number"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						className="tnum"
						placeholder="100000"
					/>
				</Field>
				<Field label="XIRR % / yr">
					<Input
						type="number"
						step="0.1"
						value={ratePct}
						onChange={(e) => setRatePct(e.target.value)}
						className="tnum"
						placeholder="11"
					/>
				</Field>
				{cls === "income" && (
					<Field label="…or ₹ interest / mo">
						<Input
							type="number"
							value={monthly}
							onChange={(e) => setMonthly(e.target.value)}
							className="tnum"
							placeholder="explicit payout"
						/>
					</Field>
				)}
				<Field label="Maturity (YYYY-MM-DD)">
					<Input
						value={maturity}
						onChange={(e) => setMaturity(e.target.value)}
						placeholder="2026-08-15"
					/>
				</Field>
			</div>
			<FormActions
				pending={pending}
				submitLabel={submitLabel}
				disabled={!name.trim()}
				onCancel={onCancel}
				onDelete={onDelete}
			/>
		</form>
	);
}

function ExpenseForm({
	initial,
	pending,
	submitLabel,
	onSubmit,
	onCancel,
	onDelete,
}: {
	initial?: RecurringExpense;
	pending: boolean;
	submitLabel: string;
	onSubmit: (d: RecurringDraft) => void;
	onCancel?: () => void;
	onDelete?: () => void;
}) {
	const [name, setName] = useState(initial?.name ?? "");
	const [amount, setAmount] = useState(str(initial?.amount));
	const [category, setCategory] = useState(initial?.category ?? "");
	const [cadence, setCadence] = useState<ExpenseCadence>(
		(initial?.cadence as ExpenseCadence) ?? "monthly",
	);

	function submit(e: FormEvent) {
		e.preventDefault();
		if (!name.trim() || !amount) return;
		const d: RecurringDraft = {
			name: name.trim(),
			amount: Number(amount),
			cadence,
		};
		if (category.trim()) d.category = category.trim();
		onSubmit(d);
	}

	return (
		<form onSubmit={submit} className="flex flex-col gap-2.5">
			<div className="grid grid-cols-2 gap-2">
				<Field label="Name">
					<Input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Rent"
						required
					/>
				</Field>
				<Field label="Category">
					<NativeSelect
						value={category}
						onChange={setCategory}
						options={EXPENSE_CATEGORY_OPTIONS}
					/>
				</Field>
				<Field label="Amount ₹">
					<Input
						type="number"
						value={amount}
						onChange={(e) => setAmount(e.target.value)}
						className="tnum"
						placeholder="12000"
					/>
				</Field>
				<Field label="Cadence">
					<NativeSelect
						value={cadence}
						onChange={(v) => setCadence(v as ExpenseCadence)}
						options={EXPENSE_CADENCES.map((c) => ({
							value: c,
							label: c.replace("_", "-"),
						}))}
					/>
				</Field>
			</div>
			<FormActions
				pending={pending}
				submitLabel={submitLabel}
				disabled={!name.trim() || !amount}
				onCancel={onCancel}
				onDelete={onDelete}
			/>
		</form>
	);
}

// ── shared bits ───────────────────────────────────────────────────────────────────────────────────────
function ColHeader({
	tone,
	label,
	side,
}: {
	tone: string;
	label: string;
	side?: "left" | "right";
}) {
	return (
		<div
			className={`flex items-center gap-2 border-b-2 pb-2 ${side === "right" ? "flex-row-reverse" : ""}`}
			style={{ borderColor: tint(tone, 40) }}
		>
			<span className="size-2 rounded-full" style={{ backgroundColor: tone }} />
			<h2 className="font-display font-medium text-lg">{label}</h2>
		</div>
	);
}

function Depth({
	pct,
	side,
	tone,
}: {
	pct: number;
	side: "left" | "right";
	tone: string;
}) {
	return (
		<div
			className={`pointer-events-none absolute inset-y-1 ${side === "right" ? "right-0" : "left-0"} rounded-sm`}
			style={{ width: `${Math.max(pct, 1.5)}%`, background: tint(tone, 12) }}
		/>
	);
}

function RowActions({
	onEdit,
	onDelete,
}: {
	onEdit: () => void;
	onDelete: () => void;
}) {
	return (
		<div className="relative flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
			<button
				type="button"
				onClick={onEdit}
				aria-label="Edit"
				className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
			>
				<Pencil className="size-3.5" />
			</button>
			<button
				type="button"
				onClick={onDelete}
				aria-label="Delete"
				className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-[var(--uncovered)]"
			>
				<Trash2 className="size-3.5" />
			</button>
		</div>
	);
}

function FormActions({
	pending,
	submitLabel,
	disabled,
	onCancel,
	onDelete,
}: {
	pending: boolean;
	submitLabel: string;
	disabled: boolean;
	onCancel?: () => void;
	onDelete?: () => void;
}) {
	return (
		<div className="flex items-center gap-2">
			<Button type="submit" size="sm" disabled={pending || disabled}>
				<Check className="size-3.5" /> {submitLabel}
			</Button>
			{onCancel && (
				<Button type="button" size="sm" variant="ghost" onClick={onCancel}>
					<X className="size-3.5" /> Cancel
				</Button>
			)}
			{onDelete && (
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={onDelete}
					className="ml-auto text-muted-foreground hover:text-[var(--uncovered)]"
				>
					<Trash2 className="size-3.5" /> Delete
				</Button>
			)}
		</div>
	);
}

function AddButton({
	onClick,
	children,
}: {
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="mt-2 flex items-center gap-2 self-start rounded-lg px-2 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-secondary hover:text-foreground"
		>
			<Plus className="size-4" /> {children}
		</button>
	);
}

function Empty({ children }: { children: ReactNode }) {
	return <li className="py-4 text-muted-foreground text-sm">{children}</li>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-1">
			<span className="text-muted-foreground text-xs">{label}</span>
			{children}
		</div>
	);
}

function Pill({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`rounded-full border px-3 py-1 text-sm transition-colors ${active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-secondary"}`}
		>
			{children}
		</button>
	);
}

function NativeSelect({
	value,
	onChange,
	options,
}: {
	value: string;
	onChange: (v: string) => void;
	options: { value: string; label: string }[];
}) {
	return (
		<select
			value={value}
			onChange={(e) => onChange(e.target.value)}
			className="h-9 rounded-md border border-input bg-background px-3 text-foreground text-sm shadow-xs outline-none [color-scheme:light] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:[color-scheme:dark]"
		>
			{options.map((o) => (
				<option
					key={o.value}
					value={o.value}
					className="bg-popover text-popover-foreground"
				>
					{o.label}
				</option>
			))}
		</select>
	);
}

function str(n: number | undefined): string {
	return n != null ? String(n) : "";
}
