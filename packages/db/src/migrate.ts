import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import { anchoredDataDir } from "./index";
import { seedAppDefaults } from "./seed";

const CONTROL_MIGRATIONS = fileURLToPath(
	new URL("./migrations/control", import.meta.url),
);
const APP_MIGRATIONS = fileURLToPath(
	new URL("./migrations/app", import.meta.url),
);

export async function runControlMigrations(url: string): Promise<void> {
	const db = drizzle({ client: createClient({ url }) });
	await migrate(db, { migrationsFolder: CONTROL_MIGRATIONS });
}

export async function runAppMigrations(url: string): Promise<void> {
	const db = drizzle({ client: createClient({ url }) });
	await migrate(db, { migrationsFolder: APP_MIGRATIONS });
}

/**
 * Card tables, parent-first: `cards` must exist before the three that carry a `card_id` FK.
 * Ordering matters for {@link restoreCardsInto}, so this is a list, not a set.
 */
const CARD_TABLES = [
	"cards",
	"card_reward_rules",
	"card_extras",
	"card_spend_profile",
	"card_assignments",
] as const;

type CardSnapshot = Record<string, Record<string, unknown>[]>;

/**
 * Read every card row out of control.db BEFORE the control migration drops those tables.
 *
 * Returns null when there is nothing to carry over — a fresh install (tables never existed) or an install
 * already past the move (tables dropped on an earlier boot). Both raise on `SELECT`, and both are normal,
 * so a missing table is swallowed rather than fatal.
 */
async function snapshotControlCards(url: string): Promise<CardSnapshot | null> {
	const client = createClient({ url });
	try {
		const snap: CardSnapshot = {};
		let found = false;
		for (const table of CARD_TABLES) {
			try {
				const rs = await client.execute(`SELECT * FROM ${table}`);
				snap[table] = rs.rows.map((r) => ({ ...r }) as Record<string, unknown>);
				if (snap[table].length > 0) found = true;
			} catch {
				// table is gone (or never existed) — nothing of this kind to carry over
			}
		}
		return found ? snap : null;
	} finally {
		client.close();
	}
}

/**
 * Copy a snapshot into one user's app.db. Refuses if that user already has cards, so re-running a boot
 * never duplicates or clobbers — the whole path has to be idempotent (the entrypoint runs it every start).
 */
async function restoreCardsInto(
	url: string,
	snap: CardSnapshot,
): Promise<number> {
	const client = createClient({ url });
	try {
		const existing = await client.execute("SELECT count(*) AS n FROM cards");
		if (Number(existing.rows[0]?.n ?? 0) > 0) return 0;
		let copied = 0;
		for (const table of CARD_TABLES) {
			for (const row of snap[table] ?? []) {
				const cols = Object.keys(row);
				if (cols.length === 0) continue;
				await client.execute({
					sql: `INSERT OR IGNORE INTO ${table} (${cols
						.map((c) => `"${c}"`)
						.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
					// biome-ignore lint/suspicious/noExplicitAny: libsql InValue, round-tripped verbatim
					args: cols.map((c) => row[c] as any),
				});
				copied++;
			}
		}
		return copied;
	} finally {
		client.close();
	}
}

/** The install's owner: the earliest-created admin. Null on a fresh install with no users yet. */
async function firstAdminUid(url: string): Promise<string | null> {
	const client = createClient({ url });
	try {
		const rs = await client.execute(
			"SELECT id FROM user WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1",
		);
		return (rs.rows[0]?.id as string | undefined) ?? null;
	} catch {
		return null;
	} finally {
		client.close();
	}
}

/** Migrate control.db, then fan out over every users/<uid>/app.db under dataDir. Idempotent. */
export async function migrateAll(opts: { dataDir: string }): Promise<void> {
	const controlUrl = `file:${opts.dataDir}/control.db`;

	// Cards moved control.db → per-user app.db. Snapshot first: the control migration below DROPs them,
	// and on an existing install those rows are the owner's real card portfolio.
	const cardSnapshot = await snapshotControlCards(controlUrl);
	const ownerUid = cardSnapshot ? await firstAdminUid(controlUrl) : null;

	await runControlMigrations(controlUrl);
	const usersDir = `${opts.dataDir}/users`;
	let uids: string[] = [];
	try {
		uids = readdirSync(usersDir, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name);
	} catch {
		// no users dir yet — control-only is fine on first run
	}
	for (const uid of uids) {
		const url = `file:${usersDir}/${uid}/app.db`;
		await runAppMigrations(url);
		// The cards were one shared set; they belong to whoever curated them, i.e. the owner.
		if (cardSnapshot && uid === ownerUid) {
			const copied = await restoreCardsInto(url, cardSnapshot);
			if (copied > 0) {
				console.log(`[migrate] moved ${copied} card rows into users/${uid}`);
			}
		}
	}
}

/** Create a user's private dir, migrate their app.db, and seed default categories + rules. Idempotent. */
export async function provisionUserApp(uid: string): Promise<void> {
	const dir = anchoredDataDir();
	const url = `file:${dir}/users/${uid}/app.db`;
	mkdirSync(`${dir}/users/${uid}/raw`, { recursive: true });
	await runAppMigrations(url);
	await seedAppDefaults(url);
}

/** Delete a user's private dir (app.db, analytics.duckdb, raw). Irreversible. */
export function deprovisionUserApp(uid: string): void {
	rmSync(`${anchoredDataDir()}/users/${uid}`, { recursive: true, force: true });
}
