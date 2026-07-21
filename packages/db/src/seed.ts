import {
	CATEGORIES,
	type Kind,
	SBI_SEED_FORMAT,
	statementHeaderSignature,
} from "@money/shared";
import { eq } from "drizzle-orm";

import { createAppDb } from "./index";
import { accounts } from "./schema/accounts";
import { categories } from "./schema/categories";
import { statementFormats } from "./schema/formats";
import { rules } from "./schema/ledger";
import { GENERIC_SEED_RULES } from "./seed-rules";

/**
 * Per-user app.db seed defaults (spec 2026-07-21 §5, §7). Seeded idempotently on provisioning and via the
 * one-time owner backfill. Categories come from the shared template (locked `system` rows); rules come from
 * {@link GENERIC_SEED_RULES} — bank-mechanics + mass-market Indian merchants, NOT the owner's SBI-tuned
 * `SEED_RULES` (that stays in `@money/analytics`).
 *
 * Rule seeding is all-or-nothing by design: an account that already has rules is never topped up, so a
 * later expansion of the defaults can't silently re-tag anyone's history.
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

/**
 * Seed a user's `app.db` with default categories, rules, the primary account (id 1 — where the historic
 * hard-coded `account_id=1` transactions post), and the SBI built-in statement format. Each is seeded **only
 * where absent** (idempotent). Safe to run on provisioning and on the owner's already-populated db.
 */
export async function seedAppDefaults(url: string): Promise<{
	categories: number;
	rules: number;
	accounts: number;
	formats: number;
}> {
	const db = createAppDb(url);
	let seededCategories = 0;
	let seededRules = 0;
	let seededAccounts = 0;
	let seededFormats = 0;

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

	// Account 1 is the anchor for the SBI format and the historic account_id=1 ledger — ensure it exists.
	const [account1] = await db
		.select({ id: accounts.id })
		.from(accounts)
		.where(eq(accounts.id, 1))
		.limit(1);
	if (!account1) {
		await db
			.insert(accounts)
			.values({ id: 1, name: "Primary account", kind: "savings" });
		seededAccounts = 1;
	}

	// SBI built-in format (the original hard-coded parser as a seeded mapping).
	const [sbiFormat] = await db
		.select({ id: statementFormats.id })
		.from(statementFormats)
		.where(eq(statementFormats.builtin, SBI_SEED_FORMAT.builtin))
		.limit(1);
	if (!sbiFormat) {
		const { quirks, ...mapping } = SBI_SEED_FORMAT.mapping;
		await db.insert(statementFormats).values({
			builtin: SBI_SEED_FORMAT.builtin,
			name: SBI_SEED_FORMAT.name,
			system: SBI_SEED_FORMAT.system,
			accountId: SBI_SEED_FORMAT.accountId,
			headerSignature: statementHeaderSignature(SBI_SEED_FORMAT.headers),
			...mapping,
			quirks: JSON.stringify(quirks),
		});
		seededFormats = 1;
	}

	return {
		categories: seededCategories,
		rules: seededRules,
		accounts: seededAccounts,
		formats: seededFormats,
	};
}
