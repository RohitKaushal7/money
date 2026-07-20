import { CATEGORIES, type Kind } from "@money/shared";

import { createAppDb } from "./index";
import { categories } from "./schema/categories";
import { rules } from "./schema/ledger";

/**
 * Per-user app.db seed defaults (spec 2026-07-21 §5, §7). Seeded idempotently on provisioning and via the
 * one-time owner backfill. Categories come from the shared template (locked `system` rows); rules are a tiny,
 * bank-agnostic starter — NOT the owner's SBI-tuned `SEED_RULES` (that stays in `@money/analytics`).
 */

type SeedCategory = {
	key: string;
	label: string;
	kind: Kind;
	taxable: boolean | null;
	system: boolean;
	active: boolean;
	sortOrder: number;
};

/** The shared taxonomy as locked, seeded rows. */
export const SEED_CATEGORIES: SeedCategory[] = CATEGORIES.map((c, i) => ({
	key: c.key,
	label: c.label,
	kind: c.kind,
	taxable: c.taxable ?? null,
	system: true,
	active: true,
	sortOrder: i,
}));

type SeedRuleRow = {
	priority: number;
	matchType: "substring" | "regex";
	pattern: string;
	assignKind: Kind;
	assignCategoryKey: string;
	minAmount?: number;
	maxAmount?: number;
};

/**
 * Generic starter rules for a new user. Deliberately minimal + low-false-positive; the friend builds the rest
 * via "Create rule from transaction". `UPI` is the lowest-priority catch-all. Amount bounds encode the sign
 * (rent is a debit, interest a credit) since narration alone is bank-specific.
 */
export const GENERIC_SEED_RULES: SeedRuleRow[] = [
	{
		priority: 10,
		matchType: "substring",
		pattern: "SALARY",
		assignKind: "active_income",
		assignCategoryKey: "salary",
	},
	{
		priority: 20,
		matchType: "substring",
		pattern: "RENT",
		assignKind: "expense",
		assignCategoryKey: "rent",
		maxAmount: 0,
	},
	{
		priority: 30,
		matchType: "substring",
		pattern: "INTEREST",
		assignKind: "passive_income",
		assignCategoryKey: "savings_interest",
		minAmount: 0,
	},
	{
		priority: 40,
		matchType: "substring",
		pattern: "ATM",
		assignKind: "expense",
		assignCategoryKey: "misc_expense",
	},
	{
		priority: 100,
		matchType: "substring",
		pattern: "UPI",
		assignKind: "expense",
		assignCategoryKey: "upi_merchant",
	},
];

/**
 * Seed a user's `app.db` with default categories + rules, **only where the table is empty** (idempotent).
 * Safe to run on provisioning and on the owner's already-populated db (his non-empty `rules` are left alone).
 */
export async function seedAppDefaults(
	url: string,
): Promise<{ categories: number; rules: number }> {
	const db = createAppDb(url);
	let seededCategories = 0;
	let seededRules = 0;

	const [existingCategory] = await db
		.select({ id: categories.id })
		.from(categories)
		.limit(1);
	if (!existingCategory) {
		await db.insert(categories).values(SEED_CATEGORIES);
		seededCategories = SEED_CATEGORIES.length;
	}

	const [existingRule] = await db.select({ id: rules.id }).from(rules).limit(1);
	if (!existingRule) {
		await db.insert(rules).values(GENERIC_SEED_RULES);
		seededRules = GENERIC_SEED_RULES.length;
	}

	return { categories: seededCategories, rules: seededRules };
}
