import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { env } from "@money/env/server";
import { drizzle } from "drizzle-orm/libsql";

import * as appSchema from "./schema/app";
import * as controlSchema from "./schema/control";

export { createClient as createRawClient } from "@libsql/client";
export * from "./schema";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Repo-root-anchored data dir (cwd-independent), so auth/API/scripts all agree. */
export function anchoredDataDir(): string {
	return isAbsolute(env.DATA_DIR)
		? env.DATA_DIR
		: join(REPO_ROOT, env.DATA_DIR);
}

/** Repo-root-anchored control.db URL (cwd-independent), so auth/API/scripts all agree. */
function defaultControlUrl(): string {
	return `file:${anchoredDataDir()}/control.db`;
}

/** Shared control DB (auth + curated card/currency reference). `url` defaults to a repo-root-anchored path. */
export function createControlDb(url: string = defaultControlUrl()) {
	return drizzle({ client: createClient({ url }), schema: controlSchema });
}

/** A single user's private app-state DB. `url` is required — resolve it from the request's uid. */
export function createAppDb(url: string) {
	return drizzle({ client: createClient({ url }), schema: appSchema });
}

export type ControlDb = ReturnType<typeof createControlDb>;
export type AppDb = ReturnType<typeof createAppDb>;
