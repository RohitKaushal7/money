import { defineConfig } from "tsdown";

/**
 * `bun run build` still bundles the server, but nothing runs the bundle: `start`, `dev` and the container
 * (`entrypoint.sh`) all run `src/index.ts` from source. The bundle can't run correctly. Paths resolved from
 * `import.meta.url` (the query sandbox's worker file, the repo root that `scripts/ingest.ts` and the data dir
 * are found from) would resolve relative to `dist/` instead of the package that wrote them, and the native
 * `@duckdb/node-api` import is hoisted to a path where it can't load.
 */
export default defineConfig({
	entry: "./src/index.ts",
	format: "esm",
	outDir: "./dist",
	clean: true,
	noExternal: [/@money\/.*/],
});
