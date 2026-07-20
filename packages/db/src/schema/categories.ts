import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { timestamps } from "./_helpers";

/**
 * Per-user category taxonomy (spec 2026-07-21 §4.1). Each category rolls up to one of the 5 fixed Kinds, so the
 * KPI engine keeps working. Seeded from `@money/shared` CATEGORIES as a template (`system=true`, locked); users
 * add their own (`system=false`, fully editable). The DuckDB `categories` table is sourced from this on rebuild.
 */
export const categories = sqliteTable("categories", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	/** stable slug used by rules/overrides/splits; immutable after create. */
	key: text("key").notNull().unique(),
	label: text("label").notNull(),
	/** active_income | passive_income | expense | investment | transfer — locked for system rows. */
	kind: text("kind").notNull(),
	/** income categories only; drives the taxable-passive tax sum. */
	taxable: integer("taxable", { mode: "boolean" }),
	/** seeded template row: label + `active` editable only, never deleted, key/kind fixed. */
	system: integer("system", { mode: "boolean" }).notNull().default(false),
	/** false = hidden from pickers; the key still resolves in compute. */
	active: integer("active", { mode: "boolean" }).notNull().default(true),
	sortOrder: integer("sort_order").notNull().default(0),
	...timestamps,
});
