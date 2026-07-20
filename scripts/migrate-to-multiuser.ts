#!/usr/bin/env bun
/**
 * One-time owner cutover: copy the pre-multi-tenant `local.db` + `data/analytics.duckdb` + `data/raw` into the
 * per-user layout — shared `control.db` (auth + curated card/currency reference) and
 * `users/<owner>/{app.db, analytics.duckdb, raw/}`. NON-DESTRUCTIVE: originals are left intact for rollback.
 *
 * Owner id = env.OWNER_USER_ID (falls back to "owner"). Run once, from the repo root: `bun run cutover`.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { userDir, userDuckdbPath, userRawDir } from "@money/analytics";
import { runAppMigrations, runControlMigrations } from "@money/db/migrate";
import { env } from "@money/env/server";

const OWNER = env.OWNER_USER_ID ?? "owner";
const LOCAL = fileURLToPath(new URL("../local.db", import.meta.url));
const OLD_DUCKDB = fileURLToPath(
	new URL("../data/analytics.duckdb", import.meta.url),
);
const OLD_RAW = fileURLToPath(new URL("../data/raw", import.meta.url));
const dataDir = env.DATA_DIR;

/** local.db tables that belong in the SHARED control.db. */
const CONTROL_TABLES = [
	"user",
	"session",
	"account",
	"verification",
	"cards",
	"card_reward_rules",
	"card_extras",
	"card_spend_profile",
	"card_assignments",
	"currencies",
];
/** local.db tables that belong in the owner's per-user app.db. */
const APP_TABLES = [
	"rules",
	"transaction_overrides",
	"transaction_manual_splits",
	"investments",
	"recurring_expenses",
	"networth_logs",
	"settings",
	"saved_configs",
	"tax_profiles",
	"accounts",
	"investment_valuations_manual",
];

async function copyTables(
	fromUrl: string,
	toUrl: string,
	tables: string[],
): Promise<void> {
	const src = createClient({ url: fromUrl });
	const dst = createClient({ url: toUrl });
	for (const t of tables) {
		let rows: Record<string, unknown>[];
		try {
			rows = (await src.execute(`SELECT * FROM ${t}`))
				.rows as unknown as Record<string, unknown>[];
		} catch {
			console.log(`[cutover]   skip ${t} (absent in local.db)`);
			continue;
		}
		for (const row of rows) {
			const cols = Object.keys(row);
			const placeholders = cols.map(() => "?").join(", ");
			await dst.execute({
				sql: `INSERT OR REPLACE INTO ${t} (${cols.join(", ")}) VALUES (${placeholders})`,
				args: cols.map((c) => row[c] as never),
			});
		}
		console.log(`[cutover]   ${t}: ${rows.length} rows`);
	}
}

async function main(): Promise<void> {
	mkdirSync(`${dataDir}/users`, { recursive: true });
	mkdirSync(userDir(dataDir, OWNER), { recursive: true });

	const controlUrl = `file:${dataDir}/control.db`;
	const appUrl = `file:${userDir(dataDir, OWNER)}/app.db`;

	console.log("[cutover] migrating control.db…");
	await runControlMigrations(controlUrl);
	console.log("[cutover] migrating owner app.db…");
	await runAppMigrations(appUrl);

	if (existsSync(LOCAL)) {
		console.log("[cutover] copying control tables…");
		await copyTables(`file:${LOCAL}`, controlUrl, CONTROL_TABLES);
		console.log("[cutover] copying owner app tables…");
		await copyTables(`file:${LOCAL}`, appUrl, APP_TABLES);
	} else {
		console.log("[cutover] no local.db — fresh install, nothing to copy");
	}

	if (existsSync(OLD_DUCKDB)) {
		cpSync(OLD_DUCKDB, userDuckdbPath(dataDir, OWNER));
		console.log("[cutover] copied analytics.duckdb → owner dir");
	}
	if (existsSync(OLD_RAW)) {
		cpSync(OLD_RAW, userRawDir(dataDir, OWNER), { recursive: true });
		console.log("[cutover] copied data/raw → owner raw dir");
	}
	console.log(
		`[cutover] done. Owner uid = ${OWNER}. Original local.db + data/analytics.duckdb left intact.`,
	);
}

main().catch((e: unknown) => {
	console.error(
		`[cutover] failed: ${e instanceof Error ? e.message : String(e)}`,
	);
	process.exit(1);
});
