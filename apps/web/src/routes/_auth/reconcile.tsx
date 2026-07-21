import type {
	ReconciledEvent,
	ReconcileResult,
	ReconcileStatus,
	ReconcileSuggestion,
	ReconcileSummary,
} from "@money/shared";
import { CATEGORIES, FY_START_MONTH, reconcileByFy } from "@money/shared";
import { Select } from "@money/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Check,
	ChevronRight,
	Clock,
	Hourglass,
	TriangleAlert,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatMonth, useFormat } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/reconcile")({
	component: ReconcilePage,
});

const IN = "var(--covered)";
const OUT = "var(--uncovered)";
const DIFFERS_C = "oklch(0.74 0.15 66)"; // amber
const NEUTRAL = "var(--muted-foreground)";
const tint = (c: string, pct: number) =>
	`color-mix(in oklab, ${c} ${pct}%, transparent)`;

/**
 * `partial` is deliberately **neutral, not amber**. A group that is short halfway through the month has
 * nothing wrong with it — the remaining payouts aren't due yet — so it must not share a colour with the
 * statuses that want your attention. Warm colour is reserved for things that need a decision.
 */
const STATUS: Record<
	ReconcileStatus,
	{ label: string; color: string; icon: typeof Check }
> = {
	received: { label: "Received", color: IN, icon: Check },
	partial: { label: "Still arriving", color: NEUTRAL, icon: Hourglass },
	differs: { label: "Amount differs", color: DIFFERS_C, icon: TriangleAlert },
	pending: { label: "Not due yet", color: NEUTRAL, icon: Clock },
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
				<header className="flex flex-col gap-4">
					<div className="flex flex-col gap-1">
						<h1 className="font-display font-medium text-3xl tracking-tight">
							Reconcile
						</h1>
						<p className="text-muted-foreground">
							The interest your plan expects, checked against what actually
							landed in the account.
						</p>
					</div>
					<MonthStrip months={months} value={month} onChange={setPicked} />
				</header>

				<History selected={month} onSelect={setPicked} />

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
/**
 * Leads with the gap, because that is the number you came for — two figures and an arrow made you do the
 * subtraction yourself. While the month is still running the gap is framed as *arriving*, not *short*: a
 * shortfall on the 21st is a statement about the calendar, not about your holdings.
 */
function SummaryBar({ res }: { res: ReconcileResult }) {
	const { formatINR } = useFormat();
	const { summary } = res;
	const gap = summary.actualAmount - summary.expectedAmount;
	const settled = !summary.inProgress;
	// Only a finished month can be judged. Before that, a negative gap is simply the rest of the month.
	const tone = settled ? (gap < 0 ? OUT : IN) : NEUTRAL;
	const chips: { s: ReconcileStatus; n: number }[] = [
		{ s: "received", n: summary.receivedCount },
		{ s: "partial", n: summary.partialCount },
		{ s: "pending", n: summary.pendingCount },
		{ s: "missed", n: summary.missedCount },
		{ s: "differs", n: summary.differsCount },
	];
	return (
		<section className="flex flex-col gap-5 rounded-2xl border border-border bg-card/40 px-6 py-6">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
						{settled
							? gap < 0
								? "Short this month"
								: "Ahead this month"
							: "Still to arrive"}
					</p>
					<p
						className="tnum font-display font-medium text-4xl leading-none"
						style={{ color: tone }}
					>
						{settled
							? `${gap < 0 ? "−" : "+"}${formatINR(Math.abs(gap))}`
							: formatINR(Math.max(0, -gap))}
					</p>
					<p className="mt-2 text-muted-foreground text-sm">
						<span className="tnum">{formatINR(summary.expectedAmount)}</span>{" "}
						expected ·{" "}
						<span className="tnum text-foreground/80">
							{formatINR(summary.actualAmount)}
						</span>{" "}
						landed
						{!settled && " so far"}
					</p>
				</div>
				<Progress
					value={
						summary.expectedAmount > 0
							? summary.actualAmount / summary.expectedAmount
							: 0
					}
					settled={settled}
				/>
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

/** How much of the month's expectation has landed. Capped at 100% so an overshoot doesn't overflow. */
function Progress({ value, settled }: { value: number; settled: boolean }) {
	const pct = Math.min(100, Math.max(0, value * 100));
	return (
		<div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
			<div className="h-2 overflow-hidden rounded-full bg-muted">
				<div
					className="h-full rounded-full transition-[width] duration-500 ease-out"
					style={{
						width: `${pct}%`,
						backgroundColor: settled ? (value >= 0.8 ? IN : OUT) : NEUTRAL,
					}}
				/>
			</div>
			<p className="text-right text-muted-foreground text-xs">
				<span className="tnum">{Math.round(pct)}%</span> of expected
			</p>
		</div>
	);
}

// ── history ───────────────────────────────────────────────────────────────────────────────────────────
/**
 * Twelve months of expected-vs-landed, so a month can be read against its neighbours rather than in
 * isolation. Bars are the landed share of expectation; the current month is outlined rather than filled,
 * because it is still being written. Clicking a bar selects that month.
 */
function History({
	selected,
	onSelect,
}: {
	selected: string;
	onSelect: (m: string) => void;
}) {
	const { formatINR } = useFormat();
	// 24 months in one query: the chart shows the last 12, the FY rollup needs a full previous April–March
	// underneath it. From any month in an Indian FY, reaching the start of the previous one is at most 24
	// months back.
	const q = useQuery(
		orpc.reconcile.history.queryOptions({ input: { months: 24 } }),
	);
	const all = (q.data as ReconcileSummary[] | undefined) ?? [];
	const rows = all.slice(-12);
	const withData = rows.filter((r) => r.expectedAmount > 0);
	if (withData.length < 2) return null;

	const max = Math.max(
		...rows.map((r) => Math.max(r.expectedAmount, r.actualAmount)),
	);
	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-baseline justify-between">
				<h2 className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
					Landed vs expected · 12 months
				</h2>
				<span className="text-muted-foreground text-xs">
					outline = still running
				</span>
			</div>
			<div className="flex h-24 items-end gap-1.5">
				{rows.map((r) => {
					const share = max > 0 ? r.actualAmount / max : 0;
					const expShare = max > 0 ? r.expectedAmount / max : 0;
					const ratio =
						r.expectedAmount > 0 ? r.actualAmount / r.expectedAmount : 1;
					const isSel = r.month === selected;
					const color = r.inProgress
						? NEUTRAL
						: ratio >= 0.8
							? IN
							: ratio >= 0.5
								? DIFFERS_C
								: OUT;
					return (
						<button
							key={r.month}
							type="button"
							onClick={() => onSelect(r.month)}
							title={`${formatMonth(r.month)} — ${formatINR(r.actualAmount)} of ${formatINR(r.expectedAmount)}`}
							className="group relative flex h-full flex-1 flex-col justify-end rounded-sm outline-offset-2 focus-visible:outline-2"
						>
							{/* expectation: the height the bar is aiming for */}
							<span
								className="absolute inset-x-0 rounded-[2px] border border-dashed"
								style={{
									height: `${Math.max(2, expShare * 100)}%`,
									borderColor: tint("var(--muted-foreground)", 45),
								}}
							/>
							<span
								className="relative rounded-[2px] transition-opacity"
								style={{
									height: `${Math.max(1, share * 100)}%`,
									backgroundColor: r.inProgress ? "transparent" : color,
									border: r.inProgress ? `1.5px solid ${color}` : undefined,
									opacity: isSel ? 1 : 0.55,
								}}
							/>
						</button>
					);
				})}
			</div>
			<div className="flex gap-1.5 text-[0.6rem] text-muted-foreground">
				{rows.map((r) => (
					<span
						key={r.month}
						className={`flex-1 text-center ${r.month === selected ? "text-foreground" : ""}`}
					>
						{formatMonth(r.month).replace(" '", " '")}
					</span>
				))}
			</div>

			<FyBars summaries={all} />
		</section>
	);
}

/** "2025-04" + "2026-03" → "Apr 2025 – Mar 2026"; same year → "Apr – Jun 2026". */
function monthRange(months: string[]): string {
	const a = months[0];
	const b = months.at(-1);
	if (!a || !b) return "";
	const short = (m: string) => formatMonth(m).split(" ")[0] ?? m;
	const year = (m: string) => m.slice(0, 4);
	if (a === b) return `${short(a)} ${year(a)}`;
	return year(a) === year(b)
		? `${short(a)} – ${short(b)} ${year(b)}`
		: `${short(a)} ${year(a)} – ${short(b)} ${year(b)}`;
}

/** Months in an Indian financial year. */
const FY_MONTHS = 12;

/** Where a "YYYY-MM" sits inside its FY: April is 1, March is 12. */
function fyPosition(month: string, startYear: number): number {
	const [y, m] = month.split("-").map(Number);
	if (!y || !m) return 0;
	return (y - startYear) * FY_MONTHS + (m - FY_START_MONTH) + 1;
}

/**
 * The same question at financial-year scale (Apr–Mar): across a whole year, did the interest turn up?
 * Current FY first at full strength, last FY dimmed beneath it — the pair exists for the comparison, so the
 * older one recedes rather than competing.
 *
 * **The track is always the whole year, April to March**, even when only part of it has happened — so the
 * empty right-hand side is how much year is left, and a tick marks where you have got to. The fill is
 * therefore `ratio × elapsed`: it reaches the tick exactly when everything expected so far has landed,
 * falls short of it when it hasn't, and overshoots when more arrived than planned.
 *
 * Only complete months are summed, so the tick sits at the end of the last finished month rather than at
 * today — fill and tick share one baseline instead of quietly measuring different things. That is also why
 * the range is spelled out: a year reading "Apr – Jun" is three months of evidence, not a year's worth.
 */
function FyBars({ summaries }: { summaries: ReconcileSummary[] }) {
	const { formatINR } = useFormat();
	const fys = reconcileByFy(summaries, { limit: 2 });
	if (fys.length === 0) return null;

	return (
		<div className="mt-4 flex flex-col gap-3 border-border border-t pt-4">
			{fys.map((fy, i) => {
				// Position of the last complete month, not the count — a gap in the statement then shifts
				// nothing, where counting months would slide the tick backwards.
				const elapsed = Math.min(
					1,
					fyPosition(fy.months.at(-1) ?? "", fy.startYear) / FY_MONTHS,
				);
				const pct =
					fy.ratio == null ? 0 : Math.min(100, fy.ratio * elapsed * 100);
				const color =
					fy.ratio == null || fy.ratio >= 0.8
						? IN
						: fy.ratio >= 0.5
							? DIFFERS_C
							: OUT;
				return (
					<div
						key={fy.label}
						className="flex flex-col gap-1.5"
						style={{ opacity: i === 0 ? 1 : 0.5 }}
					>
						<div className="flex flex-wrap items-baseline justify-between gap-x-4 text-xs">
							<span>
								<span className="font-medium">{fy.label}</span>
								<span className="text-muted-foreground">
									{" · "}
									{monthRange(fy.months)}
									{fy.inProgress ? " so far" : ""}
								</span>
							</span>
							<span className="tnum text-muted-foreground">
								<span className="text-foreground/80">
									{formatINR(fy.actualAmount)}
								</span>{" "}
								of {formatINR(fy.expectedAmount)}
								{fy.ratio != null && (
									<span style={{ color }}>
										{" · "}
										{Math.round(fy.ratio * 100)}%
									</span>
								)}
							</span>
						</div>
						<div className="relative h-2 overflow-hidden rounded-full bg-muted">
							<div
								className="h-full rounded-full"
								style={{ width: `${pct}%`, backgroundColor: color }}
							/>
							{elapsed < 1 && (
								<span
									className="pointer-events-none absolute inset-y-0 w-px bg-foreground/60"
									style={{ left: `${elapsed * 100}%` }}
									title={`${monthRange(fy.months)} complete — ${Math.round(elapsed * FY_MONTHS)} of ${FY_MONTHS} months`}
								/>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

// ── one expected event ──────────────────────────────────────────────────────────────────────────────────
/**
 * Reads left to right in the same order as the summary above it — expected, then landed, then the gap.
 * The old row put the landed figure first with expected trailing in small grey, so the eye learned one
 * order at the top of the page and had to unlearn it two hundred pixels later.
 *
 * The delta is only *coloured* when it means something: a mid-month shortfall is grey, because the money
 * isn't late, it's just Tuesday.
 */
function EventRow({ ev }: { ev: ReconciledEvent }) {
	const { formatINR } = useFormat();
	const meta = STATUS[ev.status];
	const [open, setOpen] = useState(false);
	const landed = ev.matches.length > 0;
	const deltaTone =
		ev.status === "partial" || ev.status === "pending"
			? NEUTRAL
			: ev.delta >= 0
				? IN
				: OUT;

	return (
		<li className="border-border border-b">
			<button
				type="button"
				onClick={() => landed && setOpen((o) => !o)}
				disabled={!landed}
				className="flex w-full items-center gap-3 py-3 text-left enabled:hover:bg-secondary/20"
			>
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
						<span style={{ color: meta.color }}>{meta.label}</span>
						{ev.memberCount > 1 ? ` · ${ev.memberCount} holdings` : ""}
						{landed ? ` · ${ev.matches.length} credits` : ""}
					</p>
				</div>

				<div className="tnum flex shrink-0 items-baseline gap-2 text-sm">
					<span className="text-muted-foreground">
						{formatINR(ev.expectedAmount)}
					</span>
					<span className="text-muted-foreground/50">→</span>
					<span className="w-20 text-right font-medium">
						{landed ? formatINR(ev.actualAmount) : "—"}
					</span>
					<span
						className="w-20 text-right font-medium"
						style={{ color: deltaTone }}
					>
						{ev.delta >= 0 ? "+" : "−"}
						{formatINR(Math.abs(ev.delta))}
					</span>
				</div>

				<ChevronRight
					className={`size-4 shrink-0 text-muted-foreground transition-transform ${
						open ? "rotate-90" : ""
					} ${landed ? "" : "opacity-0"}`}
				/>
			</button>

			{open && (
				<ul className="flex flex-col gap-1 pb-3 pl-10 text-sm">
					{ev.matches.map((c) => (
						<li key={c.txnId} className="flex items-baseline gap-3">
							<span className="tnum w-20 shrink-0 text-muted-foreground text-xs">
								{c.date}
							</span>
							<span className="tnum w-20 shrink-0 text-right">
								{formatINR(c.amount)}
							</span>
							<span className="truncate text-muted-foreground text-xs">
								{c.narration}
							</span>
						</li>
					))}
				</ul>
			)}
		</li>
	);
}

// ── suggestions ─────────────────────────────────────────────────────────────────────────────────────────
const INCOME_CATS = CATEGORIES.filter((c) => c.kind === "passive_income");

function Suggestions({ items }: { items: ReconcileSuggestion[] }) {
	const { formatINR } = useFormat();
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
						<Select
							aria-label="File under"
							value=""
							disabled={busy === s.txnId}
							onValueChange={(v) => fileUnder(s, v)}
							placeholder="File under…"
							groups={[
								{
									label: "Existing income category",
									options: INCOME_CATS.map((c) => ({
										value: c.key,
										label: c.label,
									})),
								},
								{
									label: "Or",
									options: [
										{ value: "__new__", label: "＋ New holding" },
										{ value: "__ignore__", label: "Not income — ignore" },
									],
								},
							]}
							className="h-9 w-auto shrink-0 rounded-md"
						/>
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
/**
 * Months as a scrollable strip rather than a dropdown. Reconciliation is a month-to-month scan — you check
 * one, then the one before it — and a dropdown hides that sequence behind a click. Newest sits on the
 * right, so the strip reads left-to-right like the history chart above it.
 */
function MonthStrip({
	months,
	value,
	onChange,
}: {
	months: string[];
	value: string;
	onChange: (m: string) => void;
}) {
	const list = (months.length > 0 ? months : [value]).slice(0, 24).reverse();
	// Newest sits on the right, so the strip loads scrolled to the left — with the selected month off
	// screen. Pull it into view on mount and whenever the selection changes (e.g. clicking a history bar
	// for an older month). `block: "nearest"` keeps this from scrolling the page vertically.
	const activeRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
	}, []);

	return (
		<div
			className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
			role="tablist"
			aria-label="Month"
		>
			{list.map((m) => {
				const active = m === value;
				return (
					<button
						key={m}
						ref={active ? activeRef : undefined}
						type="button"
						role="tab"
						aria-selected={active}
						onClick={() => onChange(m)}
						className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors ${
							active
								? "bg-foreground font-medium text-background"
								: "border border-border text-muted-foreground hover:text-foreground"
						}`}
					>
						{formatMonth(m)}
					</button>
				);
			})}
		</div>
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
