/**
 * Reconciliation (ADR-0014, issue 008) — matches the **Plan**'s expected interest events against **actual**
 * statement credits, for one month. Pure functions over data the caller has already loaded (Plan from
 * SQLite, credits from DuckDB): no DB, no framework, no `ATTACH`. The KPI is untouched; this only reports
 * "did the interest I expect actually arrive?" and surfaces unmodelled income.
 *
 * v1 (decided 2026-07-19): month-level match · ±20% amount band · incoming interest only · surface +
 * prefill for unrecognised credits. Only `payout = cash` income holdings emit expected cash events —
 * `accrue` holdings never hit the bank.
 */

import { PERIODS_PER_YEAR } from "./plan";
import type { Cadence, IncomeClass, Investment } from "./types";

/** Amount tolerance: a platform credit within ±20% of expected counts as received (absorbs TDS, rounding). */
const BAND = 0.2;

/** Uncategorised credits above this are treated as salary/principal noise, not income suggestions (issue 001). */
const SUGGESTION_MAX = 50_000;

// ── inputs / outputs ──────────────────────────────────────────────────────────────────────────────────

/** A statement credit candidate (read read-only from the DuckDB actuals). Credits are positive INR. */
export interface StatementCredit {
	txnId: string;
	/** YYYY-MM-DD */
	date: string;
	narration: string;
	/** signed INR from the statement; a credit is positive */
	amount: number;
	/** YYYY-MM */
	month: string;
	/** primary-split kind assigned by the rules engine (ADR-0012), if any */
	kind?: string | null;
	categoryKey?: string | null;
}

/** An interest payout the Plan expects in a given month (the lump for the cadence, e.g. 3× monthly quarterly). */
export interface ExpectedEvent {
	investmentId: string;
	name: string;
	platform?: string;
	group?: string;
	/** INR expected this month for this cadence */
	expectedAmount: number;
	cadence: Cadence;
	incomeClass: IncomeClass;
}

export type ReconcileStatus = "received" | "differs" | "pending" | "missed";

/** An expected event paired with its best-matching credit (if any) and a status. */
export interface ReconciledEvent extends ExpectedEvent {
	status: ReconcileStatus;
	/** the matched statement credit, when received/differs */
	matched?: StatementCredit;
	/** actual − expected (INR), when matched */
	delta?: number;
}

/** An unmatched income-looking credit → a prompt to enrich the Plan (prefilled investment form). */
export interface ReconcileSuggestion {
	txnId: string;
	date: string;
	narration: string;
	amount: number;
	/** best-guess provider token pulled from the narration, to prefill `platform` */
	platformGuess?: string;
}

export interface ReconcileSummary {
	month: string;
	expectedCount: number;
	receivedCount: number;
	differsCount: number;
	pendingCount: number;
	missedCount: number;
	/** Σ expected across events */
	expectedAmount: number;
	/** Σ matched actual across received + differs */
	actualAmount: number;
}

export interface ReconcileResult {
	month: string;
	events: ReconciledEvent[];
	suggestions: ReconcileSuggestion[];
	summary: ReconcileSummary;
}

// ── month arithmetic ──────────────────────────────────────────────────────────────────────────────────

/** Absolute month index (year*12 + month0) for cadence stepping. */
function ymOrdinal(year: number, month1to12: number): number {
	return year * 12 + (month1to12 - 1);
}

/** "YYYY-MM" or "YYYY-MM-DD…" → month ordinal; null if unparseable. */
function monthOrdinal(value: string | undefined): number | null {
	if (!value) return null;
	const m = /^(\d{4})-(\d{2})/.exec(value);
	return m ? ymOrdinal(Number(m[1]), Number(m[2])) : null;
}

/**
 * Raw expected monthly interest (INR), independent of the current `status` gate in `plan.ts` — so a
 * now-matured holding still reports the coupons it paid in past months. Resolution: explicit
 * `expectedMonthlyInterest` → `principal × annualRate ÷ 12` → 0.
 */
function rawMonthlyInterest(inv: Investment): number {
	if (inv.expectedMonthlyInterest != null) return inv.expectedMonthlyInterest;
	if (inv.principal != null && inv.annualRate != null) {
		return (inv.principal * inv.annualRate) / 12;
	}
	return 0;
}

const ANCHORED: Partial<Record<Cadence, number>> = {
	quarterly: 3,
	half_yearly: 6,
	yearly: 12,
};

/**
 * The interest events the Plan expects to hit the bank in `month` ("YYYY-MM"). Only live, `income`-class,
 * `payout = cash` holdings with a periodic cadence emit. Firing months are anchored on `startDate`; an
 * anchored cadence (quarterly/…) without a `startDate` can't be placed and is skipped.
 */
export function expectedInterestEvents(
	investments: Investment[],
	month: string,
): ExpectedEvent[] {
	const target = monthOrdinal(month);
	if (target == null) return [];
	const events: ExpectedEvent[] = [];

	for (const inv of investments) {
		if (inv.active === false) continue;
		if (inv.incomeClass !== "income") continue;
		if (inv.payout !== "cash") continue;
		const cadence = inv.interestCadence;
		if (!cadence) continue;
		const ppy = PERIODS_PER_YEAR[cadence];
		if (!ppy) continue; // maturity/none → no periodic cash event

		// live *during this month*: started on/before it, not matured before it (date-based, not today).
		const start = monthOrdinal(inv.startDate);
		if (start != null && start > target) continue;
		const matured = monthOrdinal(inv.maturityDate);
		if (matured != null && matured < target) continue;

		const monthly = rawMonthlyInterest(inv);
		if (monthly <= 0) continue;

		const period = ANCHORED[cadence];
		if (period != null) {
			if (start == null) continue; // can't place the lump without an anchor
			if ((target - start) % period !== 0) continue; // not a firing month
		}

		events.push({
			investmentId: inv.id,
			name: inv.name,
			platform: inv.platform,
			group: inv.group,
			expectedAmount: monthly * (12 / ppy),
			cadence,
			incomeClass: inv.incomeClass,
		});
	}
	return events;
}

// ── name matching / suggestion heuristics ─────────────────────────────────────────────────────────────

const PLATFORM_STOPWORDS = new Set([
	"wealth",
	"capital",
	"technologies",
	"technology",
	"finance",
	"fintech",
	"financial",
	"private",
	"limited",
	"ltd",
	"india",
	"services",
	"invest",
	"the",
	"and",
]);

/** Distinctive lowercase tokens of a platform label ("Wint Wealth" → ["wint"]). */
function platformTokens(platform: string): string[] {
	return platform
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length >= 3 && !PLATFORM_STOPWORDS.has(t));
}

/** Whether a statement narration plausibly names the platform (any distinctive token appears). */
function narrationMatchesPlatform(
	narration: string,
	platform: string,
): boolean {
	const n = narration.toLowerCase();
	const tokens = platformTokens(platform);
	if (tokens.length === 0) return n.includes(platform.toLowerCase());
	return tokens.some((t) => n.includes(t));
}

const NARRATION_NOISE = new Set([
	"transfer",
	"credit",
	"payment",
	"interest",
	"from",
	"neft",
	"imps",
	"upi",
	"ach",
	"achcr",
	"ref",
	"account",
	"deposit",
	"the",
	"and",
]);

/** A prefill hint for `platform`: the longest distinctive alphabetic token in the narration, title-cased. */
function guessPlatform(narration: string): string | undefined {
	const tokens = narration
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length >= 4 && !NARRATION_NOISE.has(t) && !/^\d+$/.test(t))
		.sort((a, b) => b.length - a.length);
	const pick = tokens[0];
	return pick ? pick.charAt(0).toUpperCase() + pick.slice(1) : undefined;
}

/** Whether an unmatched credit should be offered as an "add to plan?" suggestion. */
function isSuggestionCandidate(c: StatementCredit): boolean {
	const kind = c.kind ?? "uncategorized";
	if (
		kind === "active_income" ||
		kind === "transfer" ||
		kind === "expense" ||
		kind === "investment"
	) {
		return false;
	}
	if (kind === "passive_income") return true; // trusted income tag, any size
	// uncategorised → income-ish only when not salary/principal-sized (until a salary rule lands, issue 001)
	return c.amount > 0 && c.amount <= SUGGESTION_MAX;
}

// ── the match ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Reconcile one month. Each expected event claims the closest same-platform credit; within ±20% ⇒
 * `received`, outside ⇒ `differs`. Unclaimed events are `pending` (target month not yet elapsed per
 * `today`) or `missed`. Remaining income-looking credits become suggestions. A credit matches at most
 * one event.
 */
export function reconcile(input: {
	investments: Investment[];
	credits: StatementCredit[];
	month: string;
	/** YYYY-MM-DD server clock; distinguishes pending (current/future month) from missed (elapsed) */
	today?: string;
}): ReconcileResult {
	const { month, today } = input;
	const events = expectedInterestEvents(input.investments, month);
	const credits = input.credits.filter((c) => c.amount > 0);

	const targetOrd = monthOrdinal(month);
	const todayOrd = monthOrdinal(today);
	const monthElapsed =
		todayOrd != null && targetOrd != null ? todayOrd > targetOrd : true;

	const used = new Set<string>();
	const reconciled: ReconciledEvent[] = [];

	for (const ev of events) {
		let best: { credit: StatementCredit; distance: number } | undefined;
		if (ev.platform) {
			for (const c of credits) {
				if (used.has(c.txnId)) continue;
				if (!narrationMatchesPlatform(c.narration, ev.platform)) continue;
				const distance = Math.abs(c.amount - ev.expectedAmount);
				if (!best || distance < best.distance) best = { credit: c, distance };
			}
		}
		if (best) {
			used.add(best.credit.txnId);
			const within = best.distance <= ev.expectedAmount * BAND;
			reconciled.push({
				...ev,
				status: within ? "received" : "differs",
				matched: best.credit,
				delta: best.credit.amount - ev.expectedAmount,
			});
		} else {
			reconciled.push({ ...ev, status: monthElapsed ? "missed" : "pending" });
		}
	}

	const suggestions: ReconcileSuggestion[] = credits
		.filter((c) => !used.has(c.txnId) && isSuggestionCandidate(c))
		.map((c) => ({
			txnId: c.txnId,
			date: c.date,
			narration: c.narration,
			amount: c.amount,
			platformGuess: guessPlatform(c.narration),
		}))
		.sort((a, b) => b.amount - a.amount);

	const by = (s: ReconcileStatus) =>
		reconciled.filter((e) => e.status === s).length;
	const summary: ReconcileSummary = {
		month,
		expectedCount: reconciled.length,
		receivedCount: by("received"),
		differsCount: by("differs"),
		pendingCount: by("pending"),
		missedCount: by("missed"),
		expectedAmount: reconciled.reduce((s, e) => s + e.expectedAmount, 0),
		actualAmount: reconciled.reduce((s, e) => s + (e.matched?.amount ?? 0), 0),
	};

	return { month, events: reconciled, suggestions, summary };
}
