import { existsSync } from "node:fs";
import {
	describeSchema,
	QUERY_CANCELLED,
	QUERY_MAX_ROWS,
	QUERY_TIMEOUT_MS,
	runSandboxedQuery,
	userDuckdbPath,
} from "@money/analytics";
import { ORPCError } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { z } from "zod";

import { LockWaitTimeout, withUserLock } from "../ingest-runner";
import { dataDir } from "../paths";
import {
	type JSONSchema,
	type McpCallContext,
	registerExtraTool,
} from "./tools";

export const QUERY = "query";

const inputSchema = z.object({
	sql: z
		.string()
		.min(1)
		.describe(
			"One DuckDB SELECT (or WITH … SELECT) statement. FROM t, VALUES, DESCRIBE t and SHOW TABLES count as SELECTs.",
		),
});

export interface QueryDeps {
	run: typeof runSandboxedQuery;
	describe: typeof describeSchema;
	/** How long to wait for the user's lock; {@link QUERY_LOCK_WAIT_MS} when unset. For tests. */
	lockWaitMs?: number;
}

/** How long a query waits for the user's ingest lock (an import, a re-tag or their other queries). */
export const QUERY_LOCK_WAIT_MS = 30_000;
const LOCK_BUSY =
	"Query busy: this account's data is being imported, re-tagged or queried; try again in a moment";

const live: QueryDeps = { run: runSandboxedQuery, describe: describeSchema };

/** `text` with the server's own paths replaced so they never reach Claude: the user's DB file, then the data dir. */
function scrub(text: string, dbPath: string): string {
	return text
		.replaceAll(dbPath, "<analytics.duckdb>")
		.replaceAll(dataDir(), "<data dir>");
}

/**
 * {@link scrub} over every string in a result, nested ones included: DuckDB hands the file path back as
 * data (`PRAGMA database_list`, `duckdb_databases()`, `allowed_paths` in `duckdb_settings()`).
 */
function scrubValue(value: unknown, dbPath: string): unknown {
	if (typeof value === "string") return scrub(value, dbPath);
	if (Array.isArray(value)) return value.map((v) => scrubValue(v, dbPath));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [
				scrub(k, dbPath),
				scrubValue(v, dbPath),
			]),
		);
	}
	return value;
}

/**
 * Run Claude's SQL against the caller's own analytics DuckDB, in `@money/analytics`'s sandbox (read-only,
 * one SELECT, in its own process, no file/network/extension access, settings locked, 500 rows, 10 s). Every
 * failure (a refused statement, a syntax error, a timeout, a crashed sandbox) comes back as a tool error
 * carrying its message; an unknown table or column also carries the schema, so the next try can be right.
 *
 * It holds the user's ingest lock while it runs: DuckDB refuses a read-write open while the sandbox holds the
 * file read-only, so without it a query would make that user's import or re-tag fail. Queries and ingests
 * for one user take turns; other users are not held up. A query waits at most {@link QUERY_LOCK_WAIT_MS} for
 * it ("Query busy … try again"); an ingest waits as long as it takes, so a waiting query never fails one.
 *
 * `signal` is the caller's: once it aborts (the MCP client gave up), a query still waiting for the lock or a
 * sandbox slot never starts, and a running one is killed, freeing the lock for the next holder.
 */
export async function runQuery(
	ctx: McpCallContext,
	args: unknown,
	deps: QueryDeps = live,
	signal?: AbortSignal,
) {
	const parsed = inputSchema.safeParse(args ?? {});
	if (!parsed.success) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Input validation failed",
			data: { issues: parsed.error.issues },
		});
	}
	const dbPath = userDuckdbPath(dataDir(), ctx.uid);
	if (!existsSync(dbPath)) {
		throw new ORPCError("NOT_FOUND", {
			message: "No analytics data yet — import a statement first",
		});
	}
	const { sql } = parsed.data;
	const query = async () => {
		try {
			const result = await deps.run(dbPath, sql, { signal });
			return {
				...result,
				columns: result.columns.map((c) => scrub(c, dbPath)),
				rows: scrubValue(result.rows, dbPath) as typeof result.rows,
			};
		} catch (e) {
			let message = scrub(e instanceof Error ? e.message : String(e), dbPath);
			if (message.startsWith("Catalog Error")) {
				try {
					message += `\n\nTables and columns:\n${await deps.describe(dbPath)}`;
				} catch {
					// The original error is what matters; the schema is only a hint.
				}
			}
			throw new ORPCError("BAD_REQUEST", { message });
		}
	};
	try {
		return await withUserLock(ctx.uid, query, {
			maxWaitMs: deps.lockWaitMs ?? QUERY_LOCK_WAIT_MS,
			signal,
		});
	} catch (e) {
		if (e instanceof ORPCError) throw e;
		// Gave up waiting for the lock: it is still held, or the caller is gone.
		throw new ORPCError("BAD_REQUEST", {
			message: e instanceof LockWaitTimeout ? LOCK_BUSY : QUERY_CANCELLED,
		});
	}
}

const DESCRIPTION = [
	"Answer an open question by running one SELECT (or WITH … SELECT) statement, in DuckDB SQL, over this person's own analytics data — the bank statements they imported, categorised. Use it when no other tool already gives the answer.",
	"Main tables: `transactions` — one row per bank-statement posting: txn_id, account_id, txn_date, narration, amount (signed INR: credit/money in +, debit/money out −), balance, month ('YYYY-MM'), fy ('FY2026-27', Indian FY April–March).",
	"`transaction_splits` — how each transaction is categorised: one or more rows per txn_id (seq), amount (signed, sums to the transaction), kind (active_income | passive_income | expense | investment | transfer), category_key → `categories`.key (label, kind). Uncategorised postings are kind 'transfer', category 'uncategorized'. Total by category from the splits, not the transactions.",
	"Views: `v_monthly_kpi` (month, passive_income_cash, expenses as a positive number), `v_coverage_ratio` (the same plus ratio = passive income ÷ expenses, the north-star number), `v_category_monthly` (month, category_key, kind, amount, n).",
	"`axio_expenses` is a separate, advisory spend ledger from the Axio app (amount is a positive magnitude, drcr 'DR'/'CR', its own category labels): never add it to `transactions` — that double-counts. `import_batches` lists the imported files. Holdings are not here (use plan_investments); investment_cashflows and investment_valuations are empty.",
	"For the exact columns run `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'main' ORDER BY table_name, ordinal_position`.",
	`Limits: at most ${QUERY_MAX_ROWS} rows come back (\`truncated: true\` when there were more — aggregate or add LIMIT), and a query is stopped after ${QUERY_TIMEOUT_MS / 1000} s. Run queries one at a time: the server runs only a few at once, and an error starting "Query busy" means try again shortly. Several statements, CALL, EXPLAIN, SET, files, network, ATTACH, extensions and writes are all refused. The result is { columns, rows, truncated }; dates are ISO strings.`,
].join(" ");

const [, json] = new ZodToJsonSchemaConverter().convert(inputSchema, {
	strategy: "input",
});

registerExtraTool({
	name: QUERY,
	description: DESCRIPTION,
	inputSchema: json as JSONSchema,
	kind: "read",
	run: (ctx, args, signal) => runQuery(ctx, args, live, signal),
});
