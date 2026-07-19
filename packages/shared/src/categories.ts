import type { Kind } from "./kinds";

/**
 * A category is the granular label under a {@link Kind}. This is the **initial seed taxonomy** — the
 * structure is fixed (ADR-0012) but the specific rows are expected to be refined as the rules engine and
 * real statements reveal more patterns. The DuckDB `categories` table is seeded from this list.
 */
export interface Category {
	/** stable kebab/snake key used by rules, overrides, and splits */
	key: string;
	label: string;
	kind: Kind;
	/** For income categories only: does it count toward taxable income? (e.g. PPF interest = false.) */
	taxable?: boolean;
}

export const CATEGORIES: Category[] = [
	// active income (tracked; NOT the KPI numerator — this is what passive income aims to replace)
	{ key: "salary", label: "Salary", kind: "active_income", taxable: true },
	{
		key: "freelance_income",
		label: "Freelance / business",
		kind: "active_income",
		taxable: true,
	},

	// passive income (KPI numerator, cash-basis) — interest/coupons/dividends/payouts/rent-in
	{
		key: "savings_interest",
		label: "Savings interest",
		kind: "passive_income",
		taxable: true,
	},
	{
		key: "sweep_interest",
		label: "Sweep/MOD FD interest",
		kind: "passive_income",
		taxable: true,
	},
	{
		key: "fd_interest",
		label: "FD interest",
		kind: "passive_income",
		taxable: true,
	},
	{
		key: "bond_coupon",
		label: "Bond coupon (Wint Wealth)",
		kind: "passive_income",
		taxable: true,
	},
	{
		key: "p2p_payout",
		label: "P2P/green payout (SustVest)",
		kind: "passive_income",
		taxable: true,
	},
	{ key: "dividend", label: "Dividend", kind: "passive_income", taxable: true },
	{
		key: "rent_received",
		label: "Rent received",
		kind: "passive_income",
		taxable: true,
	},

	// expenses (KPI denominator)
	{ key: "rent", label: "Rent paid", kind: "expense" },
	{ key: "groceries", label: "Groceries", kind: "expense" },
	{ key: "food_dining", label: "Food & dining", kind: "expense" },
	{ key: "shopping", label: "Shopping", kind: "expense" },
	{ key: "transport", label: "Transport & fuel", kind: "expense" },
	{
		key: "utilities",
		label: "Utilities (electricity/telecom/broadband)",
		kind: "expense",
	},
	{ key: "subscription", label: "Subscription", kind: "expense" },
	{ key: "insurance_premium", label: "Insurance premium", kind: "expense" },
	{ key: "health", label: "Health & medical", kind: "expense" },
	{ key: "fees_charges", label: "Bank fees & charges", kind: "expense" },
	{ key: "tax_paid", label: "Tax / TDS paid", kind: "expense" },
	// consolidated card-bill = expense proxy in v1; flips to `transfer` once that card is itemised (ADR-0013 / Q3)
	{
		key: "card_bill",
		label: "Credit-card bill (consolidated spend proxy)",
		kind: "expense",
	},
	{ key: "upi_merchant", label: "UPI merchant payment", kind: "expense" },
	{
		key: "upi_p2p",
		label: "UPI person-to-person (default expense; override if a transfer)",
		kind: "expense",
	},
	{ key: "misc_expense", label: "Miscellaneous expense", kind: "expense" },

	// investments (asset moves; excluded from KPI; each links to an investment for XIRR)
	{ key: "sip", label: "Mutual-fund SIP (Groww)", kind: "investment" },
	{
		key: "bond_investment",
		label: "Bond purchase (Wint Wealth)",
		kind: "investment",
	},
	{ key: "fd_deposit", label: "FD / sweep deposit", kind: "investment" },
	{ key: "ppf_contribution", label: "PPF contribution", kind: "investment" },
	{ key: "stock_buy", label: "Stock purchase", kind: "investment" },
	{ key: "investment_generic", label: "Other investment", kind: "investment" },

	// transfers (excluded from KPI entirely)
	{ key: "sweep_in", label: "Sweep/MOD credit (in)", kind: "transfer" },
	{ key: "sweep_out", label: "Sweep/MOD debit (out)", kind: "transfer" },
	{
		key: "self_transfer",
		label: "Self / inter-account transfer",
		kind: "transfer",
	},
	// investment redemptions / maturities: principal coming back — the inflow inverse of the `investment`
	// purchases. Return of capital, NOT income, so it sits in `transfer` (excluded from the KPI); it also
	// maps to the `redemption`/`maturity` cashflow types (kinds.ts) once XIRR/cost-basis lands (003).
	{
		key: "investment_redemption",
		label: "Investment redemption / maturity (principal)",
		kind: "transfer",
	},
	// reimbursement: a credit that pays you back for a spend — NOT income. Kept neutral (transfer) so it
	// never inflates income; if the reimbursed expense is also tracked in this statement, re-tag the row to
	// `expense` instead to net it against spend (see issue 001 findings).
	{
		key: "reimbursement",
		label: "Reimbursement (not income)",
		kind: "transfer",
	},
	// uncategorised sits in `transfer` so unknowns never silently inflate income OR expenses;
	// dashboards must surface the uncategorised total prominently for review.
	{ key: "uncategorized", label: "Uncategorised", kind: "transfer" },
];

/** Fast lookup by key. */
export const CATEGORY_BY_KEY: Map<string, Category> = new Map(
	CATEGORIES.map((c) => [c.key, c]),
);

export const UNCATEGORIZED_KEY = "uncategorized";
