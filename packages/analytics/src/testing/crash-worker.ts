/**
 * Test-only stand-in for `sandboxed-query-worker.ts`: runs the batch that makes DuckDB abort its process.
 * With file logging enabled, the next statement's log entry can't be written. DuckDB then throws a
 * PermissionException from a context it can't be caught in (here, closing the instance), and the process
 * gets SIGABRT. This proves a real DuckDB abort in the child is reported, not fatal. It takes the request's
 * `dbPath` and ignores its SQL.
 */
import { DuckDBInstance } from "@duckdb/node-api";
import { SANDBOX_OPTIONS } from "../sandboxed-query-worker";

const req = JSON.parse(await Bun.stdin.text()) as { dbPath: string };
const instance = await DuckDBInstance.create(req.dbPath, SANDBOX_OPTIONS);
const connection = await instance.connect();
try {
	await connection.streamAndReadUntil(
		"CALL enable_logging(storage='file', storage_path='/tmp/money-sandbox-crash'); SELECT 1 AS a",
		501,
	);
} catch {
	// Not where it dies.
}
connection.disconnectSync();
instance.closeSync();
await Bun.write(
	Bun.stdout,
	JSON.stringify({
		ok: true,
		result: { columns: [], rows: [], truncated: false },
	}),
);
