import type {
	ReconciledEvent,
	ReconcileResult,
	ReconcileStatus,
	ReconcileSuggestion,
} from "@money/shared";
import { CATEGORIES } from "@money/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Check, Clock, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { formatINR, formatMonth } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/reconcile")({
	component: ReconcilePage,
});

const IN = "var(--covered)";
const OUT = "var(--uncovered)";
const DIFFERS_C = "oklch(0.74 0.15 66)"; // amber
const tint = (c: string, pct: number) =>
	`color-mix(in oklab, ${c} ${pct}%, transparent)`;

const STATUS: Record<
	ReconcileStatus,
	{ label: string; color: string; icon: typeof Check }
> = {
	received: { label: "Received", color: IN, icon: Check },
	differs: { label: "Amount differs", color: DIFFERS_C, icon: TriangleAlert },
	pending: { label: "Pending", color: "var(--muted-foreground)", icon: Clock },
	missed: { label: "Missed", color: OUT, icon: X },
};

function ReconcilePage() {
	const monthsQ = useQuery(orpc.reconcile.months.queryOptions());
	const months = monthsQ.data ?? [];
	const [picked, setPicked] = useState<string | null>(null);
	const month = picked ?? months[0] ?? new Date().toISOString().slice(0, 7);
	const recQ = useQuery(
		orpc.reconcile.month.queryOptions({ input: { month } }),
	);
	const res = recQ.data as ReconcileResult | undefined;

	return (
		<main className="h-full overflow-y-auto">
			<div className="mx-auto flex max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
				<header className="flex flex-col gap-3">
					<div className="flex flex-wrap items-end justify-between gap-3">
						<div className="flex flex-col gap-1">
							<h1 className="font-display font-medium text-3xl tracking-tight">
								Reconcile
							</h1>
							<p className="text-muted-foreground">
								The interest your plan expects, checked against what actually
								landed in the account.
							</p>
						</div>
						<MonthPicker months={months} value={month} onChange={setPicked} />
					</div>
				</header>

				{res && <SummaryBar res={res} />}

				<section className="flex flex-col">
					<SectionHead>
						Expected this month{" "}
						<span className="text-muted-foreground">· plan → statement</span>
					</SectionHead>
					<ul className="flex flex-col">
						{recQ.isLoading && <Muted>Loading…</Muted>}
						{res?.events.length === 0 && !recQ.isLoading && (
							<Muted>
								No cash-paying income holdings expected in {formatMonth(month)}.
							</Muted>
						)}
						{res?.events.map((e) => (
							<EventRow key={e.key} ev={e} />
						))}
					</ul>
				</section>

				{res && res.suggestions.length > 0 && (
					<Suggestions items={res.suggestions} />
				)}
			</div>
		</main>
	);
}

// ── summary ───────────────────────────────────────────────────────────────────────────────────────────
function SummaryBar({ res }: { res: ReconcileResult }) {
	const { summary } = res;
	const chips: { s: ReconcileStatus; n: number }[] = [
		{ s: "received", n: summary.receivedCount },
		{ s: "pending", n: summary.pendingCount },
		{ s: "missed", n: summary.missedCount },
		{ s: "differs", n: summary.differsCount },
	];
	return (
		<section className="flex flex-col gap-5 rounded-2xl border border-border bg-card/40 px-6 py-6">
			<div className="flex items-end justify-between gap-4">
				<div>
					<p className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
						Expected in
					</p>
					<p className="tnum font-display font-medium text-3xl leading-none">
						{formatINR(summary.expectedAmount)}
					</p>
				</div>
				<ArrowRight className="mb-1 size-5 text-muted-foreground" />
				<div className="text-right">
					<p className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
						Actually landed
					</p>
					<p
						className="tnum font-display font-medium text-3xl leading-none"
						style={{ color: IN }}
					>
						{formatINR(summary.actualAmount)}
					</p>
				</div>
			</div>
			<div className="flex flex-wrap gap-2">
				{chips
					.filter((c) => c.n > 0)
					.map(({ s, n }) => {
						const meta = STATUS[s];
						return (
							<span
								key={s}
								className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
								style={{
									color: meta.color,
									background: tint(meta.color, 12),
								}}
							>
								<meta.icon className="size-3.5" />
								{n} {meta.label.toLowerCase()}
							</span>
						);
					})}
			</div>
		</section>
	);
}

// ── one expected event ──────────────────────────────────────────────────────────────────────────────────
function EventRow({ ev }: { ev: ReconciledEvent }) {
	const meta = STATUS[ev.status];
	const showDelta = ev.status === "received" || ev.status === "differs";
	return (
		<li className="flex items-center gap-3 border-border border-b py-3">
			<span
				className="flex size-7 shrink-0 items-center justify-center rounded-full"
				style={{ color: meta.color, background: tint(meta.color, 14) }}
				title={meta.label}
			>
				<meta.icon className="size-4" />
			</span>
			<div className="min-w-0 flex-1">
				<p className="truncate font-medium">{ev.name}</p>
				<p className="text-muted-foreground text-xs">
					{meta.label}
					{ev.memberCount > 1 ? ` · ${ev.memberCount} holdings` : ""}
					{ev.matches.length > 0 ? ` · ${ev.matches.length} credits` : ""}
				</p>
			</div>
			<div className="shrink-0 text-right">
				<p className="tnum font-medium">
					{ev.status === "received" || ev.status === "differs"
						? formatINR(ev.actualAmount)
						: "—"}
					<span className="ml-1 text-[0.6rem] text-muted-foreground">
						/ {formatINR(ev.expectedAmount)} exp
					</span>
				</p>
				{showDelta && (
					<p
						className="tnum text-xs"
						style={{ color: ev.delta >= 0 ? IN : DIFFERS_C }}
					>
						{ev.delta >= 0 ? "+" : "−"}
						{formatINR(Math.abs(ev.delta))}
					</p>
				)}
			</div>
		</li>
	);
}

// ── suggestions ─────────────────────────────────────────────────────────────────────────────────────────
const INCOME_CATS = CATEGORIES.filter((c) => c.kind === "passive_income");

function Suggestions({ items }: { items: ReconcileSuggestion[] }) {
	const qc = useQueryClient();
	const [busy, setBusy] = useState<string | null>(null);
	const setOverride = useMutation(orpc.overrides.set.mutationOptions());
	const addHolding = useMutation(orpc.plan.addInvestment.mutationOptions());

	const done = () => {
		setBusy(null);
		qc.invalidateQueries();
	};
	const fail = () => setBusy(null);

	const fileUnder = (s: ReconcileSuggestion, value: string) => {
		if (!value) return;
		setBusy(s.txnId);
		if (value === "__new__") {
			addHolding.mutate(
				{
					name: s.platformGuess ?? "New income",
					platform: s.platformGuess,
					incomeClass: "income",
					payout: "cash",
					type: "other",
					expectedMonthlyInterest: Math.round(s.amount),
				},
				{ onSuccess: done, onError: fail },
			);
			return;
		}
		const categoryKey = value === "__ignore__" ? "self_transfer" : value;
		setOverride.mutate(
			{ txnId: s.txnId, categoryKey },
			{ onSuccess: done, onError: fail },
		);
	};

	return (
		<section className="flex flex-col">
			<SectionHead>
				Unrecognised income{" "}
				<span className="text-muted-foreground">· not in your plan yet</span>
			</SectionHead>
			<ul className="flex flex-col">
				{items.map((s) => (
					<li
						key={s.txnId}
						className="flex items-center gap-3 border-border border-b py-3"
					>
						<div className="min-w-0 flex-1">
							<p className="truncate font-medium">
								{s.platformGuess ?? "Unknown source"}
							</p>
							<p className="truncate text-muted-foreground text-xs">
								{s.date} · {s.narration}
							</p>
						</div>
						<span className="tnum shrink-0 font-medium" style={{ color: IN }}>
							{formatINR(s.amount)}
						</span>
						<select
							value=""
							disabled={busy === s.txnId}
							onChange={(e) => fileUnder(s, e.target.value)}
							className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-foreground text-sm shadow-xs outline-none [color-scheme:light] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:[color-scheme:dark]"
						>
							<option value="">File under…</option>
							<optgroup label="Existing income category">
								{INCOME_CATS.map((c) => (
									<option
										key={c.key}
										value={c.key}
										className="bg-popover text-popover-foreground"
									>
										{c.label}
									</option>
								))}
							</optgroup>
							<optgroup label="Or">
								<option
									value="__new__"
									className="bg-popover text-popover-foreground"
								>
									＋ New holding
								</option>
								<option
									value="__ignore__"
									className="bg-popover text-popover-foreground"
								>
									Not income — ignore
								</option>
							</optgroup>
						</select>
					</li>
				))}
			</ul>
			<p className="mt-2 text-muted-foreground text-xs">
				<span className="text-foreground/70">File under</span> an existing
				category to tag a credit the rules missed (e.g. a SustVest borrower) ·{" "}
				<span className="text-foreground/70">New holding</span> creates a plan
				item · <span className="text-foreground/70">Ignore</span> marks it
				not-income. Applies instantly.
			</p>
		</section>
	);
}

// ── bits ────────────────────────────────────────────────────────────────────────────────────────────────
function MonthPicker({
	months,
	value,
	onChange,
}: {
	months: string[];
	value: string;
	onChange: (m: string) => void;
}) {
	const options = months.length > 0 ? months : [value];
	return (
		<select
			value={value}
			onChange={(e) => onChange(e.target.value)}
			className="h-9 rounded-md border border-input bg-background px-3 text-foreground text-sm shadow-xs outline-none [color-scheme:light] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:[color-scheme:dark]"
		>
			{options.map((m) => (
				<option
					key={m}
					value={m}
					className="bg-popover text-popover-foreground"
				>
					{formatMonth(m)}
				</option>
			))}
		</select>
	);
}

function SectionHead({ children }: { children: React.ReactNode }) {
	return (
		<div className="border-border border-b-2 pb-2">
			<h2 className="font-display font-medium text-lg">{children}</h2>
		</div>
	);
}

function Muted({ children }: { children: React.ReactNode }) {
	return <li className="py-4 text-muted-foreground text-sm">{children}</li>;
}
