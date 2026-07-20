import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({ path: "../../apps/server/.env" });

export default defineConfig({
	schema: "./src/schema/control.ts",
	out: "./src/migrations/control",
	dialect: "turso",
	dbCredentials: {
		url: process.env.CONTROL_DB_URL || "file:../../data/control.db",
	},
});
