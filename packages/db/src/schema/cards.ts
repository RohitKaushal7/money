import {
	index,
	integer,
	real,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import { timestamps } from "./_helpers";

/**
 * Credit cards + reward rules, owned in-app (Q10), seeded once from `packages/info`. The queryable core
 * (per-category rate/cap/condition) is relational; the irregular bits (milestones/gotchas/lounge/
 * exclusions) stay as structured JSON in `card_extras` rather than being over-normalized (spec §5).
 */
export const cards = sqliteTable("cards", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	name: text("name").notNull().unique(),
	network: text("network"),
	issuer: text("issuer"),
	isLtf: integer("is_ltf", { mode: "boolean" }).default(false).notNull(),
	annualFee: real("annual_fee"),
	feeWaiverSpend: real("fee_waiver_spend"),
	forexMarkup: real("forex_markup"),
	vintageYear: integer("vintage_year"),
	active: integer("active", { mode: "boolean" }).default(true).notNull(),
	// ── lossless fields imported from packages/info (issue 005) ──
	variant: text("variant"),
	/** active | dormant | closed (mirrors `active` for quick filtering) */
	status: text("status").default("active"),
	joiningFee: real("joining_fee"),
	/** raw waiver condition, e.g. "spend >= 2,00,000/year" or "lifetime free" */
	feeWaiverCondition: text("fee_waiver_condition"),
	/** raw forex string alongside numeric forexMarkup, e.g. "3.5% + GST" */
	forexMarkupText: text("forex_markup_text"),
	lastUpdated: text("last_updated"),
	termsEffective: text("terms_effective"),
	/** high | medium | low */
	confidence: text("confidence"),
	inWallet: integer("in_wallet", { mode: "boolean" }).default(false).notNull(),
	tier: text("tier"),
	...timestamps,
});

export const cardRewardRules = sqliteTable(
	"card_reward_rules",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		cardId: integer("card_id")
			.notNull()
			.references(() => cards.id, { onDelete: "cascade" }),
		category: text("category").notNull(),
		rate: real("rate"),
		cap: real("cap"),
		condition: text("condition"),
		/** cashback | points | voucher */
		rewardType: text("reward_type"),
		/** ₹ value per point, for points cards */
		pointValue: real("point_value"),
		isExclusion: integer("is_exclusion", { mode: "boolean" })
			.default(false)
			.notNull(),
		/** raw rate string, e.g. "0.2% (1x)" (numeric `rate` is parsed from this for ranking) */
		rateText: text("rate_text"),
		/** raw cap string when non-numeric, e.g. "25,000 RP/month combined" */
		capText: text("cap_text"),
		rewardCurrency: text("reward_currency"),
		/** base/default rate (true) vs an accelerated category boost (false) */
		isBase: integer("is_base", { mode: "boolean" }).default(false).notNull(),
		notes: text("notes"),
		...timestamps,
	},
	(t) => [index("crr_card_idx").on(t.cardId)],
);

export const cardExtras = sqliteTable("card_extras", {
	cardId: integer("card_id")
		.primaryKey()
		.references(() => cards.id, { onDelete: "cascade" }),
	milestones: text("milestones", { mode: "json" }),
	gotchas: text("gotchas", { mode: "json" }),
	lounge: text("lounge", { mode: "json" }),
	exclusions: text("exclusions", { mode: "json" }),
	bestFor: text("best_for", { mode: "json" }),
	avoidFor: text("avoid_for", { mode: "json" }),
	redemption: text("redemption", { mode: "json" }),
	sources: text("sources", { mode: "json" }),
	...timestamps,
});

/** Monthly spend by category, used to match cards to rewards (from packages/info spending-profile). */
export const cardSpendProfile = sqliteTable("card_spend_profile", {
	category: text("category").primaryKey(),
	monthlyAmount: real("monthly_amount").notNull(),
	...timestamps,
});

/** Which card is assigned to each purpose (from packages/info decision-history). */
export const cardAssignments = sqliteTable("card_assignments", {
	purpose: text("purpose").primaryKey(),
	cardId: integer("card_id")
		.notNull()
		.references(() => cards.id),
	note: text("note"),
	...timestamps,
});
