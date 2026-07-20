import { existsSync } from "node:fs";
import {
	type AnalyticsReader,
	openReadOnly,
	userDuckdbPath,
} from "@money/analytics";
import { dataDir } from "./paths";

/**
 * Read-only access to a USER's analytical DuckDB (ADR-0003). The API NEVER opens it read-write; writes happen
 * only through the ingest runner. A short-lived connection is opened per call so the ingest process can
 * acquire the single-writer lock between requests.
 */

function dbPath(uid: string): string {
	return userDuckdbPath(dataDir(), uid);
}

/** Whether a user's analytical DB exists yet (i.e. their ingest has produced one). */
export function analyticsReady(uid: string): boolean {
	return existsSync(dbPath(uid));
}

/** Open a read-only reader on the user's DuckDB, run `fn`, always close. Guard with `analyticsReady(uid)`. */
export async function withReader<T>(
	uid: string,
	fn: (reader: AnalyticsReader) => Promise<T>,
): Promise<T> {
	const reader = await openReadOnly({ dbPath: dbPath(uid) });
	try {
		return await fn(reader);
	} finally {
		await reader.close();
	}
}
