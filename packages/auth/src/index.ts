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
		advanced: {
			defaultCookieAttributes: {
				sameSite: "none",
				secure: true,
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
