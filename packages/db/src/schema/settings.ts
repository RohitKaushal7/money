import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { timestamps } from "./_helpers";
import { user } from "./auth";

/**
 * Live app settings as typed key/value JSON — e.g. `drawdown_enabled` (bool) and `drawdown_rate`
 * (number, default 0.04) which parameterize the KPI (ADR-0011). Read by the analytics layer.
 */
export const settings = sqliteTable("settings", {
	key: text("key").primaryKey(),
	value: text("value", { mode: "json" }).notNull(),
	...timestamps,
});

/** Saved calculator / dashboard / view configurations. */
export const savedConfigs = sqliteTable("saved_configs", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	/** calculator | dashboard | view */
	kind: text("kind").notNull(),
	name: text("name").notNull(),
	payload: text("payload", { mode: "json" }).notNull(),
	...timestamps,
});
