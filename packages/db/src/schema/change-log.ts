import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Every write to this user's data, from the app (`source = "app"`) or from Claude over MCP (`"mcp"`).
 *
 * `before`/`after` are the raw table rows (snake_case columns, ms timestamps) of the entity the write
 * touched, which is what makes holdings and expenses undoable. Writes without an `entity` are recorded
 * for the audit trail only.
 */
export const changeLog = sqliteTable(
	"change_log",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		/** Writes made together (one bulk apply) share a batch; a lone write gets its own. */
		batchId: text("batch_id").notNull(),
		at: integer("at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		/** app | mcp */
		source: text("source", { enum: ["app", "mcp"] }).notNull(),
		/** The access token's name when `source = "mcp"`, as it was named at the time. */
		tokenName: text("token_name"),
		/**
		 * The access token's id (control DB `api_tokens.id`) when `source = "mcp"` — names can repeat, ids
		 * don't. Not a foreign key: the token lives in another database and the log outlives it.
		 */
		tokenId: integer("token_id"),
		/** Dotted procedure path, e.g. `plan.updateInvestment`. */
		procedure: text("procedure").notNull(),
		input: text("input", { mode: "json" }).notNull(),
		/** investments | recurring_expenses — set only for undoable writes. */
		entity: text("entity", {
			enum: ["investments", "recurring_expenses"],
		}),
		/** insert | update | delete — set with `entity`; what undo reverses. */
		operation: text("operation", { enum: ["insert", "update", "delete"] }),
		entityId: integer("entity_id"),
		before: text("before", { mode: "json" }),
		after: text("after", { mode: "json" }),
		undoneAt: integer("undone_at", { mode: "timestamp_ms" }),
	},
	(t) => [index("change_log_batch_idx").on(t.batchId)],
);
