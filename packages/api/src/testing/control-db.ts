/**
 * Test-only (kept out of the image by `.dockerignore`, like every `*.test.ts`).
 *
 * `bun test packages` runs every test file in one module registry, so the `controlDb()` singleton (and auth,
 * which shares it) may already be open on an earlier file's DATA_DIR rather than this file's. This migrates
 * the control DB it actually has open, and returns that file's data dir.
 *
 * With `followDataDir`, DATA_DIR is pointed there too, so the users, sessions and app DBs a test file creates
 * land beside the control DB those singletons read. Leave it off in a file whose app DBs are already open
 * under its own DATA_DIR: moving it mid-file would send later `appDbFor()` calls somewhere else.
 *
 * Imports lazily: a test file sets DATA_DIR and the other env vars before it loads anything that reads them.
 */
export async function migrateLiveControlDb(
	opts: { followDataDir?: boolean } = {},
): Promise<string> {
	const { dirname } = await import("node:path");
	const { runControlMigrations } = await import("@money/db/migrate");
	const { controlDb } = await import("../db");
	const { dataDir } = await import("../paths");
	const live = (await controlDb().$client.execute("PRAGMA database_list"))
		.rows[0]?.file;
	const file =
		typeof live === "string" && live ? live : `${dataDir()}/control.db`;
	if (opts.followDataDir) process.env.DATA_DIR = dirname(file);
	await runControlMigrations(`file:${file}`);
	return dirname(file);
}
