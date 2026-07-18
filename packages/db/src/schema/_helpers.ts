import { sql } from "drizzle-orm";
import { integer } from "drizzle-orm/sqlite-core";

/**
 * Shared `created_at` / `updated_at` columns (ms epoch), matching the convention in `auth.ts`.
 * Spread into a table definition: `sqliteTable("x", { ...cols, ...timestamps })`.
 */
export const timestamps = {
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.$onUpdate(() => new Date())
		.notNull(),
};
