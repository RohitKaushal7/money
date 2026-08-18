import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { timestamps } from "./_helpers";

/**
 * Install-level facts about this deployment — control.db, one row per key, never user-scoped.
 *
 * It exists for exactly one thing today: remembering that first-run setup has happened.
 *
 * The setup route opens when the user table is empty, which is the right test on a fresh install and the
 * wrong one afterwards — delete the last account and an empty table reads as "fresh" again, re-opening the
 * unauthenticated create-an-admin endpoint to whoever reaches it first. A user count cannot distinguish
 * "never set up" from "set up, then emptied"; a latch can. Once set, `setup_completed_at` is never cleared.
 */
export const installMeta = sqliteTable("install_meta", {
	key: text("key").primaryKey(),
	value: text("value"),
	...timestamps,
});

/** The one key that matters today. */
export const SETUP_COMPLETED_AT = "setup_completed_at";
