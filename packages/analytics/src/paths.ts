/**
 * Filesystem locations for the analytical data layer.
 *
 * Paths are expressed relative to the repository root. Resolution against an absolute root is left to the
 * caller (the API and `scripts/ingest.ts`) so this module stays dependency-free and side-effect-free.
 */

/** Rebuildable DuckDB database file (gitignored, ADR-0002). */
export const DUCKDB_RELATIVE_PATH = "data/analytics.duckdb";

/** Directory of immutable raw statement exports (gitignored, ADR-0002). */
export const RAW_DIR_RELATIVE_PATH = "data/raw";

/**
 * The SQLite app-state DB that DuckDB `ATTACH`es for overrides (ADR-0004). Mirrors the scaffold's
 * `DATABASE_URL=file:../../local.db`, i.e. `local.db` at the repo root.
 */
export const SQLITE_RELATIVE_PATH = "local.db";

/** Join a relative data-layer path onto an absolute repo root, using POSIX separators. */
export function fromRoot(repoRoot: string, relativePath: string): string {
	return `${repoRoot.replace(/\/+$/, "")}/${relativePath}`;
}
