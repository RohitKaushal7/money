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

/** Migrate control.db, then fan out over every users/<uid>/app.db under dataDir. Idempotent. */
export async function migrateAll(opts: { dataDir: string }): Promise<void> {
	await runControlMigrations(`file:${opts.dataDir}/control.db`);
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
		await runAppMigrations(`file:${usersDir}/${uid}/app.db`);
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
