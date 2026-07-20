import { defineConfig } from "drizzle-kit";

// App migrations are generated against a scratch URL; they are APPLIED per-user at runtime (migrate.ts).
export default defineConfig({
	schema: "./src/schema/app.ts",
	out: "./src/migrations/app",
	dialect: "turso",
	dbCredentials: { url: process.env.APP_DB_URL || "file:./.app-scratch.db" },
});
