import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "@money/env/server";

/** Repo root, resolved from this file at `packages/api/src/paths.ts`. */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Absolute data dir. Uses `env.DATA_DIR` when absolute, else anchors it at the repo root so the API's CWD
 * (`apps/server`) doesn't matter. Keeps the API and the repo-root-CWD ingest script pointing at the SAME dir.
 */
export function dataDir(): string {
	return isAbsolute(env.DATA_DIR)
		? env.DATA_DIR
		: join(REPO_ROOT, env.DATA_DIR);
}
