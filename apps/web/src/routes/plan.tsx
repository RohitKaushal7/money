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
import { Label } from "@money/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { formatINR, formatPct, formatRatio } from "@/lib/format";
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

function PlanPage() {
	const qc = useQueryClient();
	const invalidate = () => qc.invalidateQueries();

	const coverage = useQuery(orpc.plan.coverage.queryOptions());
	const investments = useQuery(orpc.plan.investments.queryOptions());
	const recurring = useQuery(orpc.plan.recurring.queryOptions());
	const settings = useQuery(orpc.plan.settings.queryOptions());

	return (
		<main className="h-full overflow-y-auto">
			<div className="mx-auto flex max-w-4xl flex-col gap-12 px-5 py-10 sm:px-8 sm:py-14">
				<header className="flex flex-col gap-1">
					<h1 className="font-display font-medium text-3xl tracking-tight">
						Plan
					</h1>
					<p className="text-muted-foreground">
						The investments that throw off interest, and the recurring expenses
						they need to cover. This — not the statement — drives your coverage.
					</p>
				</header>

				<CoverageStrip data={coverage.data} />

				<DrawdownControl
					enabled={settings.data?.enabled ?? false}
					rate={settings.data?.rate ?? 0.04}
					onChange={invalidate}
				/>

				<InvestmentsSection
					rows={investments.data ?? []}
					onChange={invalidate}
				/>

				<RecurringSection rows={recurring.data ?? []} onChange={invalidate} />
			</div>
		</main>
	);
}

function CoverageStrip({
	data,
}: {
	data:
		| {
				interest: number;
				drawdown: number;
				passiveIncome: number;
				expenses: number;
				ratio: number | null;
		  }
		| undefined;
}) {
	const ratio = data?.ratio ?? null;
	const covered = ratio != null && ratio >= 1;
	const accent = covered ? "var(--covered)" : "var(--uncovered)";
	return (
		<section className="flex flex-wrap items-center gap-x-10 gap-y-4 rounded-2xl border border-border bg-card/40 px-6 py-5">
			<div className="flex flex-col">
				<span className="text-muted-foreground text-xs uppercase tracking-wider">
					Coverage
				</span>
				<span
					className="tnum font-display font-medium text-4xl"
					style={{ color: accent }}
				>
					{ratio == null ? "—" : formatRatio(ratio)}
				</span>
			</div>
			<Metric
				label="Passive / mo"
				value={formatINR(data?.passiveIncome ?? 0)}
				sub={
					(data?.drawdown ?? 0) > 0
						? `${formatINR(data?.interest ?? 0)} int + ${formatINR(data?.drawdown ?? 0)} draw`
						: undefined
				}
			/>
			<Metric label="Expenses / mo" value={formatINR(data?.expenses ?? 0)} />
			<Metric label="Covered" value={ratio == null ? "—" : formatPct(ratio)} />
		</section>
	);
}

function Metric({
	label,
	value,
	sub,
}: {
	label: string;
	value: string;
	sub?: string;
}) {
	return (
		<div className="flex flex-col">
			<span className="text-muted-foreground text-xs uppercase tracking-wider">
				{label}
			</span>
			<span className="tnum font-display font-medium text-2xl">{value}</span>
			{sub && <span className="text-muted-foreground text-xs">{sub}</span>}
		</div>
	);
}

function DrawdownControl({
	enabled,
	rate,
	onChange,
}: {
	enabled: boolean;
	rate: number;
	onChange: () => void;
}) {
	const setDrawdown = useMutation({
		...orpc.plan.setDrawdown.mutationOptions(),
		onSuccess: onChange,
	});
	const [ratePct, setRatePct] = useState(String(Math.round(rate * 1000) / 10));

	return (
		<Section
			title="Imputed drawdown"
			hint="Count a safe-withdrawal slice of your growth (equity/MF) holdings as income."
		>
			<div className="flex flex-wrap items-center gap-4">
				<button
					type="button"
					onClick={() => setDrawdown.mutate({ enabled: !enabled })}
					className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? "bg-[var(--covered)]" : "bg-muted"}`}
					aria-pressed={enabled}
					aria-label={
						enabled ? "Disable imputed drawdown" : "Enable imputed drawdown"
					}
				>
					<span
						className={`absolute top-0.5 size-5 rounded-full bg-background transition-all ${enabled ? "left-[1.375rem]" : "left-0.5"}`}
					/>
				</button>
				<span className="text-sm">{enabled ? "On" : "Off"}</span>
				<div className="flex items-center gap-2">
					<Label htmlFor="rate" className="text-muted-foreground text-sm">
						Rate
					</Label>
					<Input
						id="rate"
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
						className="tnum w-20"
					/>
					<span className="text-muted-foreground text-sm">% / yr</span>
				</div>
			</div>
		</Section>
	);
}

// ── Investments ──────────────────────────────────────────────────────────────────────────────────────
function InvestmentsSection({
	rows,
	onChange,
}: {
	rows: Investment[];
	onChange: () => void;
}) {
	const add = useMutation({
		...orpc.plan.addInvestment.mutationOptions(),
		onSuccess: onChange,
	});
	const del = useMutation({
		...orpc.plan.deleteInvestment.mutationOptions(),
		onSuccess: onChange,
	});

	return (
		<Section
			title="Investments"
			hint="Income holdings contribute expected interest; growth holdings contribute via drawdown."
		>
			<ul className="flex flex-col divide-y divide-border">
				{rows.length === 0 && (
					<li className="py-3 text-muted-foreground text-sm">
						Nothing yet — add your first holding below.
					</li>
				)}
				{rows.map((inv) => {
					const monthly = expectedMonthlyInterest(inv);
					return (
						<li key={inv.id} className="flex items-center gap-3 py-3">
							<span
								className={`inline-flex size-2 shrink-0 rounded-full ${inv.incomeClass === "income" ? "bg-[var(--covered)]" : "bg-[var(--uncovered)]"}`}
							/>
							<div className="min-w-0 flex-1">
								<p className="truncate font-medium">{inv.name}</p>
								<p className="text-muted-foreground text-xs">
									{TYPE_LABEL[inv.type]}
									{inv.platform ? ` · ${inv.platform}` : ""}
									{inv.incomeClass === "growth" ? " · growth" : ""}
								</p>
							</div>
							<div className="text-right">
								{inv.incomeClass === "income" ? (
									<>
										<p className="tnum font-medium text-[var(--covered)]">
											{formatINR(monthly)}
											<span className="text-muted-foreground text-xs">
												{" "}
												/mo
											</span>
										</p>
										<p className="text-muted-foreground text-xs">interest</p>
									</>
								) : (
									<>
										<p className="tnum font-medium">
											{formatINR(inv.currentValue ?? 0)}
										</p>
										<p className="text-muted-foreground text-xs">value</p>
									</>
								)}
							</div>
							<IconDelete
								onClick={() => del.mutate({ id: inv.id })}
								label={`Delete ${inv.name}`}
							/>
						</li>
					);
				})}
			</ul>
			<AddInvestmentForm onAdd={(d) => add.mutate(d)} pending={add.isPending} />
		</Section>
	);
}

function AddInvestmentForm({
	onAdd,
	pending,
}: {
	onAdd: (d: InvestmentDraft) => void;
	pending: boolean;
}) {
	const [cls, setCls] = useState<IncomeClass>("income");
	const [name, setName] = useState("");
	const [type, setType] = useState<InvestmentType>("bond");
	const [platform, setPlatform] = useState("");
	const [principal, setPrincipal] = useState("");
	const [ratePct, setRatePct] = useState("");
	const [monthly, setMonthly] = useState("");
	const [currentValue, setCurrentValue] = useState("");

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
		onAdd(d);
		setName("");
		setPlatform("");
		setPrincipal("");
		setRatePct("");
		setMonthly("");
		setCurrentValue("");
	}

	return (
		<form
			onSubmit={submit}
			className="mt-4 flex flex-col gap-3 rounded-xl border border-border border-dashed p-4"
		>
			<div className="flex flex-wrap gap-2">
				<Toggle
					active={cls === "income"}
					onClick={() => setCls("income")}
					label="Income (pays interest)"
				/>
				<Toggle
					active={cls === "growth"}
					onClick={() => setCls("growth")}
					label="Growth (appreciates)"
				/>
			</div>
			<div className="grid gap-2 sm:grid-cols-2">
				<Field label="Name">
					<Input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Wint Wealth bond"
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
				<Field label="Platform / provider">
					<Input
						value={platform}
						onChange={(e) => setPlatform(e.target.value)}
						placeholder="SustVest, Wint, Groww…"
					/>
				</Field>
				{cls === "income" ? (
					<>
						<Field label="Principal (₹)">
							<Input
								type="number"
								value={principal}
								onChange={(e) => setPrincipal(e.target.value)}
								placeholder="100000"
								className="tnum"
							/>
						</Field>
						<Field label="Rate (% / yr)">
							<Input
								type="number"
								step="0.1"
								value={ratePct}
								onChange={(e) => setRatePct(e.target.value)}
								placeholder="11"
								className="tnum"
							/>
						</Field>
						<Field label="…or explicit ₹ interest / mo">
							<Input
								type="number"
								value={monthly}
								onChange={(e) => setMonthly(e.target.value)}
								placeholder="for amortising P2P"
								className="tnum"
							/>
						</Field>
					</>
				) : (
					<Field label="Current value (₹)">
						<Input
							type="number"
							value={currentValue}
							onChange={(e) => setCurrentValue(e.target.value)}
							placeholder="500000"
							className="tnum"
						/>
					</Field>
				)}
			</div>
			<div>
				<Button type="submit" disabled={pending || !name.trim()}>
					Add investment
				</Button>
			</div>
		</form>
	);
}

// ── Recurring expenses ─────────────────────────────────────────────────────────────────────────────
function RecurringSection({
	rows,
	onChange,
}: {
	rows: RecurringExpense[];
	onChange: () => void;
}) {
	const add = useMutation({
		...orpc.plan.addRecurring.mutationOptions(),
		onSuccess: onChange,
	});
	const del = useMutation({
		...orpc.plan.deleteRecurring.mutationOptions(),
		onSuccess: onChange,
	});

	return (
		<Section
			title="Recurring expenses"
			hint="Rent, subscriptions, insurance — your baseline lifestyle. One-off spend does not belong here."
		>
			<ul className="flex flex-col divide-y divide-border">
				{rows.length === 0 && (
					<li className="py-3 text-muted-foreground text-sm">
						Nothing yet — add rent, subscriptions, and other committed bills.
					</li>
				)}
				{rows.map((exp) => (
					<li key={exp.id} className="flex items-center gap-3 py-3">
						<div className="min-w-0 flex-1">
							<p className="truncate font-medium">{exp.name}</p>
							<p className="text-muted-foreground text-xs">
								{formatINR(exp.amount)}
								{CADENCE_LABEL[exp.cadence] ?? ""}
								{exp.category ? ` · ${exp.category}` : ""}
							</p>
						</div>
						<div className="text-right">
							<p className="tnum font-medium">
								{formatINR(monthlyAmount(exp))}
								<span className="text-muted-foreground text-xs"> /mo</span>
							</p>
						</div>
						<IconDelete
							onClick={() => del.mutate({ id: exp.id })}
							label={`Delete ${exp.name}`}
						/>
					</li>
				))}
			</ul>
			<AddRecurringForm onAdd={(d) => add.mutate(d)} pending={add.isPending} />
		</Section>
	);
}

function AddRecurringForm({
	onAdd,
	pending,
}: {
	onAdd: (d: RecurringDraft) => void;
	pending: boolean;
}) {
	const [name, setName] = useState("");
	const [amount, setAmount] = useState("");
	const [cadence, setCadence] = useState<ExpenseCadence>("monthly");

	function submit(e: FormEvent) {
		e.preventDefault();
		if (!name.trim() || !amount) return;
		onAdd({ name: name.trim(), amount: Number(amount), cadence });
		setName("");
		setAmount("");
	}

	return (
		<form
			onSubmit={submit}
			className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-border border-dashed p-4"
		>
			<Field label="Name" className="min-w-40 flex-1">
				<Input
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Rent"
					required
				/>
			</Field>
			<Field label="Amount (₹)">
				<Input
					type="number"
					value={amount}
					onChange={(e) => setAmount(e.target.value)}
					placeholder="32000"
					className="tnum w-32"
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
			<Button type="submit" disabled={pending || !name.trim() || !amount}>
				Add
			</Button>
		</form>
	);
}

// ── shared bits ────────────────────────────────────────────────────────────────────────────────────
function Section({
	title,
	hint,
	children,
}: {
	title: string;
	hint: string;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-3">
			<div>
				<h2 className="font-display font-medium text-xl">{title}</h2>
				<p className="text-muted-foreground text-sm">{hint}</p>
			</div>
			{children}
		</section>
	);
}

function Field({
	label,
	children,
	className,
}: {
	label: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={`flex flex-col gap-1 ${className ?? ""}`}>
			<span className="text-muted-foreground text-xs">{label}</span>
			{children}
		</div>
	);
}

function Toggle({
	active,
	onClick,
	label,
}: {
	active: boolean;
	onClick: () => void;
	label: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-secondary"}`}
		>
			{label}
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
			className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
		>
			{options.map((o) => (
				<option key={o.value} value={o.value}>
					{o.label}
				</option>
			))}
		</select>
	);
}

function IconDelete({
	onClick,
	label,
}: {
	onClick: () => void;
	label: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-[var(--uncovered)]"
		>
			<Trash2 className="size-4" />
		</button>
	);
}
