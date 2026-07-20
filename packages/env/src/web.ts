import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	clientPrefix: "VITE_",
	client: {
		// Absolute URL (dev: http://localhost:3000) or a relative path for a single-origin deploy
		// (prod: "/", resolved against the current origin by getServerUrl). Hence string, not url().
		VITE_SERVER_URL: z.string().min(1),
	},
	runtimeEnv: (import.meta as any).env,
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});
