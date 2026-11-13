import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openConnection } from "./duckdb";
import { describeSchema, runSandboxedQuery } from "./index";

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

	const external = /disabled (by|through) configuration/;
	const locked = /the configuration has been locked/;
	const readOnly = /read-only mode/;
	const refused: Array<[string, string, RegExp]> = [
		["SELECT * FROM read_csv('/etc/passwd')", "reads a file", external],
		["ATTACH ':memory:' AS x", "attaches a database", readOnly],
		["ATTACH 'other.duckdb' AS x (READ_ONLY)", "attaches a file", external],
		["COPY (SELECT 1) TO '/tmp/x.csv'", "writes a file", external],
		["INSTALL httpfs", "installs an extension", external],
		["LOAD httpfs", "loads an extension", external],
		["SET enable_external_access=true", "re-enables external access", locked],
		["SET lock_configuration=false", "unlocks the configuration", locked],
		["RESET enable_external_access", "resets a setting", locked],
		["SET memory_limit='100GB'", "raises the memory limit", locked],
		["CREATE TABLE t(a int)", "creates a table", readOnly],
		["INSERT INTO numbers VALUES (1)", "inserts a row", readOnly],
		["SELECT * FROM glob('/etc/*')", "lists files", external],
	];
	for (const [sql, what, reason] of refused) {
		test(`refuses a statement that ${what}: ${sql}`, async () => {
			await expect(runSandboxedQuery(dbPath, sql)).rejects.toThrow(reason);
		});
	}

	test("a refused statement before a SELECT stops the batch", async () => {
		await expect(
			runSandboxedQuery(
				dbPath,
				"SET enable_external_access=true; SELECT * FROM read_csv('/etc/passwd')",
			),
		).rejects.toThrow(locked);
	});

	test("a refused COPY leaves no file behind", async () => {
		const target = join(dir, "leak.csv");
		await expect(
			runSandboxedQuery(dbPath, `COPY (SELECT 1) TO '${target}'`),
		).rejects.toThrow(/disabled by configuration/);
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

	test("the connection is released after a timeout: the next query runs", async () => {
		const result = await runSandboxedQuery(dbPath, "SELECT 1 AS ok");
		expect(result.rows).toEqual([{ ok: 1 }]);
	});

	test("a missing database file is refused, not created", async () => {
		const missing = join(dir, "nope.duckdb");
		await expect(runSandboxedQuery(missing, "SELECT 1")).rejects.toThrow();
		expect(existsSync(missing)).toBe(false);
	});
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
