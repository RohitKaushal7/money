import { fyLabelFor, TAX_YEARS, taxFyChoices } from "@money/shared";
import { Button } from "@money/ui/components/button";
import { Select } from "@money/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useMoney } from "@/lib/currency";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/tax")({ component: TaxPage });

/** The client's current Indian FY label, e.g. "FY2026-27". */
function currentFyLabel(): string {
	const now = new Date();
	return fyLabelFor(now.getFullYear(), now.getMonth() + 1);
}

interface Draft {
	regimeChoice: "old" | "new" | null;
	salaryIncome: number;
	otherIncome: number;
	basicSalary: number;
	hraReceived: number;
	rentPaid: number;
	metro: boolean;
	capitalGains: {
		equityStcg: number;
		equityLtcg: number;
		crypto: number;
		otherStcg: number;
		otherLtcg: number;
	};
	deductions: { s80c: number; s80d: number; s80tta: number };
	s80ddOn: boolean;
}

const EMPTY: Draft = {
	regimeChoice: null,
	salaryIncome: 0,
	otherIncome: 0,
	basicSalary: 0,
	hraReceived: 0,
	rentPaid: 0,
	metro: true,
	capitalGains: {
		equityStcg: 0,
		equityLtcg: 0,
		crypto: 0,
		otherStcg: 0,
		otherLtcg: 0,
	},
	deductions: { s80c: 0, s80d: 0, s80tta: 0 },
	s80ddOn: false,
};

function TaxPage() {
	// The year list comes from the shared rules, not from `tax.compute`, which fails for a year without rules.
	const [choices] = useState(() => taxFyChoices(currentFyLabel()));
	const [fy, setFy] = useState(choices.initial);
	return (
		// The scroll padding keeps a focused field clear of the sticky result bar on a phone.
		<main className="h-full overflow-y-auto max-md:scroll-pb-28">
			<div className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-10 max-md:gap-6 max-md:px-4 max-md:pt-6 max-md:pb-6 sm:px-8 sm:py-14">
				<header className="flex flex-wrap items-end justify-between gap-3">
					<div className="flex flex-col gap-1">
						<h1 className="font-display font-medium text-3xl tracking-tight">
							Tax
						</h1>
						<p className="text-muted-foreground max-md:text-sm">
							Old vs new regime, capital gains, and deduction planning — per FY.
						</p>
					</div>
					<FyPicker fy={fy} fys={choices.fys} onChange={setFy} />
				</header>
				<TaxForm key={fy} fy={fy} />
			</div>
		</main>
	);
}

function FyPicker({
	fy,
	fys,
	onChange,
}: {
	fy: string;
	fys: string[];
	onChange: (v: string) => void;
}) {
	return (
		<Select
			aria-label="Financial year"
			value={fy}
			onValueChange={onChange}
			options={fys.map((f) => ({ value: f, label: f }))}
			className="h-9 w-auto min-w-[8rem] rounded-md max-md:h-11 max-md:w-full max-md:rounded-xl"
		/>
	);
}

function TaxForm({ fy }: { fy: string }) {
	const qc = useQueryClient();
	const money = useMoney();
	const profile = useQuery(orpc.tax.get.queryOptions({ input: { fy } }));
	const suggest = useQuery(
		orpc.tax.suggestIncome.queryOptions({ input: { fy } }),
	);
	const hasRules = fy in TAX_YEARS;
	const compute = useQuery({
		...orpc.tax.compute.queryOptions({ input: { fy } }),
		enabled: hasRules,
	});
	// Only for the no-rules note: which year's rules the after-tax KPI falls back to meanwhile.
	const kpi = useQuery({
		...orpc.tax.getKpiConfig.queryOptions(),
		enabled: !hasRules,
	});
	const kpiRulesFy =
		!hasRules &&
		kpi.data?.source === "profile" &&
		kpi.data.currentFy === fy &&
		kpi.data.rulesFy !== fy
			? kpi.data.rulesFy
			: null;
	const upsert = useMutation(orpc.tax.upsert.mutationOptions());
	const finalize = useMutation(orpc.tax.finalize.mutationOptions());

	const [draft, setDraft] = useState<Draft>(EMPTY);
	const seeded = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	// Seed once, when both the stored profile and the ledger suggestion have loaded for this FY.
	useEffect(() => {
		if (seeded.current) return;
		if (profile.isLoading || suggest.isLoading) return;
		const p = profile.data;
		const s = suggest.data;
		const cg = (p?.capitalGains as Draft["capitalGains"] | null) ?? null;
		const d = (p?.deductions as Partial<Draft["deductions"]> | null) ?? null;
		const dd = (p?.deductions as { s80dd?: number } | null)?.s80dd ?? 0;
		setDraft({
			regimeChoice: (p?.regimeChoice as "old" | "new" | null) ?? null,
			salaryIncome: p?.salaryIncome ?? s?.salaryHint ?? 0,
			otherIncome: p?.otherIncome ?? s?.passive ?? 0,
			basicSalary: p?.basicSalary ?? 0,
			hraReceived: p?.hraReceived ?? 0,
			// pre-fill with the ledger rent; the user can overwrite it (stored as an override)
			rentPaid: p?.rentPaid ?? s?.rent ?? 0,
			metro: p?.metro ?? true,
			capitalGains: { ...EMPTY.capitalGains, ...(cg ?? {}) },
			deductions: {
				s80c: d?.s80c ?? 0,
				s80d: d?.s80d ?? 0,
				s80tta: d?.s80tta ?? 0,
			},
			s80ddOn: dd > 0,
		});
		seeded.current = true;
	}, [profile.isLoading, profile.data, suggest.isLoading, suggest.data]);

	function persist(next: Draft) {
		clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			upsert.mutate(
				{
					fy,
					regimeChoice: next.regimeChoice,
					salaryIncome: next.salaryIncome,
					otherIncome: next.otherIncome,
					basicSalary: next.basicSalary,
					hraReceived: next.hraReceived,
					rentPaid: next.rentPaid,
					metro: next.metro,
					capitalGains: next.capitalGains,
					deductions: {
						s80c: next.deductions.s80c,
						s80d: next.deductions.s80d,
						s80tta: next.deductions.s80tta,
						s80dd: next.s80ddOn ? 125_000 : 0,
					},
				},
				{ onSuccess: () => qc.invalidateQueries() },
			);
		}, 500);
	}

	function set<K extends keyof Draft>(key: K, value: Draft[K]) {
		setDraft((cur) => {
			const next = { ...cur, [key]: value };
			persist(next);
			return next;
		});
	}
	function setCg(key: keyof Draft["capitalGains"], value: number) {
		setDraft((cur) => {
			const next = {
				...cur,
				capitalGains: { ...cur.capitalGains, [key]: value },
			};
			persist(next);
			return next;
		});
	}
	function setDed(key: keyof Draft["deductions"], value: number) {
		setDraft((cur) => {
			const next = { ...cur, deductions: { ...cur.deductions, [key]: value } };
			persist(next);
			return next;
		});
	}

	const c = compute.data;
	const rent = suggest.data?.rent ?? 0;
	const isCurrent = suggest.data?.isCurrent ?? false;
	// months elapsed in the current FY (April = month 1) drive the annualised projection
	const fyMonth = ((new Date().getMonth() + 1 + 8) % 12) + 1;
	const projected =
		isCurrent && suggest.data
			? Math.round((suggest.data.passive * 12) / fyMonth)
			: null;

	return (
		<div className="flex flex-col gap-10 max-md:gap-6">
			<div className="grid gap-8 max-md:gap-6 lg:grid-cols-2">
				{/* ── Income ─────────────────────────────────────── */}
				<Section title="Income">
					<Field label="Salary / active income (gross)">
						<Num
							value={draft.salaryIncome}
							onChange={(v) => set("salaryIncome", v)}
						/>
						<Hint>
							Enter your real gross — the statement figure (
							{money.fmtc(suggest.data?.salaryHint ?? 0)}) is noisy.
						</Hint>
					</Field>
					<Field label="Other taxable income (interest, coupons, payouts)">
						<Num
							value={draft.otherIncome}
							onChange={(v) => set("otherIncome", v)}
						/>
						<Hint>
							Auto-summed from the ledger:{" "}
							{money.fmtc(suggest.data?.passive ?? 0)}
							{isCurrent && projected
								? ` · annualised ≈ ${money.fmtc(projected)}`
								: ""}
						</Hint>
					</Field>
					<SubLabel>Capital gains</SubLabel>
					<div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
						<Field label="Equity STCG (20%)">
							<Num
								value={draft.capitalGains.equityStcg}
								onChange={(v) => setCg("equityStcg", v)}
							/>
						</Field>
						<Field label="Equity LTCG (12.5%)">
							<Num
								value={draft.capitalGains.equityLtcg}
								onChange={(v) => setCg("equityLtcg", v)}
							/>
						</Field>
						<Field label="Crypto / VDA (30%)">
							<Num
								value={draft.capitalGains.crypto}
								onChange={(v) => setCg("crypto", v)}
							/>
						</Field>
						<Field label="Other LTCG (12.5%)">
							<Num
								value={draft.capitalGains.otherLtcg}
								onChange={(v) => setCg("otherLtcg", v)}
							/>
						</Field>
						<Field label="Other STCG (slab)">
							<Num
								value={draft.capitalGains.otherStcg}
								onChange={(v) => setCg("otherStcg", v)}
							/>
						</Field>
					</div>
				</Section>

				{/* ── Deductions (old regime) ────────────────────── */}
				<Section title="Deductions" subtitle="Old regime only">
					<div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
						<Field label="80C (max ₹1.5L)">
							<Num
								value={draft.deductions.s80c}
								onChange={(v) => setDed("s80c", v)}
							/>
						</Field>
						<Field label="80D (health)">
							<Num
								value={draft.deductions.s80d}
								onChange={(v) => setDed("s80d", v)}
							/>
						</Field>
						<Field label="80TTA (max ₹10k)">
							<Num
								value={draft.deductions.s80tta}
								onChange={(v) => setDed("s80tta", v)}
							/>
						</Field>
						<Field label="80DD — disabled dependent">
							<Toggle
								on={draft.s80ddOn}
								onToggle={() => set("s80ddOn", !draft.s80ddOn)}
								label={draft.s80ddOn ? "₹1.25L (severe)" : "Off"}
							/>
						</Field>
					</div>
					<div className="mt-2 flex flex-col gap-2 border-border border-t pt-3 max-md:mt-0 max-md:gap-3 max-md:pt-4">
						<span className="text-muted-foreground text-xs max-md:font-medium max-md:text-foreground max-md:text-sm">
							HRA — exemption {c ? money.fmtc(c.hraExemption) : "—"}
						</span>
						<div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
							<Field label="Basic salary">
								<Num
									value={draft.basicSalary}
									onChange={(v) => set("basicSalary", v)}
								/>
							</Field>
							<Field label="HRA received">
								<Num
									value={draft.hraReceived}
									onChange={(v) => set("hraReceived", v)}
								/>
							</Field>
							<Field label="Rent paid /yr">
								<Num
									value={draft.rentPaid}
									onChange={(v) => set("rentPaid", v)}
								/>
								<Hint>actual {money.fmtc(rent)}/yr from ledger</Hint>
							</Field>
						</div>
						<label className="flex items-center gap-2 text-sm max-md:min-h-11 max-md:gap-3">
							<input
								type="checkbox"
								checked={draft.metro}
								onChange={(e) => set("metro", e.target.checked)}
								className="size-4 accent-foreground max-md:size-5"
							/>
							Metro city (50% of basic; else 40%)
						</label>
					</div>
				</Section>
			</div>

			{/* ── Result ─────────────────────────────────────── */}
			{!hasRules && (
				<p className="rounded-xl border border-border border-dashed p-5 text-muted-foreground text-sm">
					The app doesn't have the tax rules for {fy} yet, so it can't compare
					the regimes for it. What you enter here is saved, and the comparison
					appears once the rules are added.
					{kpiRulesFy &&
						` Meanwhile the after-tax KPI uses ${kpiRulesFy} rules until ${fy} rules are added.`}
				</p>
			)}
			{c && (
				<section className="flex flex-col gap-4">
					<div className="grid gap-4 sm:grid-cols-2">
						<RegimeCard
							title="Old regime"
							r={c.old}
							recommended={c.recommended === "old"}
							saving={c.saving}
							fmt={money.fmt}
						/>
						<RegimeCard
							title="New regime"
							r={c.new}
							recommended={c.recommended === "new"}
							saving={c.saving}
							fmt={money.fmt}
						/>
					</div>
					<div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm max-md:flex-col max-md:items-stretch max-md:gap-y-3">
						<span className="text-muted-foreground">
							{c.breakeven == null
								? "New regime wins regardless of extra deductions."
								: c.breakeven === 0
									? "Old regime already wins."
									: `≈ ${money.fmt(c.breakeven)} more deduction and old wins.`}
						</span>
						<span className="text-muted-foreground">
							Equity-LTCG tax-free headroom left:{" "}
							<span className="font-medium text-foreground">
								{money.fmt(c.ltcgHeadroom)}
							</span>
						</span>
						<Button
							variant="outline"
							size="sm"
							className="ml-auto max-md:ml-0 max-md:min-h-11 max-md:w-full"
							onClick={() =>
								finalize.mutate(
									{ fy, regimeChoice: c.recommended },
									{
										onSuccess: () => {
											qc.invalidateQueries();
											toast.success(
												`${fy} finalised on the ${c.recommended} regime.`,
											);
										},
									},
								)
							}
						>
							Finalise {fy} ({c.recommended})
						</Button>
					</div>
				</section>
			)}
			{c && (
				<ResultBar
					recommended={c.recommended}
					saving={c.saving}
					oldTax={c.old.totalTax}
					newTax={c.new.totalTax}
					updating={upsert.isPending || compute.isFetching}
					fmt={money.fmt}
				/>
			)}
		</div>
	);
}

/**
 * The answer, pinned to the foot of the page on a phone, so it moves while you type instead of sitting
 * two screens below the field you're editing. Sticky inside the page's own scroll pane, so it rides above
 * the tab bar rather than fighting it, and comes to rest after the regime cards once you scroll to them.
 */
function ResultBar({
	recommended,
	saving,
	oldTax,
	newTax,
	updating,
	fmt,
}: {
	recommended: "old" | "new";
	saving: number;
	oldTax: number;
	newTax: number;
	updating: boolean;
	fmt: (inr: number) => string;
}) {
	const verdict =
		saving === 0
			? "Both regimes cost the same"
			: `${recommended === "new" ? "New" : "Old"} regime saves ${fmt(saving)}`;
	return (
		<div className="sticky bottom-0 z-10 -mx-4 -mt-4 px-4 pt-2 pb-3 md:hidden">
			<output
				aria-live="polite"
				className="flex items-center gap-3 rounded-2xl border border-[var(--covered)]/40 bg-card/95 px-4 py-3 shadow-[0_10px_30px_rgb(0_0_0/0.18)] backdrop-blur-xl"
			>
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="font-medium text-[var(--covered)] text-base">
						{verdict}
					</span>
					<span className="tnum truncate text-muted-foreground text-sm">
						Old {fmt(oldTax)} · New {fmt(newTax)}
					</span>
				</span>
				<span
					className={`text-muted-foreground text-xs transition-opacity ${updating ? "opacity-100" : "opacity-0"}`}
				>
					Updating…
				</span>
			</output>
		</div>
	);
}

function RegimeCard({
	title,
	r,
	recommended,
	saving,
	fmt,
}: {
	title: string;
	r: {
		grossIncome: number;
		ordinaryTaxable: number;
		slabTax: number;
		rebate: number;
		cgTax: number;
		surcharge: number;
		cess: number;
		totalTax: number;
	};
	recommended: boolean;
	saving: number;
	fmt: (inr: number) => string;
}) {
	return (
		<div
			className={`flex flex-col gap-2 rounded-xl border p-5 ${recommended ? "border-[var(--covered)] bg-[var(--covered)]/5" : "border-border"}`}
		>
			<div className="flex items-center justify-between">
				<h3 className="font-display font-medium text-lg">{title}</h3>
				{recommended && (
					<span className="rounded-full bg-[var(--covered)]/15 px-2 py-0.5 text-[var(--covered)] text-xs">
						Recommended · saves {fmt(saving)}
					</span>
				)}
			</div>
			<dl className="flex flex-col gap-1 text-sm">
				<Row label="Gross income" value={fmt(r.grossIncome)} />
				<Row label="Ordinary taxable" value={fmt(r.ordinaryTaxable)} />
				<Row label="Slab tax" value={fmt(r.slabTax)} />
				{r.rebate > 0 && (
					<Row label="− 87A rebate" value={`−${fmt(r.rebate)}`} />
				)}
				{r.cgTax > 0 && (
					<Row label="+ Capital-gains tax" value={fmt(r.cgTax)} />
				)}
				{r.surcharge > 0 && (
					<Row label="+ Surcharge" value={fmt(r.surcharge)} />
				)}
				<Row label="+ Cess (4%)" value={fmt(r.cess)} />
			</dl>
			<div className="mt-1 flex items-baseline justify-between border-border border-t pt-2">
				<span className="text-muted-foreground text-sm">Total tax</span>
				<span className="tnum font-display font-medium text-2xl">
					{fmt(r.totalTax)}
				</span>
			</div>
		</div>
	);
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="tnum">{value}</dd>
		</div>
	);
}

function Section({
	title,
	subtitle,
	children,
}: {
	title: string;
	subtitle?: string;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-4 max-md:gap-2">
			<div className="flex items-baseline justify-between border-border border-b-2 pb-2 max-md:border-b-0 max-md:px-1 max-md:pb-0">
				<h2 className="font-display font-medium text-xl">{title}</h2>
				{subtitle && (
					<span className="text-muted-foreground text-xs max-md:text-sm">
						{subtitle}
					</span>
				)}
			</div>
			{/* On a phone the fields sit in an inset card, the shape of a phone's own forms. */}
			<div className="flex flex-col gap-4 max-md:rounded-2xl max-md:border max-md:border-border max-md:bg-card max-md:p-4">
				{children}
			</div>
		</section>
	);
}

/** A heading inside a section's card, on a phone only: the desktop grid groups these by position. */
function SubLabel({ children }: { children: ReactNode }) {
	return (
		<span className="-mb-1 border-border border-t pt-4 font-medium text-sm md:hidden">
			{children}
		</span>
	);
}

/**
 * Label over field on desktop. On a phone, label left and field right on one line, like a phone's own
 * forms, so the card reads as a list of amounts; a hint runs the full width underneath.
 */
function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-1 max-md:grid max-md:grid-cols-[minmax(0,1fr)_9.5rem] max-md:items-center max-md:gap-x-3">
			<span className="text-muted-foreground text-xs max-md:text-foreground max-md:text-sm max-md:leading-snug">
				{label}
			</span>
			{children}
		</div>
	);
}

function Hint({ children }: { children: ReactNode }) {
	return (
		<span className="text-muted-foreground/80 text-xs max-md:col-span-2 md:text-[0.7rem]">
			{children}
		</span>
	);
}

/** "Next" on a phone keyboard walks to the following amount; on the last one it closes the keyboard. */
function focusNextAmount(from: HTMLInputElement) {
	const all = [
		...document.querySelectorAll<HTMLInputElement>("input[data-tax-amount]"),
	];
	const next = all[all.indexOf(from) + 1];
	if (next) next.focus();
	else from.blur();
}

function Num({
	value,
	onChange,
}: {
	value: number;
	onChange: (v: number) => void;
}) {
	return (
		<div className="relative flex flex-col">
			{/* Every figure on this page is a rupee amount; on a phone the field says so. */}
			<span
				aria-hidden="true"
				className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base text-muted-foreground md:hidden"
			>
				₹
			</span>
			<input
				type="number"
				inputMode="decimal"
				enterKeyHint="next"
				data-tax-amount=""
				value={value === 0 ? "" : value}
				placeholder="0"
				onChange={(e) => onChange(Number(e.target.value) || 0)}
				onKeyDown={(e) => {
					if (
						e.key !== "Enter" ||
						!window.matchMedia("(max-width: 767px)").matches
					)
						return;
					e.preventDefault();
					focusNextAmount(e.currentTarget);
				}}
				className="h-9 rounded-md border border-input bg-background px-3 text-foreground text-sm tabular-nums shadow-xs outline-none focus-visible:border-ring max-md:h-11 max-md:rounded-lg max-md:pl-7 max-md:text-right max-md:text-base"
			/>
		</div>
	);
}

function Toggle({
	on,
	onToggle,
	label,
}: {
	on: boolean;
	onToggle: () => void;
	label: string;
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			className={`h-9 rounded-md border px-3 text-sm transition-colors max-md:h-11 max-md:rounded-lg ${on ? "border-foreground bg-foreground text-background" : "border-input text-muted-foreground hover:bg-secondary"}`}
		>
			{label}
		</button>
	);
}
