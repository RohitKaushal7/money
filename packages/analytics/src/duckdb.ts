import { DuckDBInstance, type DuckDBValue } from "@duckdb/node-api";
import { DUCKDB_RELATIVE_PATH } from "./paths";

/**
 * Internal DuckDB connection wrapper (ADR-0009: the only place that talks to `@duckdb/node-api`).
 * `openReadOnly()` (index.ts) and `openReadWrite()` (ingest.ts) both build on `openConnection()`.
 */

export type AccessMode = "read_only" | "read_write";

/** Default DuckDB path resolution shared by the read-only and read-write factories. */
export function resolveDbPath(dbPath?: string): string {
	return dbPath ?? process.env.ANALYTICS_DB_PATH ?? DUCKDB_RELATIVE_PATH;
}

/** Bindable SQL parameter. */
export type SqlParam = string | number | boolean | bigint | null;

/** A live connection with JSON-safe query results. */
export interface DuckConnection {
	/** Run a query; returns normalized, JSON-safe row objects. */
	query<T = Record<string, unknown>>(
		sql: string,
		params?: SqlParam[],
	): Promise<T[]>;
	/** Run a statement returning no rows (DDL / INSERT / ATTACH). */
	run(sql: string, params?: SqlParam[]): Promise<void>;
	/** Release the connection and its instance. */
	close(): Promise<void>;
}

/**
 * DuckDB's JS values are already native; make them JSON-safe. A Date becomes an ISO string. A bigint (BIGINT,
 * UBIGINT, HUGEINT: counts, sums of integers) becomes a number when it is a safe integer, which every real
 * figure here is, and otherwise its exact decimal string, since a number would silently round it. DECIMAL
 * columns arrive as JS numbers already (`getRowObjectsJS`), so one wider than ~15 significant digits is
 * rounded before it gets here; DECIMAL(18,2) rupee amounts are exact up to ~₹90 trillion.
 * Only top-level values are converted; a bigint inside a LIST or STRUCT is left as is.
 */
function normalize(value: unknown): unknown {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "bigint") {
		const n = Number(value);
		return Number.isSafeInteger(n) ? n : value.toString();
	}
	return value;
}

export function normalizeRow(
	row: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(row)) out[key] = normalize(row[key]);
	return out;
}

export async function openConnection(
	dbPath: string,
	mode: AccessMode,
): Promise<DuckConnection> {
	// DuckDBInstance.create options are Record<string, string>; access_mode defaults to read_write.
	const instance = await DuckDBInstance.create(
		dbPath,
		mode === "read_only" ? { access_mode: "read_only" } : undefined,
	);
	const connection = await instance.connect();

	return {
		async query<T = Record<string, unknown>>(
			sql: string,
			params?: SqlParam[],
		): Promise<T[]> {
			const reader = await connection.runAndReadAll(
				sql,
				params as DuckDBValue[] | undefined,
			);
			return reader.getRowObjectsJS().map((r) => normalizeRow(r)) as T[];
		},
		async run(sql: string, params?: SqlParam[]): Promise<void> {
			await connection.run(sql, params as DuckDBValue[] | undefined);
		},
		async close(): Promise<void> {
			connection.disconnectSync();
			instance.closeSync();
		},
	};
}
