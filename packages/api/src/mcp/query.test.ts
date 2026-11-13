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
const { QUERY, runQuery } = await import("./query");
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
});
