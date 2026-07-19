import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { timestamps } from "./_helpers";

/**
 * Net-worth log — a curated time series of dated total-net-worth points (the owner's "old logs" sheet).
 * Durable app-state (ADR-0008): hand-entered milestones plus a `computed` point auto-derived from the SBI
 * cash balance + Σ investment `current_value`. The per-step annualised growth and the headline CAGR are
 * derived in `@money/shared` (`networth.ts`) — this table just stores the raw points.
 *
 * Lives in SQLite (not the DuckDB `networth_snapshots` persist table it replaces) because adding a point is
 * an API write, and the API is read-only on DuckDB (ADR-0003). One point per date (`as_of` unique) — a
 * re-log for the same day upserts.
 */
export const networthLogs = sqliteTable("networth_logs", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	/** YYYY-MM-DD */
	asOf: text("as_of").notNull().unique(),
	/** total net worth (INR rupees) */
	value: real("value").notNull(),
	/** manual = hand-entered milestone; computed = auto-derived (cash + Σ current_value) */
	source: text("source").notNull().default("manual"),
	note: text("note"),
	...timestamps,
});
