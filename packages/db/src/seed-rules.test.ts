import { describe, expect, test } from "bun:test";
import { CATEGORY_BY_KEY } from "@money/shared";

import { GENERIC_SEED_RULES, type SeedRuleRow } from "./seed-rules";

/**
 * `pickRule` is a deliberate TypeScript reimplementation of the rule-matching SQL in
 * `buildSplits()` (`packages/analytics/src/rebuild.ts`). It exists so the ordering fixtures below can
 * assert priority interactions without standing up DuckDB.
 *
 * It CAN drift from the SQL. If you change the join in `buildSplits()`, change this too.
 *
 * The SQL, for reference:
 *   ON ((match_type = 'substring' AND narration ILIKE '%' || pattern || '%')
 *    OR (match_type = 'regex'     AND regexp_matches(narration, pattern)))
 *   AND (min_amount IS NULL OR amount >= min_amount)
 *   AND (max_amount IS NULL OR amount <= max_amount)
 *   -- row_number() OVER (PARTITION BY txn_id ORDER BY priority ASC, id ASC) = 1
 */
/**
 * DuckDB uses RE2, which supports an inline `(?i)` flag; JavaScript's RegExp does not and throws on it.
 * Translate the prefix into the equivalent `i` flag so the mirror below matches what the SQL would do.
 */
function toJsRegExp(pattern: string): RegExp {
	return pattern.startsWith("(?i)")
		? new RegExp(pattern.slice(4), "i")
		: new RegExp(pattern);
}

function pickRule(narration: string, amount: number): SeedRuleRow | undefined {
	return GENERIC_SEED_RULES.map((rule, id) => ({ rule, id }))
		.filter(({ rule }) => {
			const matches =
				rule.matchType === "substring"
					? // ILIKE '%p%' — case-insensitive substring, no word boundary
						narration.toLowerCase().includes(rule.pattern.toLowerCase())
					: // regexp_matches() is a partial match, and case-SENSITIVE unless the pattern says otherwise
						toJsRegExp(rule.pattern).test(narration);
			if (!matches) return false;
			if (rule.minAmount !== undefined && amount < rule.minAmount) return false;
			if (rule.maxAmount !== undefined && amount > rule.maxAmount) return false;
			return true;
		})
		.sort((a, b) => a.rule.priority - b.rule.priority || a.id - b.id)[0]?.rule;
}

describe("GENERIC_SEED_RULES integrity", () => {
	test("every assigned category exists in the shared taxonomy", () => {
		const unknown = GENERIC_SEED_RULES.filter(
			(r) => !CATEGORY_BY_KEY.has(r.assignCategoryKey),
		).map((r) => `${r.pattern} -> ${r.assignCategoryKey}`);
		expect(unknown).toEqual([]);
	});

	test("every assigned kind matches its category's declared kind", () => {
		const mismatched = GENERIC_SEED_RULES.filter((r) => {
			const category = CATEGORY_BY_KEY.get(r.assignCategoryKey);
			return category !== undefined && category.kind !== r.assignKind;
		}).map(
			(r) =>
				`${r.pattern}: rule says ${r.assignKind}, ${r.assignCategoryKey} is ${CATEGORY_BY_KEY.get(r.assignCategoryKey)?.kind}`,
		);
		expect(mismatched).toEqual([]);
	});

	test("no duplicate (pattern, minAmount, maxAmount) triples", () => {
		const seen = new Set<string>();
		const duplicates: string[] = [];
		for (const r of GENERIC_SEED_RULES) {
			const key = `${r.pattern}|${r.minAmount ?? ""}|${r.maxAmount ?? ""}`;
			if (seen.has(key)) duplicates.push(key);
			seen.add(key);
		}
		expect(duplicates).toEqual([]);
	});

	test("every rule carries a signed-amount bound", () => {
		// An unbounded rule tags credits and debits alike. That is what made the shipped `UPI` rule book
		// UPI credits as positive-amount expenses, which SUBTRACT from expenses in v_monthly_kpi.
		const unbounded = GENERIC_SEED_RULES.filter(
			(r) => r.minAmount === undefined && r.maxAmount === undefined,
		).map((r) => r.pattern);
		expect(unbounded).toEqual([]);
	});
});

describe("regex hygiene", () => {
	const regexRules = GENERIC_SEED_RULES.filter((r) => r.matchType === "regex");

	test("there are regex rules to check", () => {
		expect(regexRules.length).toBeGreaterThan(0);
	});

	test("every regex pattern compiles", () => {
		for (const r of regexRules) {
			expect(() => toJsRegExp(r.pattern)).not.toThrow();
		}
	});

	test("every regex pattern is case-insensitive", () => {
		// DuckDB's regexp_matches is case-SENSITIVE; a pattern without (?i) silently never fires on a
		// lowercase narration. matchTypeFor() keys on this prefix, so this also pins that contract.
		const uncased = regexRules
			.filter((r) => !r.pattern.startsWith("(?i)"))
			.map((r) => r.pattern);
		expect(uncased).toEqual([]);
	});

	test("no substring rule is a bare short token", () => {
		// Short substrings are the known landmine class (%OLA% matches SOLAR). Anything under 4 chars
		// must go through a word-bounded regex instead — except the catch-all below.
		//
		// `UPI` is exempt deliberately: it is the lowest-priority fallback, so an over-match still lands
		// in the category the row would have defaulted to anyway, while `\bUPI\b` would LOSE coverage on
		// any bank that concatenates the token into its reference string.
		const allowedShortSubstrings = new Set(["UPI"]);
		const tooShort = GENERIC_SEED_RULES.filter(
			(r) =>
				r.matchType === "substring" &&
				r.pattern.length < 4 &&
				!allowedShortSubstrings.has(r.pattern),
		).map((r) => r.pattern);
		expect(tooShort).toEqual([]);
	});
});

describe("rule ordering against real-shaped narrations", () => {
	const cases: Array<{
		narration: string;
		amount: number;
		expected: string;
		why: string;
	}> = [
		{
			narration: "TO TRANSFER-INB SWEEP TFR DR 12345678",
			amount: -50000,
			expected: "sweep_out",
			why: "sweep debit — sign picks _out without a bank-specific token",
		},
		{
			narration: "BY TRANSFER-SWEEP TRF FROM 987654321",
			amount: 120000,
			expected: "sweep_in",
			why: "same pattern, credit side",
		},
		{
			narration: "TO TRANSFER-UPI/DR/512345678901/CRED CCBP/UTIB/credccbp.a",
			amount: -18400,
			expected: "card_bill",
			why: "card bill must beat the UPI catch-all",
		},
		{
			narration: "TO TRANSFER-UPI/DR/509876543210/SWIGGY INSTAMART/YESB",
			amount: -742,
			expected: "groceries",
			why: "INSTAMART (band 55) must outrank SWIGGY (band 60)",
		},
		{
			narration: "TO TRANSFER-UPI/DR/501122334455/Swiggy/HDFC/swiggy@axisb",
			amount: -389,
			expected: "food_dining",
			why: "plain Swiggy still lands in food_dining",
		},
		{
			narration: "TO TRANSFER-UPI/DR/504455667788/JIOMART/ICIC",
			amount: -1250,
			expected: "groceries",
			why: "JIOMART must not be stolen by the JIO utilities rule",
		},
		{
			narration: "TO TRANSFER-UPI/DR/503344556677/Jio Recharge/ICIC",
			amount: -299,
			expected: "utilities",
			why: "word-bounded JIO still fires on its own",
		},
		{
			narration: "BY TRANSFER-NEFT*SOLAR PAYOUT*SUSTVEST",
			amount: 2150,
			expected: "uncategorized",
			why: "\\bOLA\\b must NOT match SOLAR — the substring form would steal P2P income",
		},
		{
			narration: "TO TRANSFER-INB TRF TO CURRENT A/C 55667788",
			amount: -25000,
			expected: "uncategorized",
			why: "\\bRENT\\b must NOT match CURRENT",
		},
		{
			narration: "BY TRANSFER-CURRENT ACCOUNT SETTLEMENT",
			amount: 25000,
			expected: "uncategorized",
			why: "and CURRENT credits must not book as rent_received in the KPI numerator",
		},
		{
			narration: "TO TRANSFER-UPI/DR/507788990011/rent may/HDFC",
			amount: -22000,
			expected: "rent",
			why: "a real rent debit still matches, ahead of the UPI catch-all",
		},
		{
			narration: "BY TRANSFER-NEFT*RENT RECEIVED*TENANT",
			amount: 18000,
			expected: "rent_received",
			why: "rent credit is the KPI numerator",
		},
		{
			narration: "TO TRANSFER-DEBIT SALARY ACCOUNT AMB CHRG MAR",
			amount: -236,
			expected: "fees_charges",
			why: "credit-bound SALARY steps aside; CHRG catches it",
		},
		{
			narration: "BY SALARY CREDIT-ACME TECHNOLOGIES PVT LTD",
			amount: 165000,
			expected: "salary",
			why: "the real payroll credit",
		},
		{
			narration: "BY TRANSFER-UPI/CR/512233445566/Friend/SBIN",
			amount: 500,
			expected: "self_transfer",
			why: "UPI credits stay neutral — booking them as expense inflates the coverage ratio",
		},
		{
			narration: "TO TRANSFER-UPI/DR/519988776655/Local Kirana/PYTM",
			amount: -260,
			expected: "upi_merchant",
			why: "unrecognised UPI debit falls through to the catch-all",
		},
		{
			narration: "TO TRANSFER-INB BSE STAR MF BSESTARMF0001",
			amount: -15000,
			expected: "sip",
			why: "MF settlement rail, no platform name in the narration",
		},
		{
			narration: "TO TRANSFER-ACH DEBIT sip/axis mf/12345",
			amount: -5000,
			expected: "sip",
			why: "(?i) makes the lowercase sip token match",
		},
		{
			narration: "BY CREDIT-INT.PD:INTEREST CREDIT 30-06-2026",
			amount: 3117,
			expected: "savings_interest",
			why: "quarterly savings interest",
		},
		{
			narration: "TO TRANSFER-TDS DEDUCTED ON TERM DEPOSIT INT",
			amount: -312,
			expected: "tax_paid",
			why: "tax band must outrank the investment band — a TDS row names the instrument it taxes",
		},
		{
			narration: "TO TRANSFER-INB TERM DEPOSIT 38812345678",
			amount: -100000,
			expected: "fd_deposit",
			why: "...but a plain term-deposit debit still books as the deposit",
		},
		{
			narration: "TO TRANSFER-INB PPF ACCOUNT 12345678901",
			amount: -150000,
			expected: "ppf_contribution",
			why: "word-bounded PPF",
		},
		{
			narration: "TO TRANSFER-ATM WDL/CASH/SBI CHENNAI",
			amount: -3000,
			expected: "misc_expense",
			why: "word-bounded ATM",
		},
	];

	for (const { narration, amount, expected, why } of cases) {
		test(`${expected} <- ${narration} (${why})`, () => {
			const rule = pickRule(narration, amount);
			expect(rule?.assignCategoryKey ?? "uncategorized").toBe(expected);
		});
	}
});
