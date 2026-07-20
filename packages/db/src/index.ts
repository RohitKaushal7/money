import { createClient } from "@libsql/client";
import { env } from "@money/env/server";
import { drizzle } from "drizzle-orm/libsql";

import * as appSchema from "./schema/app";
import * as controlSchema from "./schema/control";

export * from "./schema";

/** Shared control DB (auth + curated card/currency reference). `url` defaults to `env.DATABASE_URL`. */
export function createControlDb(url: string = env.DATABASE_URL) {
	return drizzle({ client: createClient({ url }), schema: controlSchema });
}

/** A single user's private app-state DB. `url` is required — resolve it from the request's uid. */
export function createAppDb(url: string) {
	return drizzle({ client: createClient({ url }), schema: appSchema });
}

export type ControlDb = ReturnType<typeof createControlDb>;
export type AppDb = ReturnType<typeof createAppDb>;

/** Back-compat singleton (control DB). Removed in a later task once every router uses context dbs. */
export const db = createControlDb();

/** @deprecated Temporary alias for `createControlDb`, kept only so `@money/auth` keeps compiling. Remove in the routing-switch task. */
export const createDb = createControlDb;
