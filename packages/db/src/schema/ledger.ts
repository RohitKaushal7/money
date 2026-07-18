import {
	index,
	integer,
	real,
	sqliteTable,
	text,
	unique,
} from "drizzle-orm/sqlite-core";
import { timestamps } from "./_helpers";

/**
 * Ledger app-state: the categorization rules, per-transaction category/kind overrides, and manual splits.
 * All three are ATTACH-joined into the DuckDB rebuild (ADR-0004). `txn_id` is the deterministic ledger
 * key (ADR-0013), stored as text (it lives in DuckDB `transactions`, not a local FK).
 */

/** Ordered narration -> assignment rules (ADR-0012 / Q9). Lower `priority` wins first. */
export const rules = sqliteTable(
	"rules",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		priority: integer("priority").notNull().default(100),
		/** substring | regex */
		matchType: text("match_type").notNull().default("substring"),
		pattern: text("pattern").notNull(),
		/** Kind (active_income | passive_income | expense | investment | transfer) */
		assignKind: text("assign_kind").notNull(),
		assignCategoryKey: text("assign_category_key").notNull(),
		assignInvestmentId: integer("assign_investment_id"),
		active: integer("active", { mode: "boolean" }).default(true).notNull(),
		...timestamps,
	},
	(t) => [index("rules_priority_idx").on(t.priority)],
);

/** One-off category/kind override for a single transaction. */
export const transactionOverrides = sqliteTable("transaction_overrides", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	txnId: text("txn_id").notNull().unique(),
	overrideCategoryKey: text("override_category_key"),
	/** Kind; optional — usually the category implies the kind */
	overrideKind: text("override_kind"),
	note: text("note"),
	...timestamps,
});

/**
 * Manual allocation lines for a transaction. When any rows exist for a `txn_id`, they REPLACE the default
 * single split (spec §4). This is how a mixed bond payout is split into interest vs principal.
 */
export const transactionManualSplits = sqliteTable(
	"transaction_manual_splits",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		txnId: text("txn_id").notNull(),
		seq: integer("seq").notNull(),
		/** signed INR (rupees) */
		amount: real("amount").notNull(),
		kind: text("kind").notNull(),
		categoryKey: text("category_key").notNull(),
		investmentId: integer("investment_id"),
		/** contribution | coupon | dividend | redemption | maturity */
		cashflowType: text("cashflow_type"),
		note: text("note"),
		...timestamps,
	},
	(t) => [
		index("tms_txn_idx").on(t.txnId),
		unique("tms_txn_seq_uq").on(t.txnId, t.seq),
	],
);
