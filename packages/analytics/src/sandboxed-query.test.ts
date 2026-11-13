import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { openConnection } from "./duckdb";
import { describeSchema, runSandboxedQuery } from "./index";
import { runInSandboxProcess, SANDBOX_CRASHED } from "./sandboxed-query";
import { ONE_SELECT, SANDBOX_OPTIONS } from "./sandboxed-query-worker";

let dir: string;
let dbPath: string;

/** Test-only fixture: a small analytics DB, written once through this package's own read-write opener. */
async function buildFixture(path: string): Promise<void> {
	const db = await openConnection(path, "read_write");
	try {
		await db.run(
			"CREATE TABLE transactions (txn_id VARCHAR PRIMARY KEY, txn_date DATE NOT NULL, amount DECIMAL(18, 2) NOT NULL, narration VARCHAR)",
		);
		await db.run(
			"INSERT INTO transactions VALUES ('a', DATE '2026-04-01', -120.50, 'Groceries'), ('b', DATE '2026-04-02', 5000, 'Interest')",
		);
		await db.run(
			"CREATE TABLE numbers AS SELECT range::INTEGER AS n FROM range(1000)",
		);
		await db.run(
			"CREATE VIEW v_spend AS SELECT txn_date, -amount AS spent FROM transactions WHERE amount < 0",
		);
	} finally {
		await db.close();
	}
}

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), "money-sandboxed-query-"));
	dbPath = join(dir, "analytics.duckdb");
	await buildFixture(dbPath);
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

const external = /disabled (by|through) configuration/;

describe("runSandboxedQuery", () => {
	test("a SELECT returns JSON-safe rows and the column names", async () => {
		const result = await runSandboxedQuery(
			dbPath,
			"SELECT txn_id, txn_date, amount, count(*) OVER () AS n FROM transactions ORDER BY txn_id",
		);
		expect(result.columns).toEqual(["txn_id", "txn_date", "amount", "n"]);
		expect(result.truncated).toBe(false);
		expect(result.rows).toEqual([
			{
				txn_id: "a",
				txn_date: "2026-04-01T00:00:00.000Z",
				amount: -120.5,
				n: 2,
			},
			{ txn_id: "b", txn_date: "2026-04-02T00:00:00.000Z", amount: 5000, n: 2 },
		]);
	});

	test("views are readable", async () => {
		const result = await runSandboxedQuery(dbPath, "SELECT spent FROM v_spend");
		expect(result.rows).toEqual([{ spent: 120.5 }]);
	});

	test("1 000 rows come back as the first 500, marked truncated", async () => {
		const result = await runSandboxedQuery(
			dbPath,
			"SELECT n FROM numbers ORDER BY n",
		);
		expect(result.rows).toHaveLength(500);
		expect(result.rows[0]).toEqual({ n: 0 });
		expect(result.rows[499]).toEqual({ n: 499 });
		expect(result.truncated).toBe(true);
	});

	test("exactly the row cap is not truncated; maxRows is honoured", async () => {
		const exact = await runSandboxedQuery(
			dbPath,
			"SELECT n FROM numbers WHERE n < 500",
		);
		expect(exact.rows).toHaveLength(500);
		expect(exact.truncated).toBe(false);

		const small = await runSandboxedQuery(dbPath, "SELECT n FROM numbers", {
			maxRows: 10,
		});
		expect(small.rows).toHaveLength(10);
		expect(small.truncated).toBe(true);
	});

	test("an unbounded result is capped without reading it all", async () => {
		const started = Date.now();
		const result = await runSandboxedQuery(
			dbPath,
			"SELECT range AS n FROM range(10000000000)",
		);
		expect(result.rows).toHaveLength(500);
		expect(result.truncated).toBe(true);
		expect(Date.now() - started).toBeLessThan(2000);
	});

	const selectEscapes: Array<[string, string]> = [
		["SELECT * FROM read_csv('/etc/passwd')", "reads a file"],
		["SELECT * FROM read_text('/etc/hostname')", "reads a file as text"],
		["SELECT * FROM glob('/etc/*')", "lists files"],
		[
			"FROM read_parquet('https://example.com/x.parquet')",
			"reaches the network",
		],
	];
	for (const [sql, what] of selectEscapes) {
		test(`refuses a SELECT that ${what}: ${sql}`, async () => {
			await expect(runSandboxedQuery(dbPath, sql)).rejects.toThrow(external);
		});
	}

	const notOneSelect: Array<[string, string]> = [
		["ATTACH ':memory:' AS x", "attaches a database"],
		["INSTALL httpfs", "installs an extension"],
		["LOAD httpfs", "loads an extension"],
		["SET enable_external_access=true", "re-enables external access"],
		["RESET enable_external_access", "resets a setting"],
		["CREATE TABLE t(a int)", "creates a table"],
		["CREATE TEMP TABLE t AS SELECT 1", "creates a temp table"],
		["INSERT INTO numbers VALUES (1)", "inserts a row"],
		["CHECKPOINT", "checkpoints"],
		["EXPLAIN ANALYZE SELECT 1", "explains a query"],
		["CALL duckdb_tables()", "calls a table function"],
		[
			"CALL enable_logging(storage='file', storage_path='/tmp/zz')",
			"turns on file logging",
		],
		["SELECT 1; SELECT 2", "is two statements"],
		[
			"CALL enable_logging(storage='file', storage_path='/tmp/zz'); SELECT 1 AS a",
			"is the batch that used to abort the server",
		],
		["", "is empty"],
		[" ; ", "has no statement"],
	];
	for (const [sql, what] of notOneSelect) {
		test(`refuses anything but one SELECT: a statement that ${what}`, async () => {
			await expect(runSandboxedQuery(dbPath, sql)).rejects.toThrow(ONE_SELECT);
		});
	}

	test("WITH … SELECT and DuckDB's SELECT shorthands are accepted", async () => {
		for (const sql of [
			"WITH a AS (SELECT 1 AS n) SELECT n FROM a",
			"FROM numbers LIMIT 1",
			"VALUES (1)",
			"DESCRIBE transactions",
			"SELECT 1;",
		]) {
			const result = await runSandboxedQuery(dbPath, sql);
			expect(result.rows.length).toBeGreaterThan(0);
		}
	});

	test("the instance runs with 2 threads, external access off and its configuration locked", async () => {
		const result = await runSandboxedQuery(
			dbPath,
			"SELECT current_setting('threads') AS threads, current_setting('enable_external_access') AS external, current_setting('lock_configuration') AS locked, current_setting('access_mode') AS mode",
		);
		expect(result.rows).toEqual([
			{ threads: 2, external: false, locked: true, mode: "read_only" },
		]);
	});

	test("file logging turned on from inside a SELECT can't take this process down", async () => {
		const sql =
			"SELECT * FROM enable_logging(storage='file', storage_path='/tmp/zz', level='trace') UNION ALL SELECT NULL FROM range(100000)";
		await runSandboxedQuery(dbPath, sql).catch((e: Error) => e);
		const after = await runSandboxedQuery(dbPath, "SELECT 1 AS ok");
		expect(after.rows).toEqual([{ ok: 1 }]);
	});

	test("a COPY is refused (DuckDB refuses it while preparing) and leaves no file behind", async () => {
		const target = join(dir, "leak.csv");
		await expect(
			runSandboxedQuery(dbPath, `COPY (SELECT 1) TO '${target}'`),
		).rejects.toThrow(external);
		expect(existsSync(target)).toBe(false);
	});

	test("the table is unchanged after the refused writes", async () => {
		const result = await runSandboxedQuery(
			dbPath,
			"SELECT count(*) AS n FROM numbers",
		);
		expect(result.rows).toEqual([{ n: 1000 }]);
	});

	test("a syntax error rejects with DuckDB's message", async () => {
		await expect(runSandboxedQuery(dbPath, "SELEC 1")).rejects.toThrow(
			/syntax error/i,
		);
	});

	test("an endless recursive CTE is interrupted at the timeout", async () => {
		const started = Date.now();
		await expect(
			runSandboxedQuery(
				dbPath,
				"WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT count(*) FROM r",
				{ timeoutMs: 300 },
			),
		).rejects.toThrow("Query timed out after 0.3s");
		expect(Date.now() - started).toBeLessThan(3000);
	});

	test("the next query runs after a timeout", async () => {
		const result = await runSandboxedQuery(dbPath, "SELECT 1 AS ok");
		expect(result.rows).toEqual([{ ok: 1 }]);
	});

	test("a missing database file is refused, not created", async () => {
		const missing = join(dir, "nope.duckdb");
		await expect(runSandboxedQuery(missing, "SELECT 1")).rejects.toThrow();
		expect(existsSync(missing)).toBe(false);
	});
});

describe("the sandbox process", () => {
	const fixture = (name: string) =>
		fileURLToPath(new URL(`./testing/${name}`, import.meta.url));
	const request = (timeoutMs = 10_000) => ({
		dbPath,
		sql: "SELECT 1",
		maxRows: 500,
		timeoutMs,
	});

	test("a DuckDB abort in the child (the old crash batch) is an error here, and this process lives on", async () => {
		await expect(
			runInSandboxProcess(fixture("crash-worker.ts"), request(), 10_000),
		).rejects.toThrow(SANDBOX_CRASHED);
		const after = await runSandboxedQuery(dbPath, "SELECT 1 AS ok");
		expect(after.rows).toEqual([{ ok: 1 }]);
	});

	test("a child that ignores its timeout is killed", async () => {
		const started = Date.now();
		await expect(
			runInSandboxProcess(fixture("hang-worker.ts"), request(100), 300),
		).rejects.toThrow("Query timed out after 0.1s");
		expect(Date.now() - started).toBeLessThan(2000);
	});

	test("an answer too large to buffer is stopped", async () => {
		await expect(
			runSandboxedQuery(
				dbPath,
				"SELECT repeat('x', 1000000) AS s FROM range(100)",
			),
		).rejects.toThrow(/too large/);
	});

	test("a child that exits without a valid answer is reported as a crash", async () => {
		await expect(
			runInSandboxProcess(fixture("garbage-worker.ts"), request(), 10_000),
		).rejects.toThrow(SANDBOX_CRASHED);
	});
});

describe("the sandbox's DuckDB settings, on their own", () => {
	// The single-SELECT check refuses these before DuckDB runs them; the settings refuse them anyway.
	const locked = /the configuration has been locked/;
	const readOnly = /read-only mode/;
	const refused: Array<[string, RegExp]> = [
		["SELECT * FROM read_csv('/etc/passwd')", external],
		["ATTACH ':memory:' AS x", readOnly],
		["ATTACH 'other.duckdb' AS x (READ_ONLY)", external],
		["COPY (SELECT 1) TO '/tmp/x.csv'", external],
		["INSTALL httpfs", external],
		["LOAD httpfs", external],
		["SET enable_external_access=true", locked],
		["SET lock_configuration=false", locked],
		["RESET enable_external_access", locked],
		["SET memory_limit='100GB'", locked],
		["SET threads=64", locked],
		["CREATE TABLE t(a int)", readOnly],
		["INSERT INTO numbers VALUES (1)", readOnly],
		["SELECT * FROM glob('/etc/*')", external],
	];
	for (const [sql, reason] of refused) {
		test(`refuses ${sql}`, async () => {
			const instance = await DuckDBInstance.create(dbPath, SANDBOX_OPTIONS);
			const connection = await instance.connect();
			try {
				await expect(connection.runAndReadAll(sql)).rejects.toThrow(reason);
			} finally {
				connection.disconnectSync();
				instance.closeSync();
			}
		});
	}
});

describe("describeSchema", () => {
	test("lists each table and view with its columns and types", async () => {
		const schema = await describeSchema(dbPath);
		expect(schema).toBe(
			[
				"numbers: n INTEGER",
				"transactions: txn_id VARCHAR, txn_date DATE, amount DECIMAL(18,2), narration VARCHAR",
				"v_spend (view): txn_date DATE, spent DECIMAL(18,2)",
			].join("\n"),
		);
	});
});
