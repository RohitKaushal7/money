import { DuckDBInstance } from "@duckdb/node-api";
import { normalizeRow } from "./duckdb";

/**
 * Untrusted, read-only SQL over one analytics DB — for SQL an AI wrote (the MCP `query` tool).
 *
 * The sandbox is DuckDB's own, set when the instance is created and then locked:
 * - `access_mode: read_only` — no table, view or row can be written;
 * - `enable_external_access: false` — no file reads or writes (`read_csv`, `COPY … TO`, `glob`), no
 *   `ATTACH`, no `INSTALL`/`LOAD` of extensions;
 * - `autoinstall_known_extensions` / `autoload_known_extensions: false` — no extension pulled in implicitly;
 * - `temp_directory: ""` and `memory_limit` — nothing spilled to disk next to the DB, bounded working memory;
 * - `lock_configuration: true` — no `SET`/`RESET` can loosen any of the above afterwards.
 * Rows are bounded by streaming only as many as are needed, and time by interrupting the connection.
 * Every call opens and closes its own instance, so one query can't see or affect another.
 */
const SANDBOX: Record<string, string> = {
	// Options are applied in key order. `temp_directory` must come before `enable_external_access`
	// (DuckDB refuses to change it once external access is off), and `lock_configuration` last.
	temp_directory: "",
	access_mode: "read_only",
	enable_external_access: "false",
	autoinstall_known_extensions: "false",
	autoload_known_extensions: "false",
	memory_limit: "1GB",
	lock_configuration: "true",
};

export const QUERY_MAX_ROWS = 500;
export const QUERY_TIMEOUT_MS = 10_000;

export interface SandboxedQueryOptions {
	/** Most rows returned (default 500); more are reported as `truncated`. */
	maxRows?: number;
	/** Interrupt the query after this long (default 10 000 ms). */
	timeoutMs?: number;
}

export interface SandboxedQueryResult {
	columns: string[];
	rows: Record<string, unknown>[];
	/** True when the query had more rows than `maxRows`. */
	truncated: boolean;
}

/**
 * Run one (or several `;`-separated) statement(s) against `dbPath` in the sandbox and return the last
 * statement's rows. Rejects with DuckDB's own error for anything the sandbox refuses, and with
 * `Query timed out after Ns` when the timeout interrupts it. Never creates `dbPath`.
 */
export async function runSandboxedQuery(
	dbPath: string,
	sql: string,
	opts: SandboxedQueryOptions = {},
): Promise<SandboxedQueryResult> {
	const maxRows = opts.maxRows ?? QUERY_MAX_ROWS;
	const timeoutMs = opts.timeoutMs ?? QUERY_TIMEOUT_MS;

	const instance = await DuckDBInstance.create(dbPath, SANDBOX);
	try {
		const connection = await instance.connect();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			connection.interrupt();
		}, timeoutMs);
		try {
			// Streams chunk by chunk and stops once there is one row past the cap, so an unbounded result
			// is never read in full (at most one ~2048-row chunk beyond it).
			const reader = await connection.streamAndReadUntil(sql, maxRows + 1);
			const rows = reader.getRowObjectsJS();
			return {
				columns: reader.deduplicatedColumnNames(),
				rows: rows.slice(0, maxRows).map((r) => normalizeRow(r)),
				truncated: rows.length > maxRows,
			};
		} catch (e) {
			if (timedOut) {
				throw new Error(`Query timed out after ${timeoutMs / 1000}s`);
			}
			throw e;
		} finally {
			clearTimeout(timer);
			connection.disconnectSync();
		}
	} finally {
		instance.closeSync();
	}
}

/**
 * Every table and view in the DB with its columns and types, one per line —
 * `transactions: txn_id VARCHAR, txn_date DATE, …`, views marked `(view)`. Read through the same sandbox.
 */
export async function describeSchema(dbPath: string): Promise<string> {
	const { rows } = await runSandboxedQuery(
		dbPath,
		`SELECT c.table_name, t.table_type, c.column_name, c.data_type
		FROM information_schema.columns c
		JOIN information_schema.tables t
			ON t.table_catalog = c.table_catalog AND t.table_schema = c.table_schema AND t.table_name = c.table_name
		WHERE c.table_catalog = current_database() AND c.table_schema = 'main'
		ORDER BY c.table_name, c.ordinal_position`,
		{ maxRows: 10_000 },
	);
	const tables = new Map<string, { view: boolean; columns: string[] }>();
	for (const row of rows) {
		const name = String(row.table_name);
		let table = tables.get(name);
		if (!table) {
			table = { view: row.table_type === "VIEW", columns: [] };
			tables.set(name, table);
		}
		table.columns.push(`${row.column_name} ${row.data_type}`);
	}
	return [...tables]
		.map(
			([name, t]) =>
				`${name}${t.view ? " (view)" : ""}: ${t.columns.join(", ")}`,
		)
		.join("\n");
}
