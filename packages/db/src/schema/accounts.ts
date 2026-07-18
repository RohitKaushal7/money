import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { timestamps } from "./_helpers";

/**
 * User-defined accounts. The sweep/MOD FD is a child of the SBI savings account (`parent_account_id`),
 * so SBI auto-sweeps become clean inter-account transfers (spec §4 / ADR-0012). Cards are liability
 * "accounts". DuckDB derives per-account balances from the ledger.
 */
export const accounts = sqliteTable("accounts", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	name: text("name").notNull(),
	/** savings | sweep_fd | current | card | external */
	kind: text("kind").notNull(),
	/** self-reference (plain int to avoid FK ordering headaches); e.g. sweep FD -> SBI savings */
	parentAccountId: integer("parent_account_id"),
	institution: text("institution"),
	active: integer("active", { mode: "boolean" }).default(true).notNull(),
	...timestamps,
});
