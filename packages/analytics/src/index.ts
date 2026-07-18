/**
 * `@money/analytics` — the ONLY package that touches DuckDB / `@duckdb/node-api` (ADR-0009).
 *
 * This main entry exposes the **read-only** surface. It is what `packages/api` and the Claude Code CLI
 * import. The read-write factory lives behind the separate subpath `@money/analytics/ingest` and is
 * imported ONLY by `scripts/ingest.ts` (ADR-0003).
 *
 * ── HARD RULE ──────────────────────────────────────────────────────────────────────────────────────
 * The API opens DuckDB READ-ONLY. Never read-write. If you need to write, you are in the ingest script.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Status: **boundary skeleton**. `@duckdb/node-api` is not installed yet (D2). `openReadOnly()` throws
 * until the data-layer phase wires it. The intended implementation is:
 *
 * ```ts
 * import { DuckDBInstance } from "@duckdb/node-api";
 * const instance = await DuckDBInstance.create(dbPath, { access_mode: "read_only" });
 * const connection = await instance.connect();
 * const reader = await connection.runAndReadAll("SELECT ...");
 * const rows = reader.getRowObjects();
 * ```
 */

export * from "./paths";

const NOT_WIRED =
	"DuckDB not wired yet — @money/analytics is a boundary skeleton this session. " +
	"See docs/roadmap.md (data-layer phase) and docs/decisions/0009-duckdb-node-api-isolated.md.";

/** Read-only handle onto the analytical DB. The shape of the eventual DuckDB-backed reader. */
export interface AnalyticsReader {
	/** Run a read-only SQL query and return the result rows as objects. */
	query<T = Record<string, unknown>>(
		sql: string,
		params?: unknown[],
	): Promise<T[]>;
	/** Release the connection. */
	close(): Promise<void>;
}

export interface OpenReadOnlyOptions {
	/** Absolute path to the DuckDB file. Defaults to `DUCKDB_RELATIVE_PATH` resolved against the repo root. */
	dbPath?: string;
}

/**
 * Open a **read-only** connection to the analytical DB (`access_mode: "read_only"`).
 * Safe to call from the API and from multiple readers concurrently (ADR-0003).
 *
 * @throws until the data-layer phase installs `@duckdb/node-api` and implements this.
 */
export function openReadOnly(
	_options: OpenReadOnlyOptions = {},
): Promise<AnalyticsReader> {
	return Promise.reject(new Error(NOT_WIRED));
}
