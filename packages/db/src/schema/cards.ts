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
