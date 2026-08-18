import {
	CATEGORIES,
	CATEGORY_BY_KEY,
	convert,
	INVESTMENT_TYPES,
	type Investment,
	type InvestmentType,
	isMatured,
	monthlyAmount,
	type RecurringExpense,
	toISODate,
} from "@money/shared";
import { Button } from "@money/ui/components/button";
import { Input } from "@money/ui/components/input";
import { Select } from "@money/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	AlertTriangle,
	Check,
	ChevronRight,
	ChevronsUpDown,
	Plus,
	X,
} from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { ArmedDelete } from "@/components/armed-delete";
import { CoverageHistory } from "@/components/plan/coverage-history";
import { TaxModeChip } from "@/components/tax-mode-chip";
import { MoneyNative, useMoney } from "@/lib/currency";
import { useIsDesktop } from "@/lib/media";
import { usePlanPeriod } from "@/lib/period";
import { usePreference } from "@/lib/preferences";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/plan")({ component: PlanPage });

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
	currency?: string;
}
interface RecurringDraft {
	name: string;
	amount: number;
	cadence: ExpenseCadence;
	category?: string;
	currency?: string;
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

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
/** Today as YYYY-MM-DD (client clock) — drives the maturity countdown. */
const todayISO = () => new Date().toISOString().slice(0, 10);
/** A date (ISO or day-first DD/MM/YYYY) as a whole day-number (UTC), or null if absent/unparseable. */
function dayNum(iso?: string): number | null {
	const s = toISODate(iso);
	if (!s) return null;
	const t = Date.parse(s);
	return Number.isNaN(t) ? null : Math.floor(t / 86_400_000);
}

function PlanPage() {
	const qc = useQueryClient();
	const invalidate = () => qc.invalidateQueries();

	const money = useMoney();
	const desktop = useIsDesktop();
	const [tab, setTab] = usePreference("plan.tab");
	const ladder = useQuery(orpc.plan.ladder.queryOptions());
	const wealth = useQuery(orpc.plan.wealth.queryOptions());
	const recurring = useQuery(orpc.plan.recurring.queryOptions());

	// recurring amounts can be foreign; compare/rank in INR so a €/$ sub isn't mis-sized
	const monthlyInr = (e: RecurringExpense) =>
		convert(monthlyAmount(e), e.currency ?? "INR", "INR", money.rates);
	const rollups = (wealth.data?.rollups ?? []) as Rollup[];
	const recs = [...(recurring.data ?? [])].sort(
		(a, b) => monthlyInr(b) - monthlyInr(a),
	);
	const maxIn = Math.max(1, ...rollups.map((r) => r.monthly));
	const maxOut = Math.max(1, ...recs.map(monthlyInr));
	const totalIn = rollups.reduce((s, r) => s + r.monthly, 0);
	const totalOut = recs.reduce((s, e) => s + monthlyInr(e), 0);

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

				{/* On a phone these two collapse to a single summary line each, so the lists — the thing you
				    actually came to read — are on screen without scrolling past context you already know. */}
				<LadderCard
					ladder={ladder.data as Ladder | undefined}
					collapsible={!desktop}
				/>

				{/* The trend chart is a desktop affordance: a 12-month dual-axis plot squeezed into 375px is
				    unreadable, and it is the heaviest thing on the page. Branching here rather than hiding it
				    with CSS means the phone never fetches the history or mounts recharts at all. */}
				{desktop && <CoverageHistory />}

				<MaturityAlerts collapsible={!desktop} onDone={invalidate} />

				{!desktop && (
					<ColumnTabs
						tab={tab}
						onChange={setTab}
						totalIn={totalIn}
						totalOut={totalOut}
					/>
				)}

				<div className="grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2">
					{(desktop || tab === "incoming") && (
						<IncomingColumn
							rollups={rollups}
							max={maxIn}
							total={totalIn}
							showHeader={desktop}
							onDone={invalidate}
						/>
					)}
					{(desktop || tab === "outgoing") && (
						<OutgoingColumn
							rows={recs}
							max={maxOut}
							total={totalOut}
							showHeader={desktop}
							onDone={invalidate}
						/>
					)}
				</div>
			</div>
		</main>
	);
}

// ── period + mobile tabs ──────────────────────────────────────────────────────────────────────────────
/**
 * The running total for one side, which doubles as the period switch: tapping it cycles
 * weekly → monthly → yearly and rescales every amount on the page with it.
 */
function TotalButton({
	total,
	tone,
	side,
}: {
	total: number;
	tone: string;
	side: "in" | "out";
}) {
	const { fmt } = useMoney();
	const { scale, suffix, label, cycle } = usePlanPeriod();
	return (
		<button
			type="button"
			onClick={cycle}
			title={`${label} total — tap to change period`}
			aria-label={`${label} ${side === "in" ? "incoming" : "outgoing"} total. Tap to change period.`}
			className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 transition-colors hover:bg-secondary ${
				side === "out" ? "flex-row-reverse" : ""
			}`}
		>
			<span
				className="tnum font-display font-medium text-lg"
				style={{ color: tone }}
			>
				{fmt(scale(total))}
				<span className="text-[0.6rem] text-muted-foreground"> {suffix}</span>
			</span>
			<ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
		</button>
	);
}

/**
 * Narrow screens get one column at a time. Two columns of bars on a phone leaves each ~150px wide, which is
 * too little for a name, an amount and a proportional bar — so the two become tabs, and the totals ride in
 * the tab labels so both sides stay visible even though only one list is.
 */
function ColumnTabs({
	tab,
	onChange,
	totalIn,
	totalOut,
}: {
	tab: "incoming" | "outgoing";
	onChange: (t: "incoming" | "outgoing") => void;
	totalIn: number;
	totalOut: number;
}) {
	const { fmt } = useMoney();
	const { scale, suffix, label, cycle } = usePlanPeriod();

	const item = (id: "incoming" | "outgoing", text: string, total: number) => {
		const active = tab === id;
		const tone = id === "incoming" ? IN : OUT;
		return (
			<button
				type="button"
				onClick={() => onChange(id)}
				aria-pressed={active}
				className="flex flex-1 cursor-pointer flex-col gap-0.5 rounded-md px-3 py-2 text-left transition-colors"
				style={active ? { background: tint(tone, 12) } : undefined}
			>
				<span className="flex items-center gap-1.5">
					<span
						className="size-1.5 shrink-0 rounded-full"
						style={{ backgroundColor: tone, opacity: active ? 1 : 0.4 }}
					/>
					<span
						className={`text-xs ${active ? "text-foreground" : "text-muted-foreground"}`}
					>
						{text}
					</span>
				</span>
				<span
					className="tnum font-display font-medium"
					style={{ color: tone, opacity: active ? 1 : 0.55 }}
				>
					{fmt(scale(total))}
				</span>
			</button>
		);
	};

	return (
		<div className="flex items-stretch gap-2">
			<div className="flex flex-1 gap-1 rounded-lg border border-border p-1">
				{item("incoming", "Incoming", totalIn)}
				{item("outgoing", "Outgoing", totalOut)}
			</div>
			<button
				type="button"
				onClick={cycle}
				title={`${label} — tap to change period`}
				aria-label={`Showing ${label} amounts. Tap to change period.`}
				className="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-border px-3 text-muted-foreground text-sm transition-colors hover:bg-secondary hover:text-foreground"
			>
				<span className="tnum">{suffix}</span>
				<ChevronsUpDown className="size-3.5" />
			</button>
		</div>
	);
}

// ── coverage ladder ───────────────────────────────────────────────────────────────────────────────────
function LadderCard({
	ladder,
	collapsible,
}: {
	ladder: Ladder | undefined;
	collapsible: boolean;
}) {
	const { fmt } = useMoney();
	const { scale, suffix } = usePlanPeriod();
	const [open, setOpen] = useState(false);
	const total = ladder?.total.ratio ?? null;
	const free = total != null && total >= 1;
	const accent = free ? IN : OUT;
	const tiers = [
		{ key: "cash", label: "Cash in hand", t: ladder?.cash },
		{ key: "fixed", label: "+ Fixed income", t: ladder?.fixed },
		{ key: "total", label: "+ Total return", t: ladder?.total },
	];
	// The ratio is period-invariant — it is one flow over another — so only the ₹ figures rescale.
	const expenses = (
		<>
			{fmt(scale(ladder?.expenses ?? 0))}
			<span className="text-[0.6rem] text-muted-foreground"> {suffix}</span>
		</>
	);
	return (
		<section className="flex flex-col gap-5 rounded-2xl border border-border bg-card/40 px-6 py-6">
			{/* The chip is a button, so it sits beside the collapse toggle rather than inside it. */}
			<div className="flex items-end justify-between gap-3">
				<div className="min-w-0">
					<p className="flex items-center gap-2 text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
						Coverage
						<TaxModeChip />
					</p>
					<p
						className={`tnum font-display font-medium leading-none ${collapsible ? "text-4xl" : "pointer-events-none text-5xl"}`}
						style={{ color: accent }}
					>
						{ratioStr(total)}
					</p>
				</div>
				{collapsible ? (
					<button
						type="button"
						onClick={() => setOpen((o) => !o)}
						aria-expanded={open}
						aria-label={`${open ? "Hide" : "Show"} the coverage ladder`}
						className="flex cursor-pointer items-center gap-1 text-right"
					>
						<span>
							<span
								className="tnum block font-display font-medium text-xl"
								style={{ color: OUT }}
							>
								{expenses}
							</span>
							<span className="block text-muted-foreground text-xs">
								recurring
							</span>
						</span>
						<ChevronRight
							className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
						/>
					</button>
				) : (
					<div className="text-right">
						<p
							className="tnum font-display font-medium text-xl"
							style={{ color: OUT }}
						>
							{expenses}
						</p>
						<p className="text-muted-foreground text-xs">recurring</p>
					</div>
				)}
			</div>
			<div
				className={`flex-col gap-2.5 ${collapsible && !open ? "hidden" : "flex"}`}
			>
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
								{fmt(scale(t?.income ?? 0))}
							</span>
						</div>
					);
				})}
			</div>
			<p
				className={`text-muted-foreground text-xs ${collapsible && !open ? "hidden" : ""}`}
			>
				The right edge is <span className="text-foreground/70">1.0×</span> —
				passive income fully covers recurring expenses. Cash ⊆ fixed-income ⊆
				total return.
			</p>
		</section>
	);
}

// ── maturity indicators ───────────────────────────────────────────────────────────────────────────────
/**
 * A tiny inline maturity gauge (thin bar + days-left) for a live holding, shown in its card. Fills as the
 * holding approaches maturity — elapsed-of-term when a start date exists, else across a 1-year horizon.
 * Renders nothing for holdings without a (parseable) maturity date.
 */
function MaturityMini({ inv }: { inv: Investment | undefined }) {
	if (!inv?.maturityDate) return null;
	const mNum = dayNum(inv.maturityDate);
	if (mNum == null) return null;
	const tNum = dayNum(todayISO()) ?? 0;
	const sNum = dayNum(inv.startDate);
	const daysLeft = mNum - tNum;
	const fill =
		daysLeft <= 0
			? 1
			: sNum != null && mNum > sNum
				? clamp01((tNum - sNum) / (mNum - sNum))
				: clamp01(1 - daysLeft / 365);
	const urgent = daysLeft <= 30;
	const label =
		daysLeft <= 0
			? "due"
			: daysLeft <= 60
				? `${daysLeft}d`
				: daysLeft <= 365
					? `~${Math.round(daysLeft / 30)}mo`
					: `~${(daysLeft / 365).toFixed(1)}yr`;
	return (
		<span className="inline-flex items-center gap-1.5 align-middle">
			<span className="relative inline-block h-1 w-12 overflow-hidden rounded-full bg-muted/60">
				<span
					className="absolute inset-y-0 left-0 rounded-full"
					style={{
						width: `${fill * 100}%`,
						background: urgent ? OUT : tint("var(--foreground)", 30),
					}}
				/>
			</span>
			<span className="tnum" style={urgent ? { color: OUT } : undefined}>
				{label}
			</span>
		</span>
	);
}

/** Days from today until a holding's maturity, or null if it has no (parseable) maturity date. */
function daysToMaturity(inv: Investment, today: string): number | null {
	const mNum = dayNum(inv.maturityDate);
	return mNum == null ? null : mNum - (dayNum(today) ?? 0);
}

/**
 * Alerts strip for holdings that need attention: matured ones (already dropped from the live ladder) with
 * Update / Delete, plus a heads-up list of anything expiring within 30 days below a divider. Renders
 * nothing when both lists are empty.
 */
function MaturityAlerts({
	collapsible,
	onDone,
}: {
	collapsible: boolean;
	onDone: () => void;
}) {
	const money = useMoney();
	const invs = useQuery(orpc.plan.investments.queryOptions());
	const [editing, setEditing] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const update = useMutation({
		...orpc.plan.updateInvestment.mutationOptions(),
		onSuccess: onDone,
	});
	const del = useMutation({
		...orpc.plan.deleteInvestment.mutationOptions(),
		onSuccess: onDone,
	});
	const valueInr = (inv: Investment) =>
		money.fmt(
			convert(
				inv.currentValue ?? inv.principal ?? 0,
				inv.currency ?? "INR",
				"INR",
				money.rates,
			),
		);

	const today = todayISO();
	const all = invs.data ?? [];
	const matured = all.filter((inv) => isMatured(inv, today));
	const soon = all
		.filter((inv) => {
			if (isMatured(inv, today)) return false;
			const d = daysToMaturity(inv, today);
			return d != null && d > 0 && d <= 30;
		})
		.map((inv) => ({ inv, days: daysToMaturity(inv, today) ?? 0 }))
		.sort((a, b) => a.days - b.days);

	if (matured.length === 0 && soon.length === 0) return null;

	// The heading already *is* the summary — "2 investments matured — take action" says everything the
	// collapsed state needs to, so collapsing here costs no information, only the rows you'd act on.
	const heading =
		matured.length > 0
			? `${matured.length} investment${matured.length === 1 ? "" : "s"} matured — take action`
			: `${soon.length} investment${soon.length === 1 ? "" : "s"} expiring within 30 days`;
	// One display utility per element, never `flex hidden` — which of the two wins is a stylesheet-order
	// detail, not something the class list decides.
	const collapsed = collapsible && !open;

	return (
		<section
			className="flex flex-col gap-2 rounded-xl border px-5 py-4"
			style={{ borderColor: tint(OUT, 35), background: tint(OUT, 7) }}
		>
			{collapsible ? (
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					aria-expanded={open}
					aria-label={`${open ? "Hide" : "Show"} the holdings needing attention`}
					className="flex cursor-pointer items-center gap-2 text-left"
				>
					<AlertTriangle className="size-4 shrink-0" style={{ color: OUT }} />
					<h2 className="flex-1 font-medium text-sm" style={{ color: OUT }}>
						{heading}
					</h2>
					<ChevronRight
						className={`size-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
						style={{ color: OUT }}
					/>
				</button>
			) : (
				<div className="flex items-center gap-2">
					<AlertTriangle className="size-4 shrink-0" style={{ color: OUT }} />
					<h2 className="font-medium text-sm" style={{ color: OUT }}>
						{heading}
					</h2>
				</div>
			)}

			{matured.length > 0 && (
				<ul
					className={`${collapsed ? "hidden" : "flex"} flex-col divide-y divide-border/50`}
				>
					{matured.map((inv) =>
						editing === inv.id ? (
							<li key={inv.id} className="py-2">
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
							<li key={inv.id} className="flex items-center gap-3 py-2">
								<div className="min-w-0 flex-1">
									<p className="truncate font-medium text-sm">{inv.name}</p>
									<p className="text-muted-foreground text-xs">
										{inv.maturityDate
											? `matured ${toISODate(inv.maturityDate) ?? inv.maturityDate} · `
											: ""}
										{valueInr(inv)}
									</p>
								</div>
								<button
									type="button"
									onClick={() => setEditing(inv.id)}
									className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-secondary"
								>
									Update
								</button>
								<ArmedDelete
									onConfirm={() => del.mutate({ id: Number(inv.id) })}
									title={`Delete ${inv.name}`}
								/>
							</li>
						),
					)}
				</ul>
			)}

			{soon.length > 0 && (
				<>
					{matured.length > 0 && (
						<div
							className={`${collapsed ? "hidden" : "flex"} mt-1 items-center gap-2 border-border/60 border-t pt-2`}
						>
							<span className="text-[0.7rem] text-muted-foreground uppercase tracking-wider">
								Expiring within 30 days
							</span>
						</div>
					)}
					<ul
						className={`${collapsed ? "hidden" : "flex"} flex-col divide-y divide-border/50`}
					>
						{soon.map(({ inv, days }) => (
							<li key={inv.id} className="flex items-center gap-3 py-1.5">
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm">{inv.name}</p>
									<p className="tnum text-muted-foreground text-xs">
										{valueInr(inv)}
									</p>
								</div>
								<span className="tnum text-xs" style={{ color: OUT }}>
									{days}d
								</span>
							</li>
						))}
					</ul>
				</>
			)}
		</section>
	);
}

// ── Incoming (grouped investments) ────────────────────────────────────────────────────────────────────
function IncomingColumn({
	rollups,
	max,
	total,
	showHeader,
	onDone,
}: {
	rollups: Rollup[];
	max: number;
	total: number;
	showHeader: boolean;
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
			{showHeader && <ColHeader tone={IN} label="Incoming" total={total} />}
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
						<li key={r.members[0]?.id} className="py-2">
							{r.members[0] && editRow(r.members[0])}
						</li>
					) : (
						<StandaloneRow
							key={r.members[0]?.id ?? r.name}
							rollup={r}
							pct={(r.monthly / max) * 100}
							onEdit={() => setEditing(r.members[0]?.id ?? null)}
						/>
					),
				)}
			</ul>
			{adding ? (
				<div className="py-2">
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
}: {
	rollup: Rollup;
	pct: number;
	onEdit: () => void;
}) {
	return (
		<li className="relative flex items-center gap-3 border-border border-b py-2.5 transition-colors hover:bg-secondary/20">
			<Depth pct={pct} side="right" tone={IN} />
			{/* The whole tile opens the editor, which is where both edit and delete live. Hover-revealed
			    icons used to sit here, but `group-hover` is gated behind `@media (hover: hover)`: on a phone
			    they never appeared, yet `opacity: 0` still takes taps — an invisible delete on every row. */}
			<button
				type="button"
				onClick={onEdit}
				aria-label={`Edit ${rollup.name}`}
				className="relative flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
			>
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium">{rollup.name}</span>
					<span className="flex items-center gap-2 text-muted-foreground text-xs">
						<span>
							{rollup.incomeClass === "growth" ? "growth" : "income"}
							{rollup.rate != null ? ` · ${pct1(rollup.rate)}` : ""}
						</span>
						<MaturityMini inv={rollup.members[0]} />
					</span>
				</span>
				<Amount value={rollup.value} monthly={rollup.monthly} />
			</button>
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
			<div className="relative flex items-center gap-3 py-2.5 transition-colors hover:bg-secondary/20">
				<Depth pct={pct} side="right" tone={IN} />
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					className="relative flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
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
	const { fmt } = useMoney();
	const { scale, suffix } = usePlanPeriod();
	const monthly =
		inv.expectedMonthlyInterest ??
		((inv.currentValue ?? 0) * (inv.annualRate ?? 0)) / 12;
	return (
		<li className="flex items-center gap-3 py-1.5 transition-colors hover:bg-secondary/20">
			<button
				type="button"
				onClick={onEdit}
				aria-label={`Edit ${inv.name}`}
				className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
			>
				<span className="block min-w-0 flex-1">
					<span className="block truncate text-sm">{inv.name}</span>
					<span className="flex items-center gap-2 text-muted-foreground text-xs">
						<span>
							{fmt(inv.currentValue ?? 0)}
							{inv.annualRate != null ? ` · ${pct1(inv.annualRate)}` : ""}
						</span>
						<MaturityMini inv={inv} />
					</span>
				</span>
				<span className="tnum text-sm" style={{ color: IN }}>
					{fmt(scale(monthly))}
					<span className="text-[0.6rem] text-muted-foreground">{suffix}</span>
				</span>
			</button>
		</li>
	);
}

/** Spans rather than divs: this renders inside a row's button, which only accepts phrasing content. */
function Amount({ value, monthly }: { value: number; monthly: number }) {
	const { fmt } = useMoney();
	const { scale, suffix } = usePlanPeriod();
	return (
		<span className="relative block text-right">
			<span className="tnum block font-medium" style={{ color: IN }}>
				{fmt(scale(monthly))}
				<span className="text-[0.6rem] text-muted-foreground"> {suffix}</span>
			</span>
			{/* The corpus is a stock, not a flow — it is the same ₹18L whichever period you read the yield in. */}
			<span className="tnum block text-muted-foreground text-xs">
				{fmt(value)}
			</span>
		</span>
	);
}

// ── Outgoing (recurring expenses) ─────────────────────────────────────────────────────────────────────
function OutgoingColumn({
	rows,
	max,
	total,
	showHeader,
	onDone,
}: {
	rows: RecurringExpense[];
	max: number;
	total: number;
	showHeader: boolean;
	onDone: () => void;
}) {
	const { rates } = useMoney();
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
			{showHeader && (
				<ColHeader tone={OUT} label="Outgoing" total={total} side="right" />
			)}
			<ul className="flex flex-col">
				{rows.length === 0 && !adding && (
					<Empty>No recurring expenses yet.</Empty>
				)}
				{rows.map((exp) =>
					editing === exp.id ? (
						<li key={exp.id} className="py-2">
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
							pct={
								(convert(
									monthlyAmount(exp),
									exp.currency ?? "INR",
									"INR",
									rates,
								) /
									max) *
								100
							}
							onEdit={() => setEditing(exp.id)}
						/>
					),
				)}
			</ul>
			{adding ? (
				<div className="py-2">
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
}: {
	exp: RecurringExpense;
	pct: number;
	onEdit: () => void;
}) {
	const { scale, suffix } = usePlanPeriod();
	return (
		<li className="relative flex items-center gap-3 border-border border-b py-2.5 transition-colors hover:bg-secondary/20">
			<Depth pct={pct} side="left" tone={OUT} />
			{/* The whole tile opens the editor — see StandaloneRow for why the hover icons are gone. */}
			<button
				type="button"
				onClick={onEdit}
				aria-label={`Edit ${exp.name}`}
				className="relative flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
			>
				<span className="block text-left">
					<span className="tnum block font-medium" style={{ color: OUT }}>
						<MoneyNative
							amount={scale(monthlyAmount(exp))}
							code={exp.currency ?? "INR"}
						/>
					</span>
					{/* The period suffix labels the figure above; a non-monthly bill also keeps its real contract
					    alongside, because "₹19,239 /yr" is what actually leaves the account and no rescaling of
					    it into a weekly average should hide that. */}
					<span className="block text-[0.6rem] text-muted-foreground">
						{suffix}
						{exp.cadence !== "monthly" && (
							<>
								{" · "}
								<MoneyNative amount={exp.amount} code={exp.currency ?? "INR"} />
								{CADENCE_LABEL[exp.cadence] ?? ""}
							</>
						)}
					</span>
				</span>
				<span className="block min-w-0 flex-1 text-right">
					<span className="block truncate font-medium">{exp.name}</span>
					{exp.category && (
						<span className="block text-muted-foreground text-xs">
							{CATEGORY_BY_KEY.get(exp.category)?.label ?? exp.category}
						</span>
					)}
				</span>
			</button>
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
	const { enabled } = useMoney();
	const [cls, setCls] = useState<IncomeClass>(initial?.incomeClass ?? "income");
	const [payout, setPayout] = useState<Payout>(
		(initial?.payout as Payout) ?? "cash",
	);
	const [name, setName] = useState(initial?.name ?? "");
	const [type, setType] = useState<InvestmentType>(initial?.type ?? "bond");
	const [group, setGroup] = useState(initial?.group ?? "");
	const [platform, setPlatform] = useState(initial?.platform ?? "");
	const [currency, setCurrency] = useState(initial?.currency ?? "INR");
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
		const d: InvestmentDraft = {
			name: name.trim(),
			type,
			incomeClass: cls,
			currency,
		};
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
		<form
			onSubmit={submit}
			className="flex flex-col gap-2.5 rounded-lg border p-3"
			style={{ borderColor: tint(IN, 40), background: tint(IN, 6) }}
		>
			<FormActions
				pending={pending}
				submitLabel={submitLabel}
				disabled={!name.trim()}
				onCancel={onCancel}
				onDelete={onDelete}
			/>
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
				<Field label="Currency">
					<NativeSelect
						value={currency}
						onChange={setCurrency}
						options={enabled.map((c) => ({
							value: c.code,
							label: `${c.symbol} ${c.code}`,
						}))}
					/>
				</Field>
				<Field label="Value">
					<Input
						type="number"
						value={value}
						onChange={(e) => setValue(e.target.value)}
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
	const { enabled } = useMoney();
	const [name, setName] = useState(initial?.name ?? "");
	const [amount, setAmount] = useState(str(initial?.amount));
	const [currency, setCurrency] = useState(initial?.currency ?? "INR");
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
			currency,
		};
		if (category.trim()) d.category = category.trim();
		onSubmit(d);
	}

	return (
		<form
			onSubmit={submit}
			className="flex flex-col gap-2.5 rounded-lg border p-3"
			style={{ borderColor: tint(OUT, 40), background: tint(OUT, 6) }}
		>
			<FormActions
				pending={pending}
				submitLabel={submitLabel}
				disabled={!name.trim() || !amount}
				onCancel={onCancel}
				onDelete={onDelete}
			/>
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
				<Field label="Currency">
					<NativeSelect
						value={currency}
						onChange={setCurrency}
						options={enabled.map((c) => ({
							value: c.code,
							label: `${c.symbol} ${c.code}`,
						}))}
					/>
				</Field>
				<Field label="Amount">
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
		</form>
	);
}

// ── shared bits ───────────────────────────────────────────────────────────────────────────────────────
function ColHeader({
	tone,
	label,
	total,
	side,
}: {
	tone: string;
	label: string;
	total: number;
	side?: "left" | "right";
}) {
	return (
		<div
			className={`flex items-center justify-between gap-2 border-b-2 pb-2 ${side === "right" ? "flex-row-reverse" : ""}`}
			style={{ borderColor: tint(tone, 40) }}
		>
			<span
				className={`flex items-center gap-2 ${side === "right" ? "flex-row-reverse" : ""}`}
			>
				<span
					className="size-2 rounded-full"
					style={{ backgroundColor: tone }}
				/>
				<h2 className="font-display font-medium text-lg">{label}</h2>
			</span>
			{/* The totals sit on the inner edge of each column, so the two meet in the middle of the page. */}
			<TotalButton
				total={total}
				tone={tone}
				side={side === "right" ? "out" : "in"}
			/>
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
		<div className="flex items-center gap-2 border-current/15 border-b pb-2.5">
			{/* Delete sits opposite Save and Cancel, out of reach of the thumb that just opened this. Safe at
			    the top of the tab order too, because the first press only arms it. */}
			{onDelete && (
				<ArmedDelete onConfirm={onDelete} label="Delete" size="sm" />
			)}
			<div className="ml-auto flex items-center gap-2">
				<Button type="submit" size="sm" disabled={pending || disabled}>
					<Check className="size-3.5" /> {submitLabel}
				</Button>
				{onCancel && (
					<Button type="button" size="sm" variant="ghost" onClick={onCancel}>
						<X className="size-3.5" /> Cancel
					</Button>
				)}
			</div>
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
		<Select
			value={value}
			onValueChange={onChange}
			options={options}
			className="h-9 rounded-md"
		/>
	);
}

function str(n: number | undefined): string {
	return n != null ? String(n) : "";
}
