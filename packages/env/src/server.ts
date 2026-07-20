import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		BETTER_AUTH_SECRET: z.string().min(32),
		BETTER_AUTH_URL: z.url(),
		// Web origin for CORS + Better-Auth trustedOrigins. Only needed when the web is served from a
		// different origin than the API (dev: :3001 vs :3000). In the single-origin prod container it is
		// omitted and the code falls back to BETTER_AUTH_URL.
		CORS_ORIGIN: z.url().optional(),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		// Base directory holding control.db + users/<uid>/ (spec §3.2). Repo-relative or absolute.
		DATA_DIR: z.string().default("data"),
		// The single owner's user id — read only by the one-time cutover/create-user scripts.
		OWNER_USER_ID: z.string().optional(),
	},
	runtimeEnv: process.env,
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});
