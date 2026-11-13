import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "money-mcp-query-"));
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";

const { userDuckdbPath } = await import("@money/analytics");
const { ORPCError } = await import("@orpc/server");
const { dataDir } = await import("../paths");
const { extraTools } = await import("./tools");
const { QUERY, QUERY_LOCK_WAIT_MS, runQuery } = await import("./query");
const { runRetag } = await import("../ingest-runner");
await import("./extra-tools");

type Deps = NonNullable<Parameters<typeof runQuery>[2]>;
type Ctx = Parameters<typeof runQuery>[0];

const ctx = (uid: string) =>
	({
		uid,
		user: { id: uid },
		via: { scope: "read" },
	}) as unknown as Ctx;

/** Make the user's analytics file exist; the fake runner never opens it. */
function seedFile(uid: string): string {
	const path = userDuckdbPath(dataDir(), uid);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, "");
	return path;
}

const ok = { columns: ["n"], rows: [{ n: 1 }], truncated: false };

async function failure(p: Promise<unknown>) {
	try {
		await p;
	} catch (e) {
		return e;
	}
	throw new Error("expected the call to fail");
}

describe("query tool", () => {
	test("is registered as a read tool taking { sql }", () => {
		const tool = extraTools().find((t) => t.name === QUERY);
		expect(tool).toBeDefined();
		expect(tool?.kind).toBe("read");
		expect(tool?.inputSchema.type).toBe("object");
		expect(tool?.inputSchema.required).toEqual(["sql"]);
	});

	test("the description names the real tables, the sign convention and the limits", () => {
		const d = extraTools().find((t) => t.name === QUERY)?.description ?? "";
		for (const word of [
			"transactions",
			"transaction_splits",
			"categories",
			"v_monthly_kpi",
			"v_coverage_ratio",
			"v_category_monthly",
			"axio_expenses",
			"information_schema.columns",
			"one SELECT (or WITH … SELECT) statement",
			"INR",
			"500",
			"10 s",
		]) {
			expect(d).toContain(word);
		}
	});

	test("no analytics file yet → a clear error, and nothing is created", async () => {
		let ran = false;
		const deps: Deps = {
			run: async () => {
				ran = true;
				return ok;
			},
			describe: async () => "",
		};
		const e = await failure(runQuery(ctx("nofile"), { sql: "SELECT 1" }, deps));
		expect(e).toBeInstanceOf(ORPCError);
		expect((e as Error).message).toBe(
			"No analytics data yet — import a statement first",
		);
		expect(ran).toBe(false);
	});

	test("runs the SQL against the caller's own DuckDB and returns the result", async () => {
		const path = seedFile("u-run");
		const seen: Array<[string, string]> = [];
		const deps: Deps = {
			run: async (p, sql) => {
				seen.push([p, sql]);
				return { columns: ["n"], rows: [{ n: 1 }], truncated: true };
			},
			describe: async () => "",
		};
		const result = await runQuery(ctx("u-run"), { sql: "SELECT 1 AS n" }, deps);
		expect(seen).toEqual([[path, "SELECT 1 AS n"]]);
		expect(result).toEqual({
			columns: ["n"],
			rows: [{ n: 1 }],
			truncated: true,
		});
	});

	test("empty or missing sql is a validation error", async () => {
		seedFile("u-bad");
		const deps: Deps = { run: async () => ok, describe: async () => "" };
		for (const args of [{}, { sql: "" }, { sql: 1 }]) {
			const e = await failure(runQuery(ctx("u-bad"), args, deps));
			expect(e).toBeInstanceOf(ORPCError);
			expect((e as InstanceType<typeof ORPCError>).code).toBe("BAD_REQUEST");
		}
	});

	test("a DuckDB refusal comes back as a tool error with DuckDB's message, without the server path", async () => {
		const path = seedFile("u-refuse");
		const deps: Deps = {
			run: async () => {
				throw new Error(
					`IO Error: Could not set lock on file "${path}": Conflicting lock is held`,
				);
			},
			describe: async () => "",
		};
		const e = await failure(
			runQuery(ctx("u-refuse"), { sql: "SELECT 1" }, deps),
		);
		expect(e).toBeInstanceOf(ORPCError);
		const msg = (e as Error).message;
		expect(msg).toContain("IO Error: Could not set lock on file");
		expect(msg).not.toContain(dataDir());
		expect(msg).toContain("analytics.duckdb");
	});

	test("the server's paths in result values (PRAGMA database_list, duckdb_settings()) are replaced", async () => {
		const path = seedFile("u-paths");
		const dir = dataDir();
		const deps: Deps = {
			run: async () => ({
				columns: ["name", "file", path],
				rows: [
					{
						name: "analytics",
						file: path,
						allowed: `[${path}.wal.recovery, ${path}.wal.checkpoint]`,
						other: `${dir}/control.db`,
						nested: { list: [path, 3], keep: "Groceries" },
						n: 7,
						none: null,
					},
				],
				truncated: false,
			}),
			describe: async () => "",
		};
		const result = await runQuery(
			ctx("u-paths"),
			{ sql: "PRAGMA database_list" },
			deps,
		);
		expect(JSON.stringify(result)).not.toContain(dir);
		expect(result).toEqual({
			columns: ["name", "file", "<analytics.duckdb>"],
			rows: [
				{
					name: "analytics",
					file: "<analytics.duckdb>",
					allowed:
						"[<analytics.duckdb>.wal.recovery, <analytics.duckdb>.wal.checkpoint]",
					other: "<data dir>/control.db",
					nested: { list: ["<analytics.duckdb>", 3], keep: "Groceries" },
					n: 7,
					none: null,
				},
			],
			truncated: false,
		});
	});

	test("a timeout is reported as such", async () => {
		seedFile("u-slow");
		const deps: Deps = {
			run: async () => {
				throw new Error("Query timed out after 10s");
			},
			describe: async () => "",
		};
		const e = await failure(runQuery(ctx("u-slow"), { sql: "SELECT 1" }, deps));
		expect((e as Error).message).toBe("Query timed out after 10s");
	});

	test("an unknown table or column appends the schema so Claude can correct the query", async () => {
		seedFile("u-catalog");
		const deps: Deps = {
			run: async () => {
				throw new Error("Catalog Error: Table with name txns does not exist!");
			},
			describe: async () => "transactions: txn_id VARCHAR",
		};
		const e = await failure(
			runQuery(ctx("u-catalog"), { sql: "SELECT * FROM txns" }, deps),
		);
		const msg = (e as Error).message;
		expect(msg).toStartWith(
			"Catalog Error: Table with name txns does not exist!",
		);
		expect(msg).toContain("transactions: txn_id VARCHAR");
	});

	test("a failure to describe the schema still reports the original error", async () => {
		seedFile("u-catalog2");
		const deps: Deps = {
			run: async () => {
				throw new Error("Catalog Error: Table with name x does not exist!");
			},
			describe: async () => {
				throw new Error("boom");
			},
		};
		const e = await failure(
			runQuery(ctx("u-catalog2"), { sql: "SELECT * FROM x" }, deps),
		);
		expect((e as Error).message).toBe(
			"Catalog Error: Table with name x does not exist!",
		);
	});

	describe("takes turns with ingests for the same user", () => {
		type Spawner = NonNullable<Parameters<typeof runRetag>[1]>;

		/** A promise and the function that settles it, so a test decides when a run finishes. */
		function gate() {
			let open!: () => void;
			const opened = new Promise<void>((resolve) => {
				open = resolve;
			});
			return { opened, open };
		}

		/** Lets every already-queued promise callback run. */
		const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

		/**
		 * A query runner and an ingest spawner that log when each starts and ends. Each ends only when the test
		 * opens its gate, so the order of events never depends on timing.
		 */
		function recorders(
			opts: { queryFails?: boolean; lockWaitMs?: number } = {},
		) {
			const events: string[] = [];
			const query = gate();
			const retag = gate();
			const deps: Deps = {
				run: async () => {
					events.push("query:start");
					await query.opened;
					events.push("query:end");
					if (opts.queryFails) throw new Error("Query timed out after 10s");
					return ok;
				},
				describe: async () => "",
				lockWaitMs: opts.lockWaitMs,
			};
			const spawner: Spawner = async () => {
				events.push("retag:start");
				await retag.opened;
				events.push("retag:end");
				return { ok: true, result: null, stdout: "", stderr: "", exitCode: 0 };
			};
			return { events, deps, spawner, query, retag };
		}

		test("waits at most 30 s for the lock", () => {
			expect(QUERY_LOCK_WAIT_MS).toBe(30_000);
		});

		test("a retag asked for during a query waits for it to finish", async () => {
			seedFile("u-lock1");
			const { events, deps, spawner, query, retag } = recorders();
			const q = runQuery(ctx("u-lock1"), { sql: "SELECT 1" }, deps);
			await flush();
			const r = runRetag("u-lock1", spawner);
			retag.open();
			await flush();
			expect(events).toEqual(["query:start"]);
			query.open();
			await Promise.all([q, r]);
			expect(events).toEqual([
				"query:start",
				"query:end",
				"retag:start",
				"retag:end",
			]);
		});

		test("a query asked for during a retag waits for it to finish", async () => {
			seedFile("u-lock2");
			const { events, deps, spawner, query, retag } = recorders();
			const r = runRetag("u-lock2", spawner);
			await flush();
			const q = runQuery(ctx("u-lock2"), { sql: "SELECT 1" }, deps);
			query.open();
			await flush();
			expect(events).toEqual(["retag:start"]);
			retag.open();
			await Promise.all([r, q]);
			expect(events).toEqual([
				"retag:start",
				"retag:end",
				"query:start",
				"query:end",
			]);
		});

		test("a failed query still lets the retag run, once it has finished", async () => {
			seedFile("u-lock3");
			const { events, deps, spawner, query, retag } = recorders({
				queryFails: true,
			});
			const q = runQuery(ctx("u-lock3"), { sql: "SELECT 1" }, deps);
			await flush();
			const r = runRetag("u-lock3", spawner);
			retag.open();
			await flush();
			expect(events).toEqual(["query:start"]);
			query.open();
			const [qr, rr] = await Promise.allSettled([q, r]);
			expect(qr.status).toBe("rejected");
			expect(rr.status).toBe("fulfilled");
			expect(events).toEqual([
				"query:start",
				"query:end",
				"retag:start",
				"retag:end",
			]);
		});

		test("another user's retag does not wait", async () => {
			seedFile("u-lock4");
			const { events, deps, spawner, query, retag } = recorders();
			const q = runQuery(ctx("u-lock4"), { sql: "SELECT 1" }, deps);
			await flush();
			retag.open();
			await runRetag("someone-else", spawner);
			expect(events).toEqual(["query:start", "retag:start", "retag:end"]);
			query.open();
			await q;
			expect(events.at(-1)).toBe("query:end");
		});

		test("a query that waits too long for the lock gives up as busy and never runs; the retag is unaffected", async () => {
			seedFile("u-lock5");
			const { events, deps, spawner, retag } = recorders({ lockWaitMs: 20 });
			const r = runRetag("u-lock5", spawner);
			const e = await failure(
				runQuery(ctx("u-lock5"), { sql: "SELECT 1" }, deps),
			);
			expect(e).toBeInstanceOf(ORPCError);
			expect((e as Error).message).toStartWith("Query busy");
			expect((e as Error).message).toContain("try again");
			retag.open();
			expect((await r).ok).toBe(true);
			await flush();
			expect(events).toEqual(["retag:start", "retag:end"]);
		});

		test("a query whose caller has gone while it waited never runs", async () => {
			seedFile("u-lock6");
			const { events, deps, spawner, retag } = recorders();
			const r = runRetag("u-lock6", spawner);
			const controller = new AbortController();
			const q = failure(
				runQuery(ctx("u-lock6"), { sql: "SELECT 1" }, deps, controller.signal),
			);
			controller.abort();
			expect(await q).toBeInstanceOf(ORPCError);
			retag.open();
			await r;
			await flush();
			expect(events).toEqual(["retag:start", "retag:end"]);
		});

		test("the caller's signal reaches the sandbox, so a query it gives up on mid-run is stopped", async () => {
			seedFile("u-lock7");
			let seen: AbortSignal | undefined;
			const deps: Deps = {
				run: async (_path, _sql, opts) => {
					seen = opts?.signal;
					return ok;
				},
				describe: async () => "",
			};
			const controller = new AbortController();
			await runQuery(
				ctx("u-lock7"),
				{ sql: "SELECT 1" },
				deps,
				controller.signal,
			);
			expect(seen).toBe(controller.signal);
		});
	});
});
