import type { Kind } from "@money/shared";

/**
 * The generic narration→assignment ruleset a newly provisioned user's `app.db` starts with
 * (spec `docs/superpowers/specs/2026-07-21-default-tagging-rules-design.md`). Seeded only when the
 * `rules` table is empty, so existing accounts are never re-tagged behind the user's back.
 *
 * This is deliberately NOT the owner's SBI-mined `SEED_RULES` (`@money/analytics`), which anchors on
 * personal counterparties (Wint issuers, EMPLOYER payroll, SustVest borrowers). What lives here is
 * bank-mechanics + mass-market Indian merchants: patterns any Indian current/savings statement produces.
 *
 * Matching happens in `buildSplits()` (`@money/analytics/rebuild`): one rule per transaction, chosen by
 * `priority ASC, id ASC`, filtered by signed-amount bounds. Two properties of that SQL shape this file:
 *
 *  1. Substring matching is `ILIKE '%pattern%'` — case-insensitive but NOT word-bounded, so short tokens
 *     are landmines (`'SOLAR PAYOUT' ILIKE '%OLA%'` is true). Those patterns use regex instead.
 *  2. Regex matching is case-SENSITIVE (DuckDB/RE2 `regexp_matches`), so every regex pattern must carry
 *     an explicit `(?i)` — without it the rule silently never fires on lowercase narrations. That flag
 *     is what {@link matchTypeFor} keys on, which makes it impossible to add a regex rule without it.
 */

export type SeedRuleRow = {
	priority: number;
	matchType: "substring" | "regex";
	pattern: string;
	assignKind: Kind;
	assignCategoryKey: string;
	minAmount?: number;
	maxAmount?: number;
};

/**
 * Priority bands (lower wins; `id ASC` breaks ties). The ordering constraints that actually matter:
 * card bills must beat the UPI catch-all (card bills ARE UPI debits), merchant rules must beat it too,
 * and a handful of merchants must beat their own parent token (`INSTAMART` before `SWIGGY`).
 */
const BAND = {
	/** Internal moves that must never read as income or expense. */
	structural: 10,
	/**
	 * Above `investment` on purpose: a tax or fee row routinely names the instrument it relates to
	 * ("TDS DEDUCTED ON TERM DEPOSIT INT"), and the tax/fee token is the more specific signal. Below
	 * `investment` these rows book as asset moves instead of expenses.
	 */
	feesTax: 12,
	/** Asset moves — excluded from the KPI entirely. */
	investment: 15,
	/** Salary / rent: identity flows. */
	identity: 20,
	/** KPI numerator. */
	passiveIncome: 30,
	/** Beats `catchAll` — these are UPI debits too. */
	cardBill: 40,
	/** Cash out is a spend proxy, not a fee — kept apart from the `feesTax` band. */
	cashWithdrawal: 50,
	/** Merchants that must outrank their own parent token. */
	merchantException: 55,
	merchant: 60,
	catchAll: 100,
} as const;

/** Signed-amount bound: credits are `+`, debits are `−`. This is what carries the debit/credit split. */
type Bound = "debit" | "credit" | "any";

function boundsFor(bound: Bound): Pick<SeedRuleRow, "minAmount" | "maxAmount"> {
	if (bound === "debit") return { maxAmount: 0 };
	if (bound === "credit") return { minAmount: 0 };
	return {};
}

/** A pattern is a regex iff it opens with the mandatory case-insensitivity flag (see the file header). */
function matchTypeFor(pattern: string): "substring" | "regex" {
	return pattern.startsWith("(?i)") ? "regex" : "substring";
}

function rules(
	priority: number,
	assignKind: Kind,
	assignCategoryKey: string,
	bound: Bound,
	patterns: string[],
): SeedRuleRow[] {
	return patterns.map((pattern) => ({
		priority,
		matchType: matchTypeFor(pattern),
		pattern,
		assignKind,
		assignCategoryKey,
		...boundsFor(bound),
	}));
}

/** Debit-only expense rules — the shape almost every merchant rule takes. */
const spend = (
	priority: number,
	categoryKey: string,
	patterns: string[],
): SeedRuleRow[] => rules(priority, "expense", categoryKey, "debit", patterns);

/**
 * Credit-card bill payments leaving the account, booked as `card_bill` (the consolidated spend proxy,
 * ADR-0013). Card-app handles and issuer tokens only — never a bare `CRED`, which matches "CREDITED".
 * `CARD PAYMENT` is likewise excluded: it also matches debit-card POS, mislabelling ordinary spend.
 */
const CARD_BILL_PATTERNS = [
	"CREDIT CARD",
	"CC PAYMENT",
	"CCPAY",
	"SBICARD",
	"CRED CCBP",
	"cred.club",
	"cheqccb",
	"OneCard",
	"SLICE SM",
];

export const GENERIC_SEED_RULES: SeedRuleRow[] = [
	// ── structural: internal moves ──────────────────────────────────────────────────────────────────
	// One `SWEEP` token covers SBI's `SWEEP TRF` credit AND `SWEEP TFR DR` debit — the sign disambiguates,
	// so this is bank-agnostic where a token-based ruleset needs one rule per bank's spelling.
	...rules(BAND.structural, "transfer", "sweep_in", "credit", ["SWEEP"]),
	...rules(BAND.structural, "transfer", "sweep_out", "debit", ["SWEEP"]),
	// Principal coming back is a return of capital, not income.
	...rules(BAND.structural, "transfer", "investment_redemption", "credit", [
		"MATURITY",
	]),

	// ── investments ─────────────────────────────────────────────────────────────────────────────────
	// `BSE STAR MF` is the settlement rail most MF platforms debit through, so it catches SIPs whose
	// narration never names the platform. `\bSIP\b` needs the boundary (bare `SIP` matches `SIPCOT`).
	...rules(BAND.investment, "investment", "sip", "debit", [
		"BSE STAR MF",
		"(?i)\\bSIP\\b",
		"GROWW",
	]),
	...rules(BAND.investment, "investment", "stock_buy", "debit", ["ZERODHA"]),
	...rules(BAND.investment, "investment", "investment_generic", "debit", [
		"UPSTOX",
		"KUVERA",
	]),
	...rules(BAND.investment, "investment", "ppf_contribution", "debit", [
		"(?i)\\bPPF\\b",
	]),
	...rules(BAND.investment, "investment", "fd_deposit", "debit", [
		"TERM DEPOSIT",
	]),
	...rules(BAND.investment, "transfer", "investment_redemption", "credit", [
		"TERM DEPOSIT",
	]),

	// ── identity flows ──────────────────────────────────────────────────────────────────────────────
	// Credit-bound: an unbounded `SALARY` books a `SALARY ACCOUNT AMB CHARGES` debit as negative income.
	...rules(BAND.identity, "active_income", "salary", "credit", ["SALARY"]),
	// Word-bounded because `RENT` is a substring of `CURRENT` — without `\b`, every `CURRENT ACCOUNT`
	// row books as rent, and the credit side would push current-account credits into the KPI numerator.
	...rules(BAND.identity, "expense", "rent", "debit", ["(?i)\\bRENT\\b"]),
	...rules(BAND.identity, "passive_income", "rent_received", "credit", [
		"(?i)\\bRENT\\b",
	]),

	// ── passive income (KPI numerator) ──────────────────────────────────────────────────────────────
	...rules(BAND.passiveIncome, "passive_income", "savings_interest", "credit", [
		"INTEREST",
	]),
	...rules(BAND.passiveIncome, "passive_income", "dividend", "credit", [
		"DIVIDEND",
	]),

	// ── credit-card bills ───────────────────────────────────────────────────────────────────────────
	...spend(BAND.cardBill, "card_bill", CARD_BILL_PATTERNS),

	// ── fees, charges, tax ──────────────────────────────────────────────────────────────────────────
	// `\bCHRG` deliberately has no trailing boundary so it also catches `CHRGS`. `\bGST\b` and `\bTDS\b`
	// are too short to be safe as substrings.
	...spend(BAND.feesTax, "fees_charges", [
		"CHARGES",
		"(?i)\\bCHRG",
		"ANNUAL FEE",
		"(?i)\\bGST\\b",
	]),
	...spend(BAND.feesTax, "tax_paid", ["(?i)\\bTDS\\b", "INCOME TAX"]),
	// Debit-bound so a cash deposit at a CDM doesn't book as a withdrawal; word-bounded so the 3-letter
	// token can't match inside a merchant name.
	...spend(BAND.cashWithdrawal, "misc_expense", ["(?i)\\bATM\\b"]),

	// ── merchants ───────────────────────────────────────────────────────────────────────────────────
	// These two must outrank their own parent tokens (`SWIGGY`, `\bJIO\b`) or they'd never fire.
	...spend(BAND.merchantException, "groceries", ["INSTAMART", "JIOMART"]),
	...spend(BAND.merchant, "food_dining", ["SWIGGY", "ZOMATO"]),
	...spend(BAND.merchant, "groceries", [
		"BLINKIT",
		"ZEPTO",
		"BIGBASKET",
		"DMART",
	]),
	...spend(BAND.merchant, "shopping", [
		"AMAZON",
		"FLIPKART",
		"MYNTRA",
		"AJIO",
		"NYKAA",
	]),
	// `\bOLA\b` must be word-bounded: `%OLA%` matches SOLAR, CHOCOLATE, TOLA…
	...spend(BAND.merchant, "transport", [
		"UBER",
		"(?i)\\bOLA\\b",
		"RAPIDO",
		"IRCTC",
		"FASTAG",
		"IOCL",
		"HPCL",
	]),
	// `\bJIO\b` must be word-bounded so it doesn't steal JIOMART from groceries.
	...spend(BAND.merchant, "utilities", [
		"(?i)\\bJIO\\b",
		"AIRTEL",
		"VODAFONE",
		"ELECTRICITY",
		"BESCOM",
		"TATA POWER",
		"BBPS",
	]),
	// `GOOGLE PLAY`, never a bare `GOOGLE` — Google Pay is the PSP on a large share of UPI narrations.
	...spend(BAND.merchant, "subscription", [
		"NETFLIX",
		"SPOTIFY",
		"HOTSTAR",
		"GOOGLE PLAY",
		"APPLE.COM",
	]),
	...spend(BAND.merchant, "health", ["APOLLO", "PHARMEASY", "(?i)\\b1MG\\b"]),
	// `LIC OF INDIA`, never a bare `LIC` — it's a substring of PUBLIC, POLICE, LICENSE.
	...spend(BAND.merchant, "insurance_premium", [
		"LIC OF INDIA",
		"POLICYBAZAAR",
	]),

	// ── catch-all ───────────────────────────────────────────────────────────────────────────────────
	// A UPI debit is a spend; a UPI credit is ambiguous, so it stays neutral (`transfer`). Leaving the
	// credit side unbounded would book it as a positive-amount expense, which SUBTRACTS from monthly
	// expenses in `v_monthly_kpi` and inflates the coverage ratio.
	...spend(BAND.catchAll, "upi_merchant", ["UPI"]),
	...rules(BAND.catchAll, "transfer", "self_transfer", "credit", ["UPI"]),
];
