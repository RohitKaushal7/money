import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().min(1),
		BETTER_AUTH_SECRET: z.string().min(32),
		BETTER_AUTH_URL: z.url(),
		CORS_ORIGIN: z.url(),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		// Path to the read-only analytical DuckDB (ADR-0003). Optional; defaults to <repo>/data/analytics.duckdb.
		ANALYTICS_DB_PATH: z.string().optional(),
		// Base directory holding control.db + users/<uid>/ (spec §3.2). Repo-relative or absolute.
		DATA_DIR: z.string().default("data"),
		// The single owner's user id — the routing seam, replaced by session.user.id when auth lands.
		OWNER_USER_ID: z.string().optional(),
	},
	runtimeEnv: process.env,
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});
