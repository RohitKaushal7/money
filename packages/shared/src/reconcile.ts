/**
 * Reconciliation (ADR-0014, issue 008) — matches the **Plan**'s expected interest events against **actual**
 * statement credits, for one month. Pure functions over data the caller has already loaded (Plan from
 * SQLite, credits from DuckDB): no DB, no framework, no `ATTACH`. The KPI is untouched; this only reports
 * "did the interest I expect actually arrive?" and surfaces unmodelled income.
 *
 * v1 (decided 2026-07-19): month-level match · ±20% amount band · incoming interest only · surface +
 * prefill for unrecognised credits. Only `payout = cash` income holdings emit expected cash events —
 * `accrue` holdings never hit the bank.
 *
 * Matching is by **category**, not narration name: the statement never names the platform (SustVest arrives
 * as YESB/YESIG borrower rows, Wint as issuer names), but issue 001's rules tag each credit's `category_key`
 * (p2p_payout ⇒ SustVest, bond_coupon ⇒ Wint, fd_interest ⇒ FDs, …). Each plan group/holding derives its
 * expected category from its asset `type` and claims that category's credits for the month. (Limitation: two
 * income groups of the same asset class would contend for one category — fine for the current portfolio;
 * refine with a per-group signature or a split-level platform tag when that arises.)
 */

import { PERIODS_PER_YEAR } from "./plan";
import type { Cadence, IncomeClass, Investment, InvestmentType } from "./types";

/** Amount tolerance: actual within ±20% of expected counts as received (absorbs TDS, rounding, drift). */
const BAND = 0.2;

/** Uncategorised credits above this are treated as salary/principal noise, not income suggestions (issue 001). */
const SUGGESTION_MAX = 50_000;

/** Asset type → the statement `category_key` its cash interest lands under (issue 001 taxonomy). */
const INCOME_CATEGORY: Partial<Record<InvestmentType, string>> = {
	p2p: "p2p_payout",
	bond: "bond_coupon",
	ncd: "bond_coupon",
	fd: "fd_interest",
	savings: "savings_interest",
};

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
	/** primary-split category_key — the reconciliation match key */
	categoryKey?: string | null;
}

/**
 * An interest payout the Plan expects in a given month — one per grouped holding-set (SustVest's tranches
 * roll into one), or per standalone holding. `expectedAmount` is the cadence lump (e.g. 3× monthly quarterly).
 */
export interface ExpectedEvent {
	/** `group:<name>` for a rollup, else the holding id */
	key: string;
	name: string;
	platform?: string;
	group?: string;
	/** the statement category this event's credits should carry */
	expectedCategory?: string;
	/** INR expected this month */
	expectedAmount: number;
	cadence: Cadence;
	incomeClass: IncomeClass;
	/** how many holdings rolled into this event */
	memberCount: number;
}

export type ReconcileStatus = "received" | "differs" | "pending" | "missed";

/** An expected event with the credits it claimed and a status. */
export interface ReconciledEvent extends ExpectedEvent {
	status: ReconcileStatus;
	/** statement credits claimed by this event (summed into actualAmount) */
	matches: StatementCredit[];
	/** Σ matched credit amount (INR); 0 when none */
	actualAmount: number;
	/** actualAmount − expectedAmount (INR) */
	delta: number;
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
	/** Σ matched actual across all events */
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

/** A holding that fires a cash interest event in the target month, with its lump amount. */
interface Fire {
	inv: Investment;
	amount: number;
}

/** Does this income/cash holding fire an interest event in month `target` (ordinal)? Returns the lump, or null. */
function fireAmount(inv: Investment, target: number): number | null {
	if (inv.active === false) return null;
	if (inv.incomeClass !== "income") return null;
	if (inv.payout !== "cash") return null;
	// The Plan form doesn't capture cadence yet → an unset cadence means "monthly" (the common case).
	const cadence = inv.interestCadence ?? "monthly";
	const ppy = PERIODS_PER_YEAR[cadence];
	if (!ppy) return null; // maturity/none → no periodic cash event

	// live *during this month*: started on/before it, not matured before it (date-based, not today).
	const start = monthOrdinal(inv.startDate);
	if (start != null && start > target) return null;
	const matured = monthOrdinal(inv.maturityDate);
	if (matured != null && matured < target) return null;

	const monthly = rawMonthlyInterest(inv);
	if (monthly <= 0) return null;

	const period = ANCHORED[cadence];
	if (period != null) {
		if (start == null) return null; // can't place the lump without an anchor
		if ((target - start) % period !== 0) return null; // not a firing month
	}
	return monthly * (12 / ppy);
}

/**
 * The interest events the Plan expects to hit the bank in `month` ("YYYY-MM"). Grouped holdings roll into a
 * single event (they pay as one platform's credits); standalone holdings stand alone. Each event carries the
 * statement category its credits should match.
 */
export function expectedInterestEvents(
	investments: Investment[],
	month: string,
): ExpectedEvent[] {
	const target = monthOrdinal(month);
	if (target == null) return [];

	const byGroup = new Map<string, Fire[]>();
	const standalone: Fire[] = [];
	for (const inv of investments) {
		const amount = fireAmount(inv, target);
		if (amount == null) continue;
		if (inv.group) {
			const arr = byGroup.get(inv.group) ?? [];
			arr.push({ inv, amount });
			byGroup.set(inv.group, arr);
		} else {
			standalone.push({ inv, amount });
		}
	}

	const events: ExpectedEvent[] = [];
	for (const [group, members] of byGroup) {
		const head = members[0]?.inv;
		if (!head) continue;
		events.push({
			key: `group:${group}`,
			name: group,
			platform: head.platform,
			group,
			expectedCategory: INCOME_CATEGORY[head.type],
			expectedAmount: members.reduce((s, m) => s + m.amount, 0),
			cadence: head.interestCadence ?? "monthly",
			incomeClass: "income",
			memberCount: members.length,
		});
	}
	for (const { inv, amount } of standalone) {
		events.push({
			key: inv.id,
			name: inv.name,
			platform: inv.platform,
			group: undefined,
			expectedCategory: INCOME_CATEGORY[inv.type],
			expectedAmount: amount,
			cadence: inv.interestCadence ?? "monthly",
			incomeClass: "income",
			memberCount: 1,
		});
	}
	return events;
}

// ── suggestion heuristics ─────────────────────────────────────────────────────────────────────────────

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
	// SBI statement furniture common to every row — never the provider
	"chatrokhari",
	"rohit",
	"kumar",
	"dep",
	"tfr",
	"cmpift",
	"cms",
	"wdl",
	"within",
	"bank",
	"pay",
]);

/** A prefill hint for `platform`: the longest pure-alphabetic token in the narration, title-cased. */
function guessPlatform(narration: string): string | undefined {
	const tokens = narration
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length >= 4 && !NARRATION_NOISE.has(t) && !/\d/.test(t))
		.sort((a, b) => b.length - a.length);
	const pick = tokens[0];
	return pick ? pick.charAt(0).toUpperCase() + pick.slice(1) : undefined;
}

/**
 * Whether an unclaimed credit should be offered as an "add to plan?" suggestion. Explicit passive income the
 * plan didn't claim always qualifies; otherwise only genuinely-uncategorised credits below the salary/
 * principal-size cutoff (classified salary/expense/transfer/sweep/investment are excluded).
 */
function isSuggestionCandidate(c: StatementCredit): boolean {
	if (c.kind === "passive_income") return true;
	const cat = c.categoryKey ?? "uncategorized";
	if (cat === "uncategorized")
		return c.amount > 0 && c.amount <= SUGGESTION_MAX;
	return false;
}

// ── the match ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Reconcile one month. Each expected event claims all unclaimed credits of its `expectedCategory` and
 * compares the sum to expected: within ±20% ⇒ `received`, otherwise ⇒ `differs`. Events with no matching
 * credit are `pending` (target month not yet elapsed per `today`) or `missed`. Remaining income-looking
 * credits become suggestions. A credit is claimed by at most one event.
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
		const matches = ev.expectedCategory
			? credits.filter(
					(c) => !used.has(c.txnId) && c.categoryKey === ev.expectedCategory,
				)
			: [];
		const actualAmount = matches.reduce((s, c) => s + c.amount, 0);
		if (matches.length > 0) {
			for (const c of matches) used.add(c.txnId);
			const within =
				Math.abs(actualAmount - ev.expectedAmount) <= ev.expectedAmount * BAND;
			reconciled.push({
				...ev,
				status: within ? "received" : "differs",
				matches,
				actualAmount,
				delta: actualAmount - ev.expectedAmount,
			});
		} else {
			reconciled.push({
				...ev,
				status: monthElapsed ? "missed" : "pending",
				matches: [],
				actualAmount: 0,
				delta: -ev.expectedAmount,
			});
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
		actualAmount: reconciled.reduce((s, e) => s + e.actualAmount, 0),
	};

	return { month, events: reconciled, suggestions, summary };
}
