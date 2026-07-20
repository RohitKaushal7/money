#!/usr/bin/env bun
/**
 * One-time (idempotent) backfill so EXISTING users get the new per-user `categories` table populated. The
 * schema migration (0001) only creates the empty table; this seeds it from the shared template. Rules are
 * seeded only where a user's `rules` table is empty, so the owner's SBI-tuned rules are left untouched.
 *
 *   bun run backfill-categories            # every data/users/<uid>/app.db
 *   bun run backfill-categories --user <uid>
 *
 * Run AFTER `bun run db:migrate` (which creates the table). Safe to re-run.
 */
import { existsSync, readdirSync } from "node:fs";
import { anchoredDataDir } from "@money/db";
import { runAppMigrations } from "@money/db/migrate";
import { seedAppDefaults } from "@money/db/seed";

function arg(flag: string): string | undefined {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

async function backfill(dir: string, uid: string): Promise<void> {
	const url = `file:${dir}/users/${uid}/app.db`;
	await runAppMigrations(url); // idempotent — ensures the categories table exists
	const seeded = await seedAppDefaults(url);
	console.log(
		`[backfill] ${uid}: +${seeded.categories} categories, +${seeded.rules} rules`,
	);
}

async function main(): Promise<void> {
	const dir = anchoredDataDir();
	const only = arg("--user");
	const usersDir = `${dir}/users`;
	const uids = only
		? [only]
		: existsSync(usersDir)
			? readdirSync(usersDir, { withFileTypes: true })
					.filter((d) => d.isDirectory())
					.map((d) => d.name)
			: [];
	if (uids.length === 0) {
		console.log("[backfill] no users found");
		return;
	}
	for (const uid of uids) {
		await backfill(dir, uid);
	}
	console.log(`[backfill] done (${uids.length} user(s))`);
}

main().catch((e: unknown) => {
	console.error(
		`[backfill] failed: ${e instanceof Error ? e.message : String(e)}`,
	);
	process.exit(1);
});
