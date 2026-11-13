import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
	SandboxRequest,
	SandboxResponse,
	SandboxResult,
} from "./sandboxed-query-worker";

/**
 * Untrusted, read-only SQL over one analytics DB, for SQL an AI wrote (the MCP `query` tool).
 *
 * Two layers. Each query runs in a fresh child process (`sandboxed-query-worker.ts`) with its own DuckDB
 * instance, sandboxed and locked (see that file). The child accepts one SELECT statement only, caps rows by
 * streaming, and interrupts itself at the timeout. This process only spawns the child, kills it if it
 * outlives the timeout, and turns any failure, including a crash that aborts the child, into a rejection.
 * No query can take the server down or leave anything running after it. At most two children run at once
 * across the server; the rest queue (see {@link MAX_CONCURRENT_QUERIES}).
 */

export const QUERY_MAX_ROWS = 500;
export const QUERY_TIMEOUT_MS = 10_000;
/** How long past its timeout a child gets to interrupt itself and report before it is killed. */
const KILL_GRACE_MS = 2_000;

const WORKER_PATH = fileURLToPath(
	new URL("./sandboxed-query-worker.ts", import.meta.url),
);

export const SANDBOX_CRASHED = "Query crashed the sandbox and was stopped";
const TOO_LARGE = "Query result is too large; select fewer or narrower columns";
/** A 500-row answer is far below this; a bigger one is stopped rather than buffered. */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

/**
 * How many sandbox children may run at once, across the whole server. Each is a Bun process (~100 MB) plus a
 * DuckDB allowed 1 GB, Claude Code makes tool calls in parallel, and several users may hold tokens, on a
 * shared VPS. Later callers queue.
 */
export const MAX_CONCURRENT_QUERIES = 2;
/** How long a query may wait in that queue before it gives up with {@link QUERY_BUSY}. */
export const QUERY_QUEUE_WAIT_MS = 30_000;
export const QUERY_BUSY =
	"Query busy: other queries are running; try again in a moment";

/**
 * A counting semaphore with a cap on how long a caller waits. `acquire()` resolves with a release function
 * once a slot is free (waiters are served in order), or rejects with {@link QUERY_BUSY} after `maxWaitMs`.
 * Releasing more than once is harmless.
 */
export class QuerySlots {
	private active = 0;
	private readonly waiting: Array<() => void> = [];

	constructor(
		private readonly max: number,
		private readonly maxWaitMs: number,
	) {}

	acquire(): Promise<() => void> {
		if (this.active < this.max) {
			this.active++;
			return Promise.resolve(this.releaser());
		}
		return new Promise((resolve, reject) => {
			const grant = () => {
				clearTimeout(timer);
				resolve(this.releaser());
			};
			const timer = setTimeout(() => {
				const i = this.waiting.indexOf(grant);
				if (i >= 0) this.waiting.splice(i, 1);
				reject(new Error(QUERY_BUSY));
			}, this.maxWaitMs);
			this.waiting.push(grant);
		});
	}

	/** Hands the slot to the next waiter, if any (so `active` is unchanged), or returns it to the pool. */
	private releaser(): () => void {
		let released = false;
		return () => {
			if (released) return;
			released = true;
			const next = this.waiting.shift();
			if (next) next();
			else this.active--;
		};
	}
}

const slots = new QuerySlots(MAX_CONCURRENT_QUERIES, QUERY_QUEUE_WAIT_MS);

export interface SandboxedQueryOptions {
	/** Most rows returned (default 500); more are reported as `truncated`. */
	maxRows?: number;
	/** Stop the query after this long (default 10 000 ms). */
	timeoutMs?: number;
}

export type SandboxedQueryResult = SandboxResult;

const timedOut = (timeoutMs: number) =>
	new Error(`Query timed out after ${timeoutMs / 1000}s`);

/**
 * Run `request` in a child process running `workerPath`, and kill it after `killAfterMs`. Resolves with the
 * child's result. Rejects with the child's error message; "Query timed out after Ns" if it had to be
 * killed; a too-large error if its answer passes 32 MB; {@link QUERY_BUSY} if no slot came free in time (see
 * {@link MAX_CONCURRENT_QUERIES}); or {@link SANDBOX_CRASHED} if it exited abnormally or wrote no valid
 * response. Never throws anything else. The kill timer starts when the child does, not while it queues.
 * Exported for tests, which point it at stub workers.
 */
export async function runInSandboxProcess(
	workerPath: string,
	request: SandboxRequest,
	killAfterMs: number,
): Promise<SandboxedQueryResult> {
	const release = await slots.acquire();
	try {
		return await spawnSandbox(workerPath, request, killAfterMs);
	} finally {
		release();
	}
}

function spawnSandbox(
	workerPath: string,
	request: SandboxRequest,
	killAfterMs: number,
): Promise<SandboxedQueryResult> {
	return new Promise((resolve, reject) => {
		// Through `sh` only to turn core dumps off: a child that aborts must not write a core file per query.
		// The child needs no secrets, so it gets an empty environment, not the server's.
		const child = spawn(
			"/bin/sh",
			["-c", 'ulimit -c 0; exec "$0" "$1"', process.execPath, workerPath],
			{ env: {}, stdio: ["pipe", "pipe", "pipe"] },
		);
		const stdout: Buffer[] = [];
		let stdoutBytes = 0;
		let stderr = "";
		let failure: Error | undefined;
		const stop = (error: Error) => {
			failure ??= error;
			child.kill("SIGKILL");
		};
		const timer = setTimeout(
			() => stop(timedOut(request.timeoutMs)),
			killAfterMs,
		);

		child.stdout.on("data", (chunk: Buffer) => {
			stdoutBytes += chunk.length;
			if (stdoutBytes > MAX_RESPONSE_BYTES) {
				stop(new Error(TOO_LARGE));
				return;
			}
			stdout.push(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr = (stderr + chunk.toString()).slice(-2000);
		});
		// A child that exits before reading its request makes these error; its exit status says why.
		child.stdin.on("error", () => {});
		child.on("error", (e) => stop(e));
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			if (failure) return reject(failure);
			let response: SandboxResponse | undefined;
			if (code === 0) {
				try {
					response = JSON.parse(
						Buffer.concat(stdout).toString("utf8"),
					) as SandboxResponse;
				} catch {
					response = undefined;
				}
			}
			if (!response || typeof response !== "object" || !("ok" in response)) {
				console.error(
					`[analytics] sandboxed query exited abnormally (code ${code}, signal ${signal}):`,
					stderr,
				);
				return reject(new Error(SANDBOX_CRASHED));
			}
			if (!response.ok) return reject(new Error(response.error));
			resolve(response.result);
		});

		child.stdin.end(JSON.stringify(request));
	});
}

/**
 * Run ONE SELECT statement (or `WITH … SELECT`) against `dbPath` in an isolated, sandboxed child process.
 * Returns at most `maxRows` rows, with `truncated` set when there were more. Rejects with DuckDB's own
 * error for anything the sandbox refuses, "query accepts one SELECT …" for anything that is not a single
 * SELECT, "Query timed out after Ns" at the timeout, {@link QUERY_BUSY} if it waited too long for a slot,
 * and {@link SANDBOX_CRASHED} if the query brought the child down. Never creates `dbPath`.
 */
export async function runSandboxedQuery(
	dbPath: string,
	sql: string,
	opts: SandboxedQueryOptions = {},
): Promise<SandboxedQueryResult> {
	const timeoutMs = opts.timeoutMs ?? QUERY_TIMEOUT_MS;
	return runInSandboxProcess(
		WORKER_PATH,
		{ dbPath, sql, maxRows: opts.maxRows ?? QUERY_MAX_ROWS, timeoutMs },
		timeoutMs + KILL_GRACE_MS,
	);
}

/** What `describeSchema` last read for each DB file, and the version of the file it read it from. */
const schemas = new Map<string, { version: string; schema: string }>();

/**
 * A DB file's version: the modified time and size of the file and of its WAL. An ingest rewrites the file in
 * place, and closing it checkpoints the WAL into it, so any change to the schema changes this.
 */
function fileVersion(dbPath: string): string {
	return [dbPath, `${dbPath}.wal`]
		.map((path) => {
			try {
				const s = statSync(path);
				return `${s.mtimeMs}:${s.size}`;
			} catch {
				return "-";
			}
		})
		.join("|");
}

/**
 * Every table and view in the DB with its columns and types, one per line:
 * `transactions: txn_id VARCHAR, txn_date DATE, …`, with views marked `(view)`. Read through the same sandbox,
 * once per version of the file (see {@link fileVersion}): the schema only changes when an ingest rewrites it.
 * A failed read is not remembered. `run` is for tests.
 */
export async function describeSchema(
	dbPath: string,
	run: typeof runSandboxedQuery = runSandboxedQuery,
): Promise<string> {
	// Taken before the read, so a file that changes during it is read again next time.
	const version = fileVersion(dbPath);
	const cached = schemas.get(dbPath);
	if (cached?.version === version) return cached.schema;
	const { rows } = await run(
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
	const schema = [...tables]
		.map(
			([name, t]) =>
				`${name}${t.view ? " (view)" : ""}: ${t.columns.join(", ")}`,
		)
		.join("\n");
	schemas.set(dbPath, { version, schema });
	return schema;
}
