import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { timestamps } from "./_helpers";

/**
 * Per-user statement import formats (spec 2026-07-21 generic CSV importer). A row describes how to turn one
 * bank's clean CSV into canonical `transactions` (column mapping + date format + amount mode + identity
 * anchor + opt-in quirks). Known banks ship as seeded `system` rows (SBI, `builtin='sbi'`), auto-matched by
 * `header_signature`; users add their own via the mapping wizard. Column keys mirror `StatementMapping` in
 * `@money/shared` so a row spreads straight into the engine contract. The DuckDB parse SQL is generated from
 * this on ingest (`@money/analytics`).
 */
export const statementFormats = sqliteTable("statement_formats", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	/** stable machine key for a seeded built-in ('sbi'); null for user formats. */
	builtin: text("builtin").unique(),
	name: text("name").notNull(),
	/** seeded built-in: rename/hide only, never deleted (like system categories). */
	system: integer("system", { mode: "boolean" }).notNull().default(false),
	/** trimmed header names joined by U+001F — the exact-match auto-detect key. */
	headerSignature: text("header_signature").notNull().unique(),
	/** the account this format's rows post to; part of the txn_id, so stable per format. */
	accountId: integer("account_id").notNull(),
	dateCol: text("date_col").notNull(),
	dateFmt: text("date_fmt").notNull(),
	/** signed | debit_credit | amount_indicator */
	amountMode: text("amount_mode").notNull(),
	amountCol: text("amount_col"),
	/** signed mode: credit_positive | debit_positive */
	signConvention: text("sign_convention"),
	debitCol: text("debit_col"),
	creditCol: text("credit_col"),
	indicatorCol: text("indicator_col"),
	creditToken: text("credit_token"),
	narrationCol: text("narration_col").notNull(),
	refCol: text("ref_col"),
	balanceCol: text("balance_col"),
	valueDateCol: text("value_date_col"),
	/** balance | ref — the identity anchor for txn_id (required to be one of these). */
	anchor: text("anchor").notNull(),
	/** JSON array of quirk names, e.g. ["multiline_unwrap"]. */
	quirks: text("quirks").notNull().default("[]"),
	...timestamps,
});

/**
 * Durable per-file → format binding. The rebuild re-reads every raw CSV and must know which format each was
 * imported under; the raw dir alone can't say. `filename` is the `raw/` basename (`pasted-<hash>.csv`).
 */
export const importFiles = sqliteTable("import_files", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	filename: text("filename").notNull().unique(),
	formatId: integer("format_id").notNull(),
	...timestamps,
});
