import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { timestamps } from "./_helpers";

/**
 * Coverage history — one row per calendar month, capturing the *inputs* the north-star KPI is computed
 * from (ADR-0011/0015). The Plan holds only current state, so without this there is nothing to trend and
 * a month that passes uncaptured is gone for good.
 *
 * **Inputs, not outputs — deliberately.** The KPI definition has already changed once (ADR-0015 retired
 * the drawdown model for the 3-tier ladder). Storing computed ratios would mean a future formula change
 * silently leaves a trend line drawn across two different definitions, which reads as fine and isn't.
 * Storing the inputs means `coverageLadder` re-derives the whole series with current code, so every point
 * is always comparable. Cost: a past point can move when the formula or tax rate changes — this is a
 * consistent series, not a permanent record of what the app displayed that month.
 *
 * `plan_json` holds `{investments, recurring}` already normalised to INR but **pre-tax**, so the FX rates
 * and the after-tax toggle both apply at read time rather than being frozen in.
 *
 * Written by `plan.ladder` (upsert-on-read, only when the serialised plan actually differs), so a month
 * settles at the last state the plan was actually in. Durable app-state → SQLite, not the rebuildable
 * DuckDB file (ADR-0008).
 */
export const coverageSnapshots = sqliteTable("coverage_snapshots", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	/** YYYY-MM — one row per month, upserted */
	month: text("month").notNull().unique(),
	/** JSON `{investments: Investment[], recurring: RecurringExpense[]}` — INR-normalised, pre-tax */
	planJson: text("plan_json").notNull(),
	...timestamps,
});
