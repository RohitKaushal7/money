import {
	formatDate,
	type NetworthPoint,
	type NetworthSeries,
	networthSeries,
	todayISODate,
} from "@money/shared";
import { Button } from "@money/ui/components/button";
import { Sheet } from "@money/ui/components/sheet";
import { useIsPhone } from "@money/ui/hooks/use-media-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import {
	Area,
	Bar,
	Cell,
	ComposedChart,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { ArmedDelete } from "@/components/armed-delete";
import { DateInput } from "@/components/date-input";
import {
	type DateRange,
	DateRangePicker,
} from "@/components/date-range-picker";
import { TabBar } from "@/components/tab-bar";
import { FreedomView } from "@/components/wealth/freedom";
import { RunwayView } from "@/components/wealth/runway";
import { useMoney } from "@/lib/currency";
import { haptics } from "@/lib/haptics";
import { usePreference } from "@/lib/preferences";
import { orpc } from "@/utils/orpc";

const COVERED = "var(--covered)";
const UNCOVERED = "var(--uncovered)";

/** signed one-decimal percent, e.g. +10.5% / −35.1% */
function signedPct(r: number | null | undefined): string {
	if (r == null) return "—";
	const v = r * 100;
	return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
}

/** compact axis label "Jan '24" */
function fmtAxis(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

export function NetWorthOverTime() {
	const q = useQuery(orpc.networth.list.queryOptions());
	const m = useMoney();
	const isPhone = useIsPhone();
	const [range, setRange] = useState<DateRange>({});
	const [mode, setMode] = usePreference("wealth.chartMode");
	const s = q.data as NetworthSeries | undefined;

	if (q.isLoading) {
		return <div className="h-72 animate-pulse rounded-2xl bg-muted/40" />;
	}
	if (!s || s.points.length === 0) {
		return <EmptyNetWorth />;
	}

	// filter to the selected range and recompute growth/CAGR so the whole card reflects the window
	const inRange = (p: NetworthPoint) =>
		(!range.from || p.asOf >= range.from) && (!range.to || p.asOf <= range.to);
	const view = networthSeries(
		s.points.filter(inRange).map((p) => ({
			id: p.id,
			asOf: p.asOf,
			value: p.value,
			source: p.source,
			note: p.note,
		})),
	);
	const hasPoints = view.points.length > 0;
	const up = (view.cagr ?? 0) >= 0;
	const accent = up ? COVERED : UNCOVERED;

	return (
		<section className="flex flex-col gap-6">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="text-muted-foreground text-xs uppercase tracking-[0.2em] md:text-[0.65rem]">
						Net worth over time
					</p>
					<div className="mt-1 flex items-baseline gap-3">
						<span className="tnum font-display font-medium text-4xl leading-none">
							{m.fmt(view.latest ?? 0)}
						</span>
						{view.cagr != null && (
							<span
								className="flex items-center gap-1 font-medium text-sm"
								style={{ color: accent }}
							>
								{up ? (
									<TrendingUp className="size-4" />
								) : (
									<TrendingDown className="size-4" />
								)}
								{signedPct(view.cagr)}
								<span className="text-muted-foreground text-xs">/yr</span>
							</span>
						)}
					</div>
					{view.change != null && view.first != null && (
						<p className="mt-1 text-muted-foreground text-sm">
							<span className="tnum text-foreground/70">
								{view.change >= 0 ? "+" : "−"}
								{m.fmtc(Math.abs(view.change))}
							</span>{" "}
							since {formatDate(view.points[0]?.asOf ?? "")} · compounded
							annually
						</p>
					)}
				</div>
				{!isPhone && (
					<div className="flex flex-col items-end gap-2">
						<Controls />
						<div className="flex items-center gap-2">
							<ModeSwitch mode={mode} onChange={setMode} />
							<DateRangePicker defaultPreset="last-12m" onChange={setRange} />
						</div>
					</div>
				)}
			</div>

			{/* On a phone the actions sit under the number rather than beside it: there is no "beside" at 390px,
			    and logging is what you came here to do, so it gets a full-width thumb target. */}
			{isPhone && (
				<div className="-mt-2 flex flex-col gap-3">
					<PhoneControls />
					<TabBar
						tabs={MODE_TABS}
						active={mode}
						onSelect={setMode}
						className="w-full"
					/>
					<DateRangePicker defaultPreset="last-12m" onChange={setRange} />
				</div>
			)}

			{hasPoints ? (
				<>
					{mode === "runway" ? (
						<RunwayView points={view.points} />
					) : mode === "freedom" ? (
						<FreedomView points={view.points} />
					) : (
						<NetWorthChart points={view.points} />
					)}
					<NetWorthLog points={view.points} />
				</>
			) : (
				<p className="rounded-xl border border-border border-dashed px-6 py-10 text-center text-muted-foreground text-sm">
					No net-worth entries in this range.
				</p>
			)}
		</section>
	);
}

type Mode = "history" | "runway" | "freedom";

const MODE_TABS = [
	{ key: "history", label: "History" },
	{ key: "runway", label: "Runway" },
	{ key: "freedom", label: "Freedom" },
] as const satisfies readonly { key: Mode; label: string }[];

/**
 * Where the chart looks: back at what happened, forward at the money draining, or forward at it growing
 * past the point of needing to.
 */
function ModeSwitch({
	mode,
	onChange,
}: {
	mode: Mode;
	onChange: (m: Mode) => void;
}) {
	return (
		<div className="flex gap-1 rounded-full bg-muted/50 p-1 text-xs">
			{MODE_TABS.map(({ key: k, label }) => (
				<button
					key={k}
					type="button"
					onClick={() => onChange(k)}
					className={`rounded-full px-3 py-1 transition-colors ${
						mode === k
							? "bg-background font-medium shadow-sm"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					{label}
				</button>
			))}
		</div>
	);
}

type ChartDatum = {
	asOf: string;
	/** epoch ms — the x position, so spacing is proportional to real elapsed time */
	t: number;
	value: number;
	growthPct: number | null;
};

function NetWorthChart({ points }: { points: NetworthPoint[] }) {
	const m = useMoney();
	// 12px is the phone's type floor; desktop keeps its 11px axis.
	const tick = {
		fontSize: useIsPhone() ? 12 : 11,
		fill: "var(--muted-foreground)",
	};
	const data: ChartDatum[] = points.map((p) => ({
		asOf: p.asOf,
		t: new Date(p.asOf).getTime(),
		value: p.value,
		growthPct: p.growth == null ? null : p.growth * 100,
	}));

	return (
		<div className="h-72 w-full">
			<ResponsiveContainer width="100%" height="100%">
				<ComposedChart
					data={data}
					margin={{ top: 8, right: 8, bottom: 4, left: 8 }}
				>
					<defs>
						<linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stopColor={COVERED} stopOpacity={0.28} />
							<stop offset="100%" stopColor={COVERED} stopOpacity={0.02} />
						</linearGradient>
					</defs>
					<XAxis
						dataKey="t"
						type="number"
						scale="time"
						domain={["dataMin", "dataMax"]}
						tickFormatter={(v: number) => fmtAxis(new Date(v).toISOString())}
						tick={tick}
						tickLine={false}
						axisLine={{ stroke: "var(--border)" }}
						minTickGap={40}
					/>
					<YAxis
						yAxisId="value"
						tickFormatter={(v: number) => m.fmtc(v)}
						tick={tick}
						tickLine={false}
						axisLine={false}
						width={52}
						domain={[0, "dataMax"]}
					/>
					<YAxis
						yAxisId="growth"
						orientation="right"
						tickFormatter={(v: number) => `${Math.round(v)}%`}
						tick={tick}
						tickLine={false}
						axisLine={false}
						width={40}
					/>
					<ReferenceLine yAxisId="growth" y={0} stroke="var(--border)" />
					<Tooltip
						cursor={{ stroke: "var(--border)" }}
						isAnimationActive={false}
						content={<NetWorthTip fmt={m.fmt} />}
					/>
					<Bar yAxisId="growth" dataKey="growthPct" barSize={14} radius={2}>
						{data.map((d) => (
							<Cell
								key={d.asOf}
								fill={(d.growthPct ?? 0) >= 0 ? COVERED : UNCOVERED}
								fillOpacity={0.55}
							/>
						))}
					</Bar>
					<Area
						yAxisId="value"
						type="monotone"
						dataKey="value"
						stroke={COVERED}
						strokeWidth={2}
						fill="url(#nwFill)"
						isAnimationActive={false}
						dot={false}
						activeDot={{ r: 4, fill: COVERED }}
					/>
				</ComposedChart>
			</ResponsiveContainer>
		</div>
	);
}

function NetWorthTip({
	active,
	payload,
	fmt,
}: {
	active?: boolean;
	payload?: { payload: ChartDatum }[];
	fmt: (inr: number) => string;
}) {
	if (!active || !payload?.length) return null;
	const d = payload[0]?.payload;
	if (!d) return null;
	const up = (d.growthPct ?? 0) >= 0;
	return (
		<div className="rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md">
			<p className="font-medium text-sm">{formatDate(d.asOf)}</p>
			<p className="tnum mt-0.5 text-sm">{fmt(d.value)}</p>
			{d.growthPct != null && (
				<p className="tnum text-xs" style={{ color: up ? COVERED : UNCOVERED }}>
					{signedPct(d.growthPct / 100)} annualised
				</p>
			)}
		</div>
	);
}

function NetWorthLog({ points }: { points: NetworthPoint[] }) {
	const qc = useQueryClient();
	const m = useMoney();
	const isPhone = useIsPhone();
	const remove = useMutation({
		...orpc.networth.remove.mutationOptions(),
		onSuccess: () => qc.invalidateQueries(),
	});
	// newest first — a log reads top-down from "now"
	const rows = [...points].reverse();

	if (isPhone) return <PhoneLog rows={rows} />;

	return (
		<div className="overflow-hidden rounded-xl border border-border">
			<div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-border border-b bg-muted/30 px-4 py-2 text-[0.65rem] text-muted-foreground uppercase tracking-[0.15em]">
				<span>Date</span>
				<span className="text-right">Value</span>
				<span className="w-20 text-right">Growth /yr</span>
				{/* Reserves the delete column's idle width — the track is `auto` so an armed row can grow. */}
				<span className="w-6" />
			</div>
			<ul className="max-h-80 divide-y divide-border overflow-y-auto">
				{rows.map((p) => {
					const up = (p.growth ?? 0) >= 0;
					return (
						<li
							key={p.asOf}
							className="group grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-4 py-2.5 text-sm hover:bg-secondary/20"
						>
							<span className="flex items-center gap-2">
								{formatDate(p.asOf)}
								{p.source === "computed" && (
									<span className="rounded bg-muted px-1.5 py-0.5 text-[0.6rem] text-muted-foreground">
										auto
									</span>
								)}
							</span>
							<span className="tnum text-right">{m.fmt(p.value)}</span>
							<span
								className="tnum w-20 text-right"
								style={{
									color:
										p.growth == null
											? "var(--muted-foreground)"
											: up
												? COVERED
												: UNCOVERED,
								}}
							>
								{p.growth == null ? "—" : signedPct(p.growth)}
							</span>
							{/* Always visible, not hover-revealed: it's the row's only action, and hover-reveal is
							    unreachable on touch. Safe to leave on screen because it takes two taps. */}
							<ArmedDelete
								size="icon-xs"
								title={`Delete ${formatDate(p.asOf)}`}
								onConfirm={() => p.id != null && remove.mutate({ id: p.id })}
							/>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

/**
 * "Log today" and "Add entry", shared by the desktop controls and the phone ones so the two can't disagree
 * about what a valid entry is.
 */
function useEntryForm() {
	const qc = useQueryClient();
	const invalidate = () => qc.invalidateQueries();
	const [open, setOpen] = useState(false);
	const [date, setDate] = useState<string | null>("");
	const [value, setValue] = useState("");

	const logToday = useMutation({
		...orpc.networth.logToday.mutationOptions(),
		onSuccess: invalidate,
	});
	const add = useMutation({
		...orpc.networth.add.mutationOptions(),
		onSuccess: () => {
			invalidate();
			setOpen(false);
			setDate("");
			setValue("");
		},
	});

	const parsed = Number(value.replace(/,/g, ""));
	const valid =
		!!date && value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;
	const submit = (onDone?: () => void) => {
		const v = Number(value.replace(/,/g, ""));
		if (!date || !Number.isFinite(v) || v < 0) return;
		add.mutate({ asOf: date, value: v }, { onSuccess: onDone });
	};

	return {
		open,
		setOpen,
		date,
		setDate,
		value,
		setValue,
		valid,
		logToday,
		add,
		submit,
	};
}

function Controls() {
	const {
		open,
		setOpen,
		date,
		setDate,
		value,
		setValue,
		logToday,
		add,
		submit,
	} = useEntryForm();

	return (
		<div className="flex flex-col items-end gap-2">
			<div className="flex gap-2">
				<button
					type="button"
					onClick={() => logToday.mutate(undefined)}
					disabled={logToday.isPending}
					className="rounded-full border border-border px-3.5 py-1.5 font-medium text-xs transition-colors hover:bg-secondary disabled:opacity-50"
				>
					{logToday.isPending ? "Logging…" : "Log today"}
				</button>
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					className="flex items-center gap-1 rounded-full border border-border px-3.5 py-1.5 font-medium text-xs transition-colors hover:bg-secondary"
				>
					<Plus className="size-3.5" /> Add entry
				</button>
			</div>
			{open && (
				<div className="flex items-center gap-2 rounded-lg border border-border bg-card/60 p-2">
					<DateInput
						aria-label="Date"
						value={date}
						onChange={setDate}
						max={todayISODate()}
						className="w-36"
						inputClassName="h-auto rounded-md border-border bg-background py-1 text-sm md:text-sm"
					/>
					<input
						type="text"
						inputMode="numeric"
						placeholder="₹ value"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && submit()}
						className="tnum w-32 rounded-md border border-border bg-background px-2 py-1 text-sm"
					/>
					<button
						type="button"
						onClick={() => submit()}
						disabled={add.isPending}
						className="rounded-md bg-foreground px-3 py-1 font-medium text-background text-sm disabled:opacity-50"
					>
						Save
					</button>
				</div>
			)}
		</div>
	);
}

/**
 * The phone's version of the controls. Logging today is the screen's one primary action, so it is a full,
 * filled button; a back-dated entry is the rarer secondary, and its form opens in a sheet instead of
 * unfolding inline where the keyboard would cover it.
 */
function PhoneControls() {
	const f = useEntryForm();
	return (
		<>
			<div className="flex gap-2">
				<Button
					size="lg"
					className="h-12 flex-1 rounded-xl text-base"
					onClick={() =>
						f.logToday.mutate(undefined, { onSuccess: () => haptics.saved() })
					}
					disabled={f.logToday.isPending}
				>
					{f.logToday.isPending ? "Logging…" : "Log today"}
				</Button>
				<Button
					size="lg"
					variant="secondary"
					className="h-12 rounded-xl px-4 text-base"
					onClick={() => f.setOpen(true)}
				>
					<Plus className="size-4" /> Add entry
				</Button>
			</div>
			<Sheet
				open={f.open}
				onOpenChange={f.setOpen}
				title="Add an entry"
				description="A net-worth point for a past date. An entry on a date that already has one replaces it."
				footer={
					<Button
						size="lg"
						className="h-12 w-full rounded-xl text-base"
						disabled={!f.valid || f.add.isPending}
						onClick={() => f.submit(() => haptics.saved())}
					>
						{f.add.isPending ? "Saving…" : "Save entry"}
					</Button>
				}
			>
				<EntryField label="Date">
					<DateInput
						aria-label="Date"
						value={f.date}
						onChange={f.setDate}
						max={todayISODate()}
						inputClassName="h-12 rounded-xl text-base md:text-base"
					/>
				</EntryField>
				<EntryField label="Net worth">
					<ValueInput
						value={f.value}
						onChange={f.setValue}
						onEnter={() => f.submit(() => haptics.saved())}
					/>
				</EntryField>
			</Sheet>
		</>
	);
}

function EntryField({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-muted-foreground text-sm">{label}</span>
			{children}
		</div>
	);
}

/** 16px so iOS doesn't zoom into it, decimal keypad, rupee sign outside the value so it never gets parsed. */
function ValueInput({
	value,
	onChange,
	onEnter,
}: {
	value: string;
	onChange: (v: string) => void;
	onEnter: () => void;
}) {
	return (
		<label className="flex h-12 items-center gap-2 rounded-xl border border-input px-3 focus-within:border-ring dark:bg-input/30">
			<span className="text-muted-foreground">₹</span>
			<input
				type="text"
				inputMode="decimal"
				enterKeyHint="done"
				placeholder="0"
				aria-label="Net worth, rupees"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => e.key === "Enter" && onEnter()}
				className="tnum h-full min-w-0 flex-1 bg-transparent text-base outline-none"
			/>
		</label>
	);
}

/** Rows shown before "Show all": enough to see the recent trend without burying the holdings below. */
const PHONE_LOG_ROWS = 6;

/**
 * The log as phone list rows: date on the left, value and growth on the right, the whole row a target.
 * The delete lives in the row's sheet, not on the row, so a 24px trash icon isn't sitting under the thumb on
 * every line of a scrolling list.
 */
function PhoneLog({ rows }: { rows: NetworthPoint[] }) {
	const m = useMoney();
	const [all, setAll] = useState(false);
	const [openAsOf, setOpenAsOf] = useState<string | null>(null);
	const shown = all ? rows : rows.slice(0, PHONE_LOG_ROWS);
	const selected = rows.find((r) => r.asOf === openAsOf) ?? null;

	return (
		<div className="overflow-hidden rounded-2xl border border-border">
			<ul className="divide-y divide-border">
				{shown.map((p) => {
					const up = (p.growth ?? 0) >= 0;
					return (
						<li key={p.asOf}>
							<button
								type="button"
								onClick={() => setOpenAsOf(p.asOf)}
								className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-secondary/60"
							>
								<span className="flex min-w-0 flex-1 items-center gap-2">
									<span className="tnum">{formatDate(p.asOf)}</span>
									{p.source === "computed" && (
										<span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
											auto
										</span>
									)}
								</span>
								<span className="flex shrink-0 flex-col items-end">
									<span className="tnum font-medium">{m.fmt(p.value)}</span>
									<span
										className="tnum text-xs"
										style={{
											color:
												p.growth == null
													? "var(--muted-foreground)"
													: up
														? COVERED
														: UNCOVERED,
										}}
									>
										{p.growth == null ? "—" : `${signedPct(p.growth)} /yr`}
									</span>
								</span>
							</button>
						</li>
					);
				})}
			</ul>
			{rows.length > PHONE_LOG_ROWS && (
				<button
					type="button"
					onClick={() => setAll((a) => !a)}
					className="flex min-h-12 w-full items-center justify-center gap-1.5 border-border border-t text-muted-foreground text-sm active:bg-secondary/60"
				>
					{all ? "Show fewer" : `Show all ${rows.length} entries`}
					<ChevronDown
						className={`size-4 transition-transform ${all ? "rotate-180" : ""}`}
					/>
				</button>
			)}
			<EntrySheet
				point={selected}
				onOpenChange={(o) => !o && setOpenAsOf(null)}
			/>
		</div>
	);
}

/** One entry: what it is, a correction of its value, and the two-tap delete. */
function EntrySheet({
	point,
	onOpenChange,
}: {
	point: NetworthPoint | null;
	onOpenChange: (open: boolean) => void;
}) {
	const qc = useQueryClient();
	const m = useMoney();
	const [value, setValue] = useState("");
	// Keep the last point on screen while the sheet animates shut, rather than blanking it mid-swipe. Keyed
	// on date and value, not identity: the series is rebuilt every render, and a background refetch must not
	// wipe a correction you're halfway through typing.
	const [last, setLast] = useState<NetworthPoint | null>(null);
	if (point && (point.asOf !== last?.asOf || point.value !== last.value)) {
		setLast(point);
		setValue(String(point.value));
	}
	const close = () => onOpenChange(false);
	const remove = useMutation({
		...orpc.networth.remove.mutationOptions(),
		onSuccess: () => {
			qc.invalidateQueries();
			close();
		},
	});
	// `add` upserts on the date, so saving here corrects this entry rather than adding a second one.
	const correct = useMutation({
		...orpc.networth.add.mutationOptions(),
		onSuccess: () => {
			haptics.saved();
			qc.invalidateQueries();
			close();
		},
	});

	const p = point ?? last;
	const v = Number(value.replace(/,/g, ""));
	const changed =
		p != null &&
		value.trim() !== "" &&
		Number.isFinite(v) &&
		v >= 0 &&
		v !== p.value;
	const save = () => {
		if (!p || !changed) return;
		// A hand-corrected point is a manual one; the auto note would no longer describe it.
		correct.mutate({
			asOf: p.asOf,
			value: v,
			note: p.source === "manual" ? (p.note ?? undefined) : undefined,
		});
	};
	const up = (p?.growth ?? 0) >= 0;

	return (
		<Sheet
			open={point != null}
			onOpenChange={onOpenChange}
			title={p ? formatDate(p.asOf) : ""}
			description={
				p?.source === "computed"
					? "Logged automatically: cash on hand plus every holding's current value."
					: "Entered by hand."
			}
		>
			{p && (
				<>
					<div className="flex items-baseline justify-between gap-3">
						<span className="tnum font-display font-medium text-4xl leading-none">
							{m.fmt(p.value)}
						</span>
						<span
							className="tnum text-sm"
							style={{
								color:
									p.growth == null
										? "var(--muted-foreground)"
										: up
											? COVERED
											: UNCOVERED,
							}}
						>
							{p.growth == null
								? "first in range"
								: `${signedPct(p.growth)} /yr`}
						</span>
					</div>
					{p.days != null && p.growth != null && (
						<p className="text-muted-foreground text-sm">
							Annualised growth over the {p.days} days since the previous entry.
						</p>
					)}
					{p.note && p.source === "manual" && (
						<p className="text-muted-foreground text-sm">{p.note}</p>
					)}

					<div className="mt-2 flex flex-col gap-2 border-border border-t pt-4">
						<span className="text-muted-foreground text-sm">
							Correct the value
						</span>
						<div className="flex gap-2">
							<div className="min-w-0 flex-1">
								<ValueInput value={value} onChange={setValue} onEnter={save} />
							</div>
							<Button
								size="lg"
								className="h-12 rounded-xl px-5 text-base"
								disabled={!changed || correct.isPending}
								onClick={save}
							>
								Save
							</Button>
						</div>
					</div>

					<div className="mt-2 border-border border-t pt-4">
						<ArmedDelete
							size="sm"
							label="Delete entry"
							title={`Delete ${formatDate(p.asOf)}`}
							disabled={remove.isPending || p.id == null}
							onConfirm={() => p.id != null && remove.mutate({ id: p.id })}
							className="h-12 w-full rounded-xl text-base"
						/>
					</div>
				</>
			)}
		</Sheet>
	);
}

function EmptyNetWorth() {
	const qc = useQueryClient();
	const logToday = useMutation({
		...orpc.networth.logToday.mutationOptions(),
		onSuccess: () => qc.invalidateQueries(),
	});
	return (
		<section className="flex flex-col items-start gap-4 rounded-2xl border border-border border-dashed px-8 py-14 max-md:px-5 max-md:py-10">
			<p className="font-display font-medium text-xl">No net-worth log yet</p>
			<p className="max-w-md text-muted-foreground text-sm">
				Log a point to start the trend — each new point shows the annualised
				growth since the last. "Log today" captures your cash balance plus every
				holding's current value automatically.
			</p>
			<button
				type="button"
				onClick={() => logToday.mutate(undefined)}
				disabled={logToday.isPending}
				className="rounded-lg bg-foreground px-4 py-2 font-medium text-background text-sm disabled:opacity-50 max-md:h-12 max-md:w-full max-md:rounded-xl max-md:text-base"
			>
				{logToday.isPending ? "Logging…" : "Log today's net worth →"}
			</button>
		</section>
	);
}
