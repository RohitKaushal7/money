import {
	freedomProjection,
	type NetworthPoint,
	observedSavingRate,
	perpetuityTarget,
	type SpendingTrends,
	spendingInsights,
	type WealthSummary,
} from "@money/shared";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useMoney } from "@/lib/currency";
import { useRunwayAssumptions } from "@/lib/preferences";
import { orpc } from "@/utils/orpc";

const COVERED = "var(--covered)";
const UNCOVERED = "var(--uncovered)";

/** "Feb 2055" */
function fmtMonthYear(iso: string): string {
	return new Date(iso).toLocaleDateString("en-GB", {
		month: "short",
		year: "numeric",
	});
}

/** The four inputs the answer is made of. Each starts at its measured value. */
interface Knobs {
	spend: number;
	saving: number;
	/** annual, as a fraction */
	annualReturn: number;
	inflation: number;
}

/**
 * The accumulation view: how long until the portfolio is big enough to never run out.
 *
 * Runway asks how long the money lasts if income stopped today. This asks when it stops mattering.
 *
 * ## Why there is no chart here
 *
 * There was one, and it earned nothing. At ~2% real growth a thirty-year projection is visually a straight
 * line, so the curve conveyed only "number goes up" while burying the two facts that matter — how far along
 * you are, and what would move the date. A progress bar states the first honestly, and the knobs make the
 * second interactive rather than a claim in prose.
 *
 * ## Everything is in today's rupees
 *
 * A perpetual corpus runs on the **real** return. Quoting a nominal one, or comparing a nominally-growing
 * balance against a target that inflates with spending, flatters the answer badly — see `@money/shared/freedom`.
 */
export function FreedomView({ points }: { points: NetworthPoint[] }) {
	const m = useMoney();
	const wealth = useQuery(orpc.plan.wealth.queryOptions());
	const w = wealth.data as WealthSummary | undefined;
	const spending = useQuery(orpc.spending.overview.queryOptions({ input: {} }));
	// Only the *baseline* comes from the shared runway preferences. The knobs below are a sandbox: exploring
	// here must not silently re-draw the Runway view behind your back.
	const { assumptions } = useRunwayAssumptions(w?.avgRoi);

	// What you actually spend, not what the plan budgets. `w.monthlyExpenses` is the plan figure, and
	// building the target on it would understate what freedom costs by exactly the amount you overspend.
	const trends = spending.data as SpendingTrends | undefined;
	const actualSpend = useMemo(
		() => (trends ? spendingInsights(trends).recentMean : 0),
		[trends],
	);
	const planSpend = w?.monthlyExpenses ?? 0;

	// Measured from history, stripped of return at the *portfolio's* rate — not at the projection assumption.
	// Toggling "no growth" changes what the future is drawn at; it cannot change what you already saved.
	const observed = useMemo(
		() =>
			observedSavingRate({
				logs: points.map((p) => ({ asOf: p.asOf, value: p.value })),
				annualReturn: w?.avgRoi ?? 0,
			}),
		[points, w?.avgRoi],
	);

	const actual: Knobs | null = useMemo(() => {
		const spend = actualSpend > 0 ? actualSpend : planSpend;
		if (!(spend > 0) || observed == null) return null;
		return {
			spend,
			saving: observed,
			annualReturn: assumptions.annualReturn,
			inflation: assumptions.inflation,
		};
	}, [actualSpend, planSpend, observed, assumptions]);

	const [edits, setEdits] = useState<Partial<Knobs>>({});
	const anchor = points.at(-1);

	if (wealth.isLoading || spending.isLoading) {
		return <div className="h-64 animate-pulse rounded-2xl bg-muted/40" />;
	}
	if (!anchor || !w) {
		return (
			<Note>
				Log a net-worth point first — the climb has to start somewhere real.
			</Note>
		);
	}
	if (!(actualSpend > 0) && !(planSpend > 0)) {
		return (
			<Note>
				Add recurring expenses on the Plan page. Without them there is nothing
				to fund, so "never runs out" is true of any amount.
			</Note>
		);
	}
	if (observed == null || !actual) {
		return (
			<Note>
				Log your net worth twice, at least six months apart. Freedom needs a
				saving rate, and one read off a fortnight is noise.
			</Note>
		);
	}

	const knobs: Knobs = { ...actual, ...edits };
	const dirty = (Object.keys(edits) as (keyof Knobs)[]).some(
		(k) => edits[k] != null && edits[k] !== actual[k],
	);

	/** One scenario, end to end: what it costs to be free and when you get there. */
	const run = (k: Knobs) => {
		const assume = { annualReturn: k.annualReturn, inflation: k.inflation };
		const target = perpetuityTarget({
			monthlyExpenses: k.spend,
			assumptions: assume,
		});
		if (target == null) return { target: null, proj: null };
		return {
			target,
			proj: freedomProjection({
				startValue: anchor.value,
				startDate: anchor.asOf,
				monthlyContribution: k.saving,
				target,
				assumptions: assume,
			}),
		};
	};

	const now = run(knobs);
	const base = dirty ? run(actual) : now;

	return (
		<div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
			<Answer
				result={now}
				baseline={dirty ? base : null}
				wealth={anchor.value}
				knobs={knobs}
				actual={actual}
				planSpend={planSpend}
				// A cut moves *both* ends: it lowers the target and frees the same sum to be saved. Setting
				// spending alone would show half the lever while the copy claims all of it.
				onTryPlan={() =>
					setEdits((e) => ({
						...e,
						spend: planSpend,
						saving: (e.saving ?? actual.saving) + (actual.spend - planSpend),
					}))
				}
			/>
			<Panel
				knobs={knobs}
				actual={actual}
				planSpend={planSpend}
				dirty={dirty}
				hidden={m.hidden}
				onChange={(k, v) => setEdits((e) => ({ ...e, [k]: v }))}
				onReset={() => setEdits({})}
			/>
		</div>
	);
}

type Result = ReturnType<
	(k: Knobs) => {
		target: number | null;
		proj: ReturnType<typeof freedomProjection> | null;
	}
>;

function Answer({
	result,
	baseline,
	wealth,
	knobs,
	actual,
	planSpend,
	onTryPlan,
}: {
	result: Result;
	/** the un-edited scenario, when the knobs have been moved off it */
	baseline: Result | null;
	wealth: number;
	knobs: Knobs;
	actual: Knobs;
	planSpend: number;
	onTryPlan: () => void;
}) {
	const m = useMoney();
	const { target, proj } = result;

	if (target == null || proj == null) {
		return (
			<Note>
				At {(knobs.annualReturn * 100).toFixed(1)}% return against{" "}
				{(knobs.inflation * 100).toFixed(1)}% inflation,{" "}
				<span className="text-foreground">no corpus lasts forever</span> —
				spending overtakes any starting amount, however large. Raise the return
				or lower inflation.
			</Note>
		);
	}

	const years = proj.yearsToTarget;
	const wasYears = baseline?.proj?.yearsToTarget ?? null;
	const delta = years != null && wasYears != null ? wasYears - years : null;
	const pct = Math.min(100, Math.max(0, proj.progress * 100));
	const basePct =
		baseline?.proj != null
			? Math.min(100, Math.max(0, baseline.proj.progress * 100))
			: null;

	return (
		<div className="flex flex-col gap-5 rounded-2xl border border-border px-6 py-6">
			<div>
				<p className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
					Free in
				</p>
				{years == null ? (
					<p
						className="mt-2 font-display font-medium text-3xl leading-none"
						style={{ color: UNCOVERED }}
					>
						Not within a lifetime
					</p>
				) : (
					<div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<span
							className="tnum font-display font-medium text-4xl leading-none"
							style={{ color: COVERED }}
						>
							{years.toFixed(1)}
							<span className="ml-1 font-normal text-muted-foreground text-xl">
								yr
							</span>
						</span>
						{proj.freeOn && (
							<span className="text-muted-foreground text-sm">
								· {fmtMonthYear(proj.freeOn)}
							</span>
						)}
						{delta != null && Math.abs(delta) >= 0.05 && (
							<span
								className="tnum text-sm"
								style={{ color: delta > 0 ? COVERED : UNCOVERED }}
							>
								{delta > 0 ? "−" : "+"}
								{Math.abs(delta).toFixed(1)} yr vs your actuals
							</span>
						)}
					</div>
				)}
			</div>

			<div className="flex flex-col gap-2">
				<div className="relative h-2 overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full transition-[width] duration-500"
						style={{
							width: `${Math.max(1.5, pct)}%`,
							backgroundColor: COVERED,
						}}
					/>
					{basePct != null && Math.abs(basePct - pct) >= 0.3 && (
						// Where you'd be without the edits — so a knob's effect on the *goalpost* is visible,
						// not just its effect on the date.
						<span
							className="absolute top-0 h-full w-px bg-foreground/50"
							style={{ left: `${Math.max(0.5, basePct)}%` }}
						/>
					)}
				</div>
				<p className="text-muted-foreground text-xs">
					<span className="tnum font-bold text-foreground">
						{proj.progress >= 0.1
							? (proj.progress * 100).toFixed(1)
							: (proj.progress * 100).toFixed(2)}
						%
					</span>{" "}
					of the way there —{" "}
					<span className="tnum font-bold text-foreground">
						{m.fmtc(wealth)}
					</span>{" "}
					of <span className="tnum font-bold">{m.fmtc(target)}</span>
					{baseline?.target != null &&
						Math.abs(baseline.target - target) > 1 && (
							<span> · was {m.fmtc(baseline.target)}</span>
						)}
				</p>
			</div>

			<dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-border/70 border-t pt-4 text-xs">
				<Fact
					label="Real growth"
					value={`${(proj.realRate * 100).toFixed(1)}% /yr`}
					note="after inflation — what actually compounds"
				/>
				<Fact
					label="Saving"
					value={`${m.fmt(Math.round(knobs.saving))} /mo`}
					note={
						knobs.saving === actual.saving
							? "measured over the selected range"
							: `you actually save ${m.fmt(Math.round(actual.saving))}`
					}
				/>
			</dl>

			{planSpend > 0 &&
				knobs.spend !== planSpend &&
				actual.spend > planSpend && (
					<button
						type="button"
						onClick={onTryPlan}
						className="rounded-lg border border-border border-dashed px-3 py-2 text-left text-xs leading-relaxed transition-colors hover:border-foreground/30 hover:bg-secondary/30"
					>
						<span className="text-muted-foreground">
							What if you spent your{" "}
						</span>
						<span className="tnum font-bold text-foreground">
							{m.fmt(Math.round(planSpend))}
						</span>
						<span className="text-muted-foreground">
							{" "}
							plan budget instead? A cut lowers the target as well as raising
							what you save — tap to try it.
						</span>
					</button>
				)}
		</div>
	);
}

function Fact({
	label,
	value,
	note,
}: {
	label: string;
	value: string;
	note: string;
}) {
	return (
		<div>
			<dt className="text-[0.6rem] text-muted-foreground uppercase tracking-[0.18em]">
				{label}
			</dt>
			<dd className="tnum mt-1 font-medium text-sm">{value}</dd>
			<dd className="mt-0.5 text-[0.7rem] text-muted-foreground">{note}</dd>
		</div>
	);
}

/**
 * The four inputs, each prefilled with what was measured.
 *
 * Editing is local — the Runway view keeps its own assumptions — so this is a sandbox you cannot break
 * anything from. The hint under each field always names the real value, so "what did I change it from" never
 * requires a reset to answer.
 */
function Panel({
	knobs,
	actual,
	planSpend,
	dirty,
	hidden,
	onChange,
	onReset,
}: {
	knobs: Knobs;
	actual: Knobs;
	planSpend: number;
	dirty: boolean;
	hidden: boolean;
	onChange: (k: keyof Knobs, v: number) => void;
	onReset: () => void;
}) {
	const m = useMoney();
	return (
		<div className="flex flex-col gap-4 rounded-2xl border border-border bg-card/30 px-5 py-5">
			<div className="flex items-center justify-between gap-3">
				<p className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
					What if
				</p>
				{dirty && (
					<button
						type="button"
						onClick={onReset}
						className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[0.7rem] text-muted-foreground transition-colors hover:text-foreground"
					>
						<RotateCcw className="size-3" />
						Reset
					</button>
				)}
			</div>

			<Knob
				label="Spending"
				unit="/mo"
				value={knobs.spend}
				actual={actual.spend}
				step={1000}
				hidden={hidden}
				format={(v) => m.fmt(Math.round(v))}
				hint={
					planSpend > 0 && Math.abs(planSpend - actual.spend) > 1
						? `actual · your plan budget is ${m.fmtc(planSpend)}`
						: "what you actually spend"
				}
				onChange={(v) => onChange("spend", v)}
			/>
			<Knob
				label="Saving"
				unit="/mo"
				value={knobs.saving}
				actual={actual.saving}
				step={1000}
				hidden={hidden}
				format={(v) => m.fmt(Math.round(v))}
				hint="observed from your net-worth logs"
				onChange={(v) => onChange("saving", v)}
			/>
			<Knob
				label="Return"
				unit="% /yr"
				value={knobs.annualReturn * 100}
				actual={actual.annualReturn * 100}
				step={0.5}
				decimals={1}
				format={(v) => `${v.toFixed(1)}%`}
				hint="your blended portfolio rate, after tax"
				onChange={(v) => onChange("annualReturn", v / 100)}
			/>
			<Knob
				label="Inflation"
				unit="% /yr"
				value={knobs.inflation * 100}
				actual={actual.inflation * 100}
				step={0.5}
				decimals={1}
				format={(v) => `${v.toFixed(1)}%`}
				hint="India's long-run CPI sits near 6%"
				onChange={(v) => onChange("inflation", v / 100)}
			/>

			<p className="text-[0.7rem] text-muted-foreground leading-relaxed">
				Return and inflation are the fragile pair — the target divides by the
				gap between them, so a point either way moves it by crores. Nudge them
				and see.
			</p>
		</div>
	);
}

function Knob({
	label,
	unit,
	value,
	actual,
	step,
	decimals = 0,
	hidden = false,
	format,
	hint,
	onChange,
}: {
	label: string;
	unit: string;
	value: number;
	actual: number;
	step: number;
	decimals?: number;
	/** privacy mode: rupee knobs stop showing their value, and stop being editable */
	hidden?: boolean;
	format: (v: number) => string;
	hint: string;
	onChange: (v: number) => void;
}) {
	const id = useId();
	const moved = Math.abs(value - actual) > 10 ** -(decimals + 2);
	return (
		// Associated by id rather than by wrapping: in privacy mode the field renders as dots with no input
		// at all, and a label wrapping nothing is a label pointing nowhere.
		<div className="flex flex-col gap-1">
			<span className="flex items-baseline justify-between gap-2">
				<label
					htmlFor={id}
					className="text-[0.6rem] text-muted-foreground uppercase tracking-[0.18em]"
				>
					{label}
				</label>
				{moved && (
					<span className="tnum text-[0.65rem] text-muted-foreground">
						was {format(actual)}
					</span>
				)}
			</span>
			<span
				className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
					moved ? "border-foreground/30 bg-secondary/40" : "border-border"
				}`}
			>
				{hidden ? (
					<span className="flex-1 text-muted-foreground text-sm">••••••</span>
				) : (
					<input
						id={id}
						type="number"
						value={decimals > 0 ? value.toFixed(decimals) : Math.round(value)}
						step={step}
						min={0}
						onChange={(e) => {
							const v = Number(e.target.value);
							if (Number.isFinite(v) && v >= 0) onChange(v);
						}}
						className="tnum w-full flex-1 bg-transparent font-medium text-sm outline-none"
					/>
				)}
				<span className="shrink-0 text-muted-foreground text-xs">{unit}</span>
			</span>
			<span className="text-[0.7rem] text-muted-foreground">{hint}</span>
		</div>
	);
}

function Note({ children }: { children: React.ReactNode }) {
	return (
		<p className="rounded-xl border border-border border-dashed px-6 py-10 text-center text-muted-foreground text-sm">
			{children}
		</p>
	);
}
