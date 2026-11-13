import { DuckDBInstance, StatementType } from "@duckdb/node-api";
import { normalizeRow } from "./duckdb";

/**
 * The child process that runs one untrusted query for {@link runSandboxedQuery} (`./sandboxed-query`).
 * It reads a {@link SandboxRequest} as JSON on stdin and writes one {@link SandboxResponse} as JSON on stdout.
 * It runs in its own process because some DuckDB failures can't be caught: they abort the whole process,
 * and that process must not be the API server.
 *
 * DuckDB's own sandbox is set when the instance is created and then locked:
 * - `access_mode: read_only`: no table, view or row can be written;
 * - `enable_external_access: false`: no file reads or writes (`read_csv`, `COPY … TO`, `glob`), no
 *   `ATTACH`, no `INSTALL`/`LOAD` of extensions;
 * - `autoinstall_known_extensions` / `autoload_known_extensions: false`: no extension is pulled in implicitly;
 * - `temp_directory: ""`, `memory_limit`, `threads`: nothing spills to disk next to the DB, and memory and
 *   CPU are bounded;
 * - `lock_configuration: true`: no `SET`/`RESET` can loosen any of the above afterwards.
 * On top of that only ONE statement, of type SELECT, is run. DuckDB reports `WITH … SELECT`, `FROM t`,
 * `VALUES`, and the `PRAGMA`/`SHOW`/`DESCRIBE`/`SUMMARIZE` shorthands as SELECT too, since it rewrites
 * them into one. `CALL`, `EXPLAIN`, `SET` and DDL/DML are refused.
 */
export const SANDBOX_OPTIONS: Record<string, string> = {
	// Options are applied in key order. `temp_directory` must come before `enable_external_access`
	// (DuckDB refuses to change it once external access is off), and `lock_configuration` last.
	temp_directory: "",
	access_mode: "read_only",
	enable_external_access: "false",
	autoinstall_known_extensions: "false",
	autoload_known_extensions: "false",
	memory_limit: "1GB",
	threads: "2",
	lock_configuration: "true",
};

export interface SandboxRequest {
	dbPath: string;
	sql: string;
	maxRows: number;
	timeoutMs: number;
}

export interface SandboxResult {
	columns: string[];
	rows: Record<string, unknown>[];
	/** True when the query had more rows than `maxRows`; only the first `maxRows` are in `rows`. */
	truncated: boolean;
}

export type SandboxResponse =
	| { ok: true; result: SandboxResult }
	| { ok: false; error: string };

export const ONE_SELECT =
	"query accepts one SELECT (or WITH … SELECT) statement";

/** "a CREATE statement", "an EXPLAIN statement": the statement type with its article. */
const describeType = (t: StatementType) => {
	const name = (StatementType[t] ?? "unknown").replaceAll("_", " ");
	return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name} statement`;
};

/** Run the request in this process. Rejects with DuckDB's message, a refusal, or a timeout. */
export async function executeSandboxed(
	req: SandboxRequest,
): Promise<SandboxResult> {
	if (/^[\s;]*$/.test(req.sql)) throw new Error(`${ONE_SELECT}; got none`);
	const instance = await DuckDBInstance.create(req.dbPath, SANDBOX_OPTIONS);
	try {
		const connection = await instance.connect();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			connection.interrupt();
		}, req.timeoutMs);
		try {
			const extracted = await connection.extractStatements(req.sql);
			if (extracted.count !== 1) {
				throw new Error(`${ONE_SELECT}; got ${extracted.count}`);
			}
			const prepared = await extracted.prepare(0);
			try {
				if (prepared.statementType !== StatementType.SELECT) {
					throw new Error(
						`${ONE_SELECT}; got ${describeType(prepared.statementType)}`,
					);
				}
				// Streams chunk by chunk and stops once there is one row past the cap, so an unbounded
				// result is never read in full (at most one ~2048-row chunk beyond it).
				const reader = await prepared.streamAndReadUntil(req.maxRows + 1);
				const rows = reader.getRowObjectsJS();
				return {
					columns: reader.deduplicatedColumnNames(),
					rows: rows.slice(0, req.maxRows).map((r) => normalizeRow(r)),
					truncated: rows.length > req.maxRows,
				};
			} finally {
				prepared.destroySync();
			}
		} catch (e) {
			if (timedOut) {
				throw new Error(`Query timed out after ${req.timeoutMs / 1000}s`);
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

/** JSON for the response. Nested BigInts (in lists/structs) become numbers when they fit, else strings. */
const toJson = (value: SandboxResponse) =>
	JSON.stringify(value, (_key, v) =>
		typeof v === "bigint"
			? Number.isSafeInteger(Number(v))
				? Number(v)
				: v.toString()
			: v,
	);

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf8");
}

if (import.meta.main) {
	let response: SandboxResponse;
	try {
		const req = JSON.parse(await readStdin()) as SandboxRequest;
		response = { ok: true, result: await executeSandboxed(req) };
	} catch (e) {
		response = { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
	process.stdout.write(toJson(response), () => process.exit(0));
}
