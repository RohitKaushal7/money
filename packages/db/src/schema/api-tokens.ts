import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

/**
 * Personal access tokens for the MCP endpoint — control.db, because they authenticate a user across the
 * install rather than belonging to one user's app state.
 *
 * Only the SHA-256 of the token is stored; the plaintext is shown once at creation. `prefix` is the
 * first characters of the token, kept so the Settings list can tell tokens apart.
 */
export const apiTokens = sqliteTable(
	"api_tokens",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		tokenHash: text("token_hash").notNull().unique(),
		prefix: text("prefix").notNull(),
		scope: text("scope", { enum: ["read", "read_write"] }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
		revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
	},
	(table) => [index("api_tokens_user_idx").on(table.userId)],
);
