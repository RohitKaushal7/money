import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
	// The release this bundle was built from, shown in the account menu (bumped per deploy, root CLAUDE.md).
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
	},
	server: {
		port: 3001,
	},
	resolve: {
		tsconfigPaths: true,
	},
	plugins: [
		tailwindcss(),
		tanstackRouter({
			target: "react",
			autoCodeSplitting: true,
		}),
		react(),
		VitePWA({
			registerType: "autoUpdate",
			manifest: {
				name: "money",
				short_name: "money",
				description:
					"Track your net worth and how much of your spending passive income covers.",
				// The splash and title bar of the installed app take the default (dark) theme's background, so
				// launching it doesn't flash cream before the first paint.
				theme_color: "#14110e",
				background_color: "#14110e",
				display: "standalone",
				start_url: "/",
				scope: "/",
			},
			pwaAssets: { disabled: false, config: true },
			devOptions: { enabled: true },
		}),
	],
});
