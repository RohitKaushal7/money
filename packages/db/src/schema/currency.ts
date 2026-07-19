import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { timestamps } from "./_helpers";

/**
 * Currencies the app knows about (issue: multi-currency). INR is the **canonical base** — every stored
 * foreign amount (a subscription in USD, a holding in EUR) is normalised to INR for the aggregate math,
 * and the UI converts INR → the active display currency (a `display_currency` row in `settings`).
 *
 * `rateToInr` = how many INR one unit is worth (so INR itself = 1). Set manually or refreshed from the free
 * frankfurter.app ECB feed. `enabled` gates which currencies appear in pickers + the display switcher.
 */
export const currencies = sqliteTable("currencies", {
	/** ISO 4217 code, e.g. "USD" (primary key) */
	code: text("code").primaryKey(),
	/** display symbol, e.g. "$" */
	symbol: text("symbol").notNull(),
	/** INR per 1 unit of this currency; INR = 1 */
	rateToInr: real("rate_to_inr").notNull().default(1),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
	...timestamps,
});
