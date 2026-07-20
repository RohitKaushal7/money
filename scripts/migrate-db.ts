#!/usr/bin/env bun
import { migrateAll } from "@money/db/migrate";
import { env } from "@money/env/server";

await migrateAll({ dataDir: env.DATA_DIR });
console.log("[db] migrations applied to control.db + every users/*/app.db");
