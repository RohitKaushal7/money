#!/usr/bin/env bun
/**
 * One-time (idempotent) backfill: bind every EXISTING `raw/*.csv` to the SBI built-in format via the new
 * `import_files` table, so the generic importer's rebuild — which resolves each raw file's parser through its
 * `import_files` binding — handles historic files correctly. Every pre-existing raw file is an SBI export.
 *
 *   bun run backfill-import-files            # every data/users/<uid>
 *   bun run backfill-import-files --user <uid>
 *
 * Run AFTER `bun run db:migrate` (which creates the tables); this also seeds the SBI format + account 1 if
 * absent. Safe to re-run — existing bindings are left alone, and the ingest already falls back to SBI for any
 * still-unbound file, so an un-backfilled DB rebuilds correctly too; the backfill just makes it explicit.
 */
import { existsSync, readdirSync } from "node:fs";
import { anchoredDataDir, createAppDb } from "@money/db";
import { runAppMigrations } from "@money/db/migrate";
import { importFiles, statementFormats } from "@money/db/schema/app";
import { seedAppDefaults } from "@money/db/seed";
import { eq } from "drizzle-orm";

function arg(flag: string): string | undefined {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

async function backfill(dir: string, uid: string): Promise<void> {
	const url = `file:${dir}/users/${uid}/app.db`;
	await runAppMigrations(url); // idempotent — ensures the new tables exist
	await seedAppDefaults(url); // idempotent — ensures the SBI format + account 1 exist
	const db = createAppDb(url);
	const [sbi] = await db
		.select({ id: statementFormats.id })
		.from(statementFormats)
		.where(eq(statementFormats.builtin, "sbi"));
	if (!sbi) {
		console.log(`[backfill] ${uid}: no SBI format found — skipped`);
		return;
	}
	const rawDir = `${dir}/users/${uid}/raw`;
	const names = existsSync(rawDir)
		? readdirSync(rawDir).filter((f) => f.toLowerCase().endsWith(".csv"))
		: [];
	const bound = new Set(
		(await db.select({ filename: importFiles.filename }).from(importFiles)).map(
			(b) => b.filename,
		),
	);
	let added = 0;
	for (const name of names) {
		if (bound.has(name)) continue;
		await db.insert(importFiles).values({ filename: name, formatId: sbi.id });
		added += 1;
	}
	console.log(
		`[backfill] ${uid}: ${names.length} raw file(s), +${added} bound to SBI`,
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
