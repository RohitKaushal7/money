import { createControlDb } from "@money/db";
import { deprovisionUserApp, provisionUserApp } from "@money/db/migrate";
import * as schema from "@money/db/schema/auth";
import { env } from "@money/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { eq } from "drizzle-orm";

export function createAuth() {
	const db = createControlDb();

	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "sqlite",

			schema: schema,
		}),
		trustedOrigins: [env.CORS_ORIGIN ?? env.BETTER_AUTH_URL],
		emailAndPassword: {
			enabled: true,
			disableSignUp: true,
		},
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		// Sign-in is the one endpoint worth throttling on a self-hosted box: it is the only unauthenticated
		// route that tests a secret, and a single-user install has no lockout to fall back on. Better-Auth
		// enables rate limiting in production by default; this makes the credential path explicitly strict
		// rather than leaving it on the generic window.
		rateLimit: {
			enabled: true,
			window: 60,
			max: 100,
			customRules: {
				"/sign-in/email": { window: 300, max: 10 },
			},
		},
		advanced: {
			defaultCookieAttributes: {
				// `lax` (not `none`): prod serves the SPA and the API from ONE origin, so the session cookie
				// never needs to ride a cross-site request — and `lax` is what keeps a third-party page from
				// firing a state-changing request with the user's session attached.
				//
				// It also unblocks plain-HTTP self-hosting. `sameSite: "none"` *requires* `Secure`, which a
				// browser refuses to set over http:// on anything but localhost — so a LAN deploy
				// (http://192.168.x.x:3000) could never log in. `secure` is now conditional on the origin
				// actually being HTTPS, so LAN-over-HTTP works and real deployments still get the flag.
				sameSite: "lax",
				secure: env.BETTER_AUTH_URL.startsWith("https://"),
				httpOnly: true,
			},
		},
		databaseHooks: {
			user: {
				create: {
					after: async (user) => {
						await provisionUserApp(user.id);
					},
				},
				delete: {
					after: async (user) => {
						deprovisionUserApp(user.id);
					},
				},
			},
			session: {
				create: {
					// A session is only created by signing in, so this is the login stamp. Kept on the user
					// rather than read back off the session table, which loses the fact on sign-out.
					after: async (session) => {
						await db
							.update(schema.user)
							.set({ lastLoginAt: session.createdAt })
							.where(eq(schema.user.id, session.userId));
					},
				},
			},
		},
		plugins: [admin()],
	});
}

export const auth = createAuth();
