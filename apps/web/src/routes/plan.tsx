import {
	expectedMonthlyInterest,
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
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { formatINR, formatRatio } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/plan")({ component: PlanPage });

type IncomeClass = "income" | "growth";
type ExpenseCadence = "monthly" | "quarterly" | "half_yearly" | "yearly";

interface InvestmentDraft {
	name: string;
	type: InvestmentType;
	incomeClass: IncomeClass;
	platform?: string;
	principal?: number;
	annualRate?: number;
	expectedMonthlyInterest?: number;
	currentValue?: number;
}
interface RecurringDraft {
	name: string;
	amount: number;
	cadence: ExpenseCadence;
	category?: string;
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

function PlanPage() {
	const qc = useQueryClient();
	const invalidate = () => qc.invalidateQueries();

	const coverage = useQuery(orpc.plan.coverage.queryOptions());
	const investments = useQuery(orpc.plan.investments.queryOptions());
	const recurring = useQuery(orpc.plan.recurring.queryOptions());
	const settings = useQuery(orpc.plan.settings.queryOptions());

	const enabled = settings.data?.enabled ?? false;
	const rate = settings.data?.rate ?? 0.04;

	/** what a holding actually contributes to the monthly numerator right now */
	const contribution = (inv: Investment) =>
		inv.incomeClass === "income"
			? expectedMonthlyInterest(inv)
			: enabled
				? ((inv.currentValue ?? 0) * rate) / 12
				: 0;

	const invs = [...(investments.data ?? [])].sort(
		(a, b) => contribution(b) - contribution(a),
	);
	const recs = [...(recurring.data ?? [])].sort(
		(a, b) => monthlyAmount(b) - monthlyAmount(a),
	);
	const maxIn = Math.max(1, ...invs.map(contribution));
	const maxOut = Math.max(1, ...recs.map(monthlyAmount));

	return (
		<main className="h-full overflow-y-auto">
			<div className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
				<header className="flex flex-col gap-1">
					<h1 className="font-display font-medium text-3xl tracking-tight">
						Plan
					</h1>
					<p className="text-muted-foreground">
						Passive income you expect vs the recurring life it has to cover.
						This — not the statement — drives your coverage.
					</p>
				</header>

				<Book
					cov={coverage.data}
					enabled={enabled}
					rate={rate}
					onDone={invalidate}
				/>

				<div className="grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2">
					<IncomingColumn
						rows={invs}
						contribution={contribution}
						max={maxIn}
						enabled={enabled}
						onDone={invalidate}
					/>
					<OutgoingColumn rows={recs} max={maxOut} onDone={invalidate} />
				</div>
			</div>
		</main>
	);
}

// ── the order-book header: incoming Σ ▏ coverage ▏ outgoing Σ ───────────────────────────────────────
function Book({
	cov,
	enabled,
	rate,
	onDone,
}: {
	cov:
		| {
				interest: number;
				drawdown: number;
				passiveIncome: number;
				expenses: number;
				ratio: number | null;
		  }
		| undefined;
	enabled: boolean;
	rate: number;
	onDone: () => void;
}) {
	const setDrawdown = useMutation({
		...orpc.plan.setDrawdown.mutationOptions(),
		onSuccess: onDone,
	});
	const [ratePct, setRatePct] = useState(String(Math.round(rate * 1000) / 10));
	const ratio = cov?.ratio ?? null;
	const covered = ratio != null && ratio >= 1;
	const accent = covered ? IN : OUT;
	const gap = Math.max(0, (cov?.expenses ?? 0) - (cov?.passiveIncome ?? 0));

	return (
		<section className="overflow-hidden rounded-2xl border border-border bg-card/40">
			<div className="grid grid-cols-3 items-center gap-3 px-6 py-6">
				<div>
					<p
						className="text-[0.65rem] uppercase tracking-[0.2em]"
						style={{ color: IN }}
					>
						Incoming
					</p>
					<p
						className="tnum font-display font-medium text-2xl"
						style={{ color: IN }}
					>
						{formatINR(cov?.passiveIncome ?? 0)}
					</p>
					<p className="text-muted-foreground text-xs">passive / mo</p>
				</div>
				<div className="text-center">
					<p className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
						Coverage
					</p>
					<p
						className="tnum font-display font-medium text-5xl leading-none"
						style={{ color: accent }}
					>
						{ratio == null ? "—" : formatRatio(ratio)}
					</p>
					<p className="mt-1 text-muted-foreground text-xs">
						{gap > 0 ? `${formatINR(gap)} short` : "fully covered"}
					</p>
				</div>
				<div className="text-right">
					<p
						className="text-[0.65rem] uppercase tracking-[0.2em]"
						style={{ color: OUT }}
					>
						Outgoing
					</p>
					<p
						className="tnum font-display font-medium text-2xl"
						style={{ color: OUT }}
					>
						{formatINR(cov?.expenses ?? 0)}
					</p>
					<p className="text-muted-foreground text-xs">recurring / mo</p>
				</div>
			</div>

			{/* incoming vs outgoing balance bar */}
			<BalanceBar
				income={cov?.passiveIncome ?? 0}
				expense={cov?.expenses ?? 0}
			/>

			<div className="flex flex-wrap items-center justify-center gap-3 border-border border-t px-6 py-3 text-sm">
				<span className="text-muted-foreground">
					Imputed drawdown on growth
				</span>
				<button
					type="button"
					onClick={() => setDrawdown.mutate({ enabled: !enabled })}
					className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
					style={{ backgroundColor: enabled ? IN : "var(--muted)" }}
					aria-pressed={enabled}
					aria-label={
						enabled ? "Disable imputed drawdown" : "Enable imputed drawdown"
					}
				>
					<span
						className="absolute top-0.5 size-4 rounded-full bg-background transition-all"
						style={{ left: enabled ? "1.125rem" : "0.125rem" }}
					/>
				</button>
				<Input
					type="number"
					step="0.1"
					value={ratePct}
					disabled={!enabled}
					onChange={(e) => setRatePct(e.target.value)}
					onBlur={() => {
						const r = Number(ratePct) / 100;
						if (Number.isFinite(r) && r >= 0 && r <= 1)
							setDrawdown.mutate({ rate: r });
					}}
					className="tnum h-7 w-16"
				/>
				<span className="text-muted-foreground">% / yr</span>
			</div>
		</section>
	);
}

function BalanceBar({ income, expense }: { income: number; expense: number }) {
	const total = Math.max(1, income + expense);
	const inPct = (income / total) * 100;
	return (
		<div className="flex h-1.5 w-full">
			<div style={{ width: `${inPct}%`, backgroundColor: IN }} />
			<div
				style={{ width: `${100 - inPct}%`, backgroundColor: tint(OUT, 55) }}
			/>
		</div>
	);
}

// ── Incoming column (investments) ───────────────────────────────────────────────────────────────────
function IncomingColumn({
	rows,
	contribution,
	max,
	enabled,
	onDone,
}: {
	rows: Investment[];
	contribution: (inv: Investment) => number;
	max: number;
	enabled: boolean;
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

	return (
		<section className="flex flex-col">
			<ColHeader tone={IN} label="Incoming" side="left" />
			<ul className="flex flex-col">
				{rows.length === 0 && !adding && <Empty>No holdings yet.</Empty>}
				{rows.map((inv) =>
					editing === inv.id ? (
						<li key={inv.id} className="border-border border-b py-2">
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
						</li>
					) : (
						<IncomingRow
							key={inv.id}
							inv={inv}
							amount={contribution(inv)}
							pct={(contribution(inv) / max) * 100}
							dimmed={inv.incomeClass === "growth" && !enabled}
							onEdit={() => setEditing(inv.id)}
							onDelete={() => del.mutate({ id: Number(inv.id) })}
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
				<AddButton onClick={() => setAdding(true)}>Add income source</AddButton>
			)}
		</section>
	);
}

function IncomingRow({
	inv,
	amount,
	pct,
	dimmed,
	onEdit,
	onDelete,
}: {
	inv: Investment;
	amount: number;
	pct: number;
	dimmed: boolean;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const meta =
		inv.incomeClass === "income"
			? `${TYPE_LABEL[inv.type]}${inv.platform ? ` · ${inv.platform}` : ""}`
			: `growth${inv.platform ? ` · ${inv.platform}` : ""}${dimmed ? " · drawdown off" : ""}`;

	return (
		<li className="group relative flex items-center gap-3 border-border border-b py-2.5">
			<div
				className="pointer-events-none absolute inset-y-1 right-0 rounded-sm"
				style={{ width: `${Math.max(pct, 1.5)}%`, background: tint(IN, 12) }}
			/>
			<RowActions onEdit={onEdit} onDelete={onDelete} />
			<div className={`relative min-w-0 flex-1 ${dimmed ? "opacity-50" : ""}`}>
				<p className="truncate font-medium">{inv.name}</p>
				<p className="text-muted-foreground text-xs">{meta}</p>
			</div>
			<div className="relative text-right">
				<p
					className="tnum font-medium"
					style={{ color: dimmed ? undefined : IN }}
				>
					{formatINR(amount)}
				</p>
				<p className="text-[0.65rem] text-muted-foreground">
					{inv.incomeClass === "income" ? "interest /mo" : "drawdown /mo"}
				</p>
			</div>
		</li>
	);
}

// ── Outgoing column (recurring expenses) ────────────────────────────────────────────────────────────
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
			<div
				className="pointer-events-none absolute inset-y-1 left-0 rounded-sm"
				style={{ width: `${Math.max(pct, 1.5)}%`, background: tint(OUT, 12) }}
			/>
			<div className="relative text-left">
				<p className="tnum font-medium" style={{ color: OUT }}>
					{formatINR(monthlyAmount(exp))}
				</p>
				<p className="text-[0.65rem] text-muted-foreground">
					{exp.cadence === "monthly"
						? "/mo"
						: `${formatINR(exp.amount)}${CADENCE_LABEL[exp.cadence] ?? ""}`}
				</p>
			</div>
			<div className="relative min-w-0 flex-1 text-right">
				<p className="truncate font-medium">{exp.name}</p>
				{exp.category && (
					<p className="text-muted-foreground text-xs">{exp.category}</p>
				)}
			</div>
			<RowActions onEdit={onEdit} onDelete={onDelete} />
		</li>
	);
}

// ── forms (shared by add + edit) ────────────────────────────────────────────────────────────────────
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
	const [name, setName] = useState(initial?.name ?? "");
	const [type, setType] = useState<InvestmentType>(initial?.type ?? "bond");
	const [platform, setPlatform] = useState(initial?.platform ?? "");
	const [principal, setPrincipal] = useState(str(initial?.principal));
	const [ratePct, setRatePct] = useState(
		initial?.annualRate != null
			? String(Math.round(initial.annualRate * 1000) / 10)
			: "",
	);
	const [monthly, setMonthly] = useState(str(initial?.expectedMonthlyInterest));
	const [currentValue, setCurrentValue] = useState(str(initial?.currentValue));

	function submit(e: FormEvent) {
		e.preventDefault();
		if (!name.trim()) return;
		const d: InvestmentDraft = { name: name.trim(), type, incomeClass: cls };
		if (platform.trim()) d.platform = platform.trim();
		if (cls === "income") {
			if (principal) d.principal = Number(principal);
			if (ratePct) d.annualRate = Number(ratePct) / 100;
			if (monthly) d.expectedMonthlyInterest = Number(monthly);
		} else if (currentValue) {
			d.currentValue = Number(currentValue);
		}
		onSubmit(d);
	}

	return (
		<form onSubmit={submit} className="flex flex-col gap-2.5">
			<div className="flex gap-2">
				<Pill active={cls === "income"} onClick={() => setCls("income")}>
					Income
				</Pill>
				<Pill active={cls === "growth"} onClick={() => setCls("growth")}>
					Growth
				</Pill>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<Field label="Name">
					<Input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Wint bond"
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
				<Field label="Platform">
					<Input
						value={platform}
						onChange={(e) => setPlatform(e.target.value)}
						placeholder="SustVest…"
					/>
				</Field>
				{cls === "income" ? (
					<>
						<Field label="Principal ₹">
							<Input
								type="number"
								value={principal}
								onChange={(e) => setPrincipal(e.target.value)}
								className="tnum"
								placeholder="100000"
							/>
						</Field>
						<Field label="Rate % / yr">
							<Input
								type="number"
								step="0.1"
								value={ratePct}
								onChange={(e) => setRatePct(e.target.value)}
								className="tnum"
								placeholder="11"
							/>
						</Field>
						<Field label="…or ₹ interest / mo">
							<Input
								type="number"
								value={monthly}
								onChange={(e) => setMonthly(e.target.value)}
								className="tnum"
								placeholder="amortising P2P"
							/>
						</Field>
					</>
				) : (
					<Field label="Current value ₹">
						<Input
							type="number"
							value={currentValue}
							onChange={(e) => setCurrentValue(e.target.value)}
							className="tnum"
							placeholder="500000"
						/>
					</Field>
				)}
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
					<Input
						value={category}
						onChange={(e) => setCategory(e.target.value)}
						placeholder="rent, health…"
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

// ── little shared bits ──────────────────────────────────────────────────────────────────────────────
function ColHeader({
	tone,
	label,
	side,
}: {
	tone: string;
	label: string;
	side: "left" | "right";
}) {
	return (
		<div
			className={`flex items-center gap-2 border-border border-b-2 pb-2 ${side === "right" ? "flex-row-reverse" : ""}`}
			style={{ borderColor: tint(tone, 40) }}
		>
			<span className="size-2 rounded-full" style={{ backgroundColor: tone }} />
			<h2 className="font-display font-medium text-lg">{label}</h2>
		</div>
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
