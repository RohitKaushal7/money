import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { migrateLiveControlDb } from "../testing/control-db";

process.env.SKIP_ENV_VALIDATION = "1";
const dir = mkdtempSync(join(tmpdir(), "money-mcp-handler-"));
process.env.DATA_DIR = dir;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";

const { Hono } = await import("hono");
const { RPCHandler } = await import("@orpc/server/fetch");
const { auth } = await import("@money/auth");
const { apiTokens, changeLog, investments } = await import("@money/db");
const { eq } = await import("drizzle-orm");
const { os } = await import("@orpc/server");
const { appRouter } = await import("../routers/index");
const { createContext } = await import("../context");
const { appDbFor, controlDb } = await import("../db");
const { setPin } = await import("../lock");
const { dataDir } = await import("../paths");
const { createToken, revokeToken } = await import("../tokens");
const { buildProcedureTools, contextFor, extraTools, mergeTools, toolName } =
	await import("./tools");
const { createRouterClient } = await import("@orpc/server");
const { handleMcp } = await import("./handler");
const { userDuckdbPath } = await import("@money/analytics");
const { runRetag } = await import("../ingest-runner");

const PASSWORD = "correct-horse-battery";

interface Account {
	uid: string;
	cookie: string;
	rw: string;
	rwId: number;
	read: string;
}

/** A real Better-Auth user, signed in for a real session cookie, with one token of each scope. */
async function account(email: string): Promise<Account> {
	const created = await auth.api.createUser({
		body: { email, name: email, password: PASSWORD, role: "user" },
	});
	const uid = created.user.id;
	const res = await auth.api.signInEmail({
		body: { email, password: PASSWORD },
		asResponse: true,
	});
	const cookie = res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
	const { token: rw, row: rwRow } = await createToken(controlDb(), uid, {
		name: "laptop",
		scope: "read_write",
	});
	const read = (
		await createToken(controlDb(), uid, { name: "viewer", scope: "read" })
	).token;
	return { uid, cookie, rw, rwId: rwRow.id, read };
}

let owner: Account;
let pinned: Account;
let revoked: string;

beforeAll(async () => {
	// The auth and controlDb() singletons may be open on an earlier file's DATA_DIR: follow them, so the users,
	// sessions, tokens and app DBs below land in the databases they actually read.
	await migrateLiveControlDb({ followDataDir: true });
	owner = await account("mcp-owner@x.test");
	pinned = await account("mcp-pinned@x.test");
	const r = await createToken(controlDb(), owner.uid, {
		name: "old",
		scope: "read_write",
	});
	await revokeToken(controlDb(), owner.uid, r.row.id);
	revoked = r.token;
	await setPin(pinned.uid, "1234");
});

let rpcId = 0;
function mcp(
	method: string,
	params: unknown,
	headers: Record<string, string>,
): Promise<Response> {
	return handleMcp(
		new Request("http://localhost:3000/mcp", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				...headers,
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
		}),
		{ version: "9.9.9" },
	);
}
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

interface ToolResult {
	isError?: boolean;
	content: Array<{ type: string; text: string }>;
}
async function callTool(
	token: string,
	name: string,
	args: Record<string, unknown> = {},
): Promise<ToolResult> {
	const res = await mcp("tools/call", { name, arguments: args }, bearer(token));
	expect(res.status).toBe(200);
	const body = (await res.json()) as { result: ToolResult };
	return body.result;
}

const investmentCount = async (uid: string) =>
	(await appDbFor(uid).select().from(investments)).length;
const changes = (uid: string) => appDbFor(uid).select().from(changeLog);

/** The `/*` RPC middleware of apps/server, mounted the same way. */
const rpcHandler = new RPCHandler(appRouter);
const rpcApp = new Hono();
rpcApp.use("/*", async (c, next) => {
	const context = await createContext({ context: c });
	const result = await rpcHandler.handle(c.req.raw, {
		prefix: "/rpc",
		context,
	});
	if (result.matched) return result.response;
	await next();
});
async function rpc(path: string, headers: Record<string, string>) {
	const res = await rpcApp.request(`http://localhost:3000/rpc/${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify({}),
	});
	const body = (await res.json()) as { json?: { code?: string } };
	return { status: res.status, code: body.json?.code };
}

describe("procedure tools", () => {
	const tools = buildProcedureTools();
	const byName = new Map(tools.map((t) => [t.name, t]));

	test("names are snake_case paths", () => {
		expect(toolName(["plan", "updateInvestment"])).toBe(
			"plan_update_investment",
		);
		expect(toolName(["ingest", "retag"])).toBe("ingest_retag");
		expect(toolName(["x", "y"], "customName")).toBe("custom_name");
	});

	test("exposes described procedures with their kind", () => {
		expect(byName.get("plan_update_investment")?.kind).toBe("write");
		expect(byName.get("plan_wealth")?.kind).toBe("read");
		expect(byName.get("plan_wealth")?.inputSchema).toEqual({
			type: "object",
			properties: {},
		});
		const add = byName.get("plan_add_investment");
		expect(add?.inputSchema.type).toBe("object");
		expect(add?.inputSchema.properties).toHaveProperty("name");
	});

	test("never exposes excluded routers or procedures", () => {
		for (const t of tools) {
			expect(t.name).not.toMatch(/^(admin|setup|lock|import|tokens)_/);
		}
		for (const name of [
			"axio_commit_import",
			"axio_remove_import",
			"health_check",
			"private_data",
		]) {
			expect(byName.has(name)).toBe(false);
		}
	});

	test("every tool has an object input schema and a description", () => {
		for (const t of tools) {
			expect(t.inputSchema.type).toBe("object");
			expect(t.description.length).toBeGreaterThan(0);
		}
	});

	test("tool names are unique across procedure and extra tools", () => {
		const names = [...tools, ...extraTools()].map((t) => t.name);
		expect(new Set(names).size).toBe(names.length);
	});

	test("two procedures with the same tool name are refused", () => {
		const described = (name: string) =>
			os
				.$meta<{ mcp?: { description: string; kind: "read"; name?: string } }>(
					{},
				)
				.meta({ mcp: { description: "d", kind: "read", name } })
				.handler(() => null);
		expect(() =>
			buildProcedureTools({
				a: { thing: described("same") },
				b: { other: described("same") },
			}),
		).toThrow(/same.*more than once/);
		expect(() =>
			buildProcedureTools({
				plan: { wealth: described("") },
				planWealth: described(""),
			}),
		).toThrow(/plan_wealth.*more than once/);
	});

	test("a procedure tool and an extra tool with the same name are refused", () => {
		const extra = { ...(tools[0] as (typeof tools)[number]) };
		expect(() => mergeTools(tools, [extra])).toThrow(/more than once/);
		expect(mergeTools(tools, extraTools())).toHaveLength(
			tools.length + extraTools().length,
		);
	});
});

describe("/mcp authentication", () => {
	test("no Authorization header → 401 with a Bearer challenge", async () => {
		const res = await mcp("tools/list", {}, {});
		expect(res.status).toBe(401);
		expect(res.headers.get("WWW-Authenticate")).toStartWith("Bearer");
	});

	test("a real session cookie and no bearer → 401", async () => {
		// The cookie is genuine: Better-Auth resolves it to a session.
		const session = await auth.api.getSession({
			headers: new Headers({ cookie: owner.cookie }),
		});
		expect(session?.user.id).toBe(owner.uid);

		const res = await mcp("tools/list", {}, { Cookie: owner.cookie });
		expect(res.status).toBe(401);
		expect(res.headers.get("WWW-Authenticate")).toStartWith("Bearer");
	});

	test("a revoked token → 401", async () => {
		const res = await mcp("tools/list", {}, bearer(revoked));
		expect(res.status).toBe(401);
	});

	test("a GET with a valid token is 405 and does not count as a use of the token", async () => {
		const { token, row } = await createToken(controlDb(), owner.uid, {
			name: "probe",
			scope: "read",
		});
		const res = await handleMcp(
			new Request("http://localhost:3000/mcp", {
				method: "GET",
				headers: bearer(token),
			}),
			{ version: "9.9.9" },
		);
		expect(res.status).toBe(405);
		expect(res.headers.get("Allow")).toBe("POST");
		const [stored] = await controlDb()
			.select()
			.from(apiTokens)
			.where(eq(apiTokens.id, row.id));
		expect(stored?.lastUsedAt).toBeNull();
	});

	test("an unauthenticated GET is 405 too: the method is checked before the token", async () => {
		const res = await handleMcp(
			new Request("http://localhost:3000/mcp", { method: "GET" }),
			{ version: "9.9.9" },
		);
		expect(res.status).toBe(405);
		expect(res.headers.get("Allow")).toBe("POST");
	});

	test("a malformed or unknown token → 401", async () => {
		expect((await mcp("tools/list", {}, bearer("nope"))).status).toBe(401);
		expect(
			(await mcp("tools/list", {}, bearer(`money_pat_${"x".repeat(43)}`)))
				.status,
		).toBe(401);
		expect(
			(await mcp("tools/list", {}, { Authorization: `Basic ${owner.rw}` }))
				.status,
		).toBe(401);
	});

	test("a token sent to /rpc is not a session → UNAUTHORIZED", async () => {
		// Sanity: the same handler signs the cookie in.
		expect(
			(await rpc("plan/investments", { Cookie: owner.cookie })).status,
		).toBe(200);
		const r = await rpc("plan/investments", bearer(owner.rw));
		expect(r.status).toBe(401);
		expect(r.code).toBe("UNAUTHORIZED");
	});
});

describe("/mcp protocol", () => {
	test("initialize names the server and carries instructions", async () => {
		const res = await mcp(
			"initialize",
			{
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "test", version: "0" },
			},
			bearer(owner.read),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			result: {
				serverInfo: { name: string; version: string };
				instructions: string;
			};
		};
		expect(body.result.serverInfo).toEqual({ name: "money", version: "9.9.9" });
		expect(body.result.instructions).toContain("ingest_retag");
	});

	test("tools/list includes the procedure tools", async () => {
		const res = await mcp("tools/list", {}, bearer(owner.read));
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			result: {
				tools: Array<{ name: string; inputSchema: { type: string } }>;
			};
		};
		const names = body.result.tools.map((t) => t.name);
		expect(names).toContain("plan_update_investment");
		expect(names).toContain("plan_wealth");
	});
});

describe("/mcp tools/call", () => {
	const holding = {
		name: "Bond via MCP",
		type: "bond",
		incomeClass: "income",
		annualRate: 0.1,
		currentValue: 1000,
	};

	test("a read token cannot call a write tool: nothing written, nothing logged", async () => {
		const before = await investmentCount(owner.uid);
		const logged = (await changes(owner.uid)).length;
		const result = await callTool(owner.read, "plan_add_investment", holding);
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("read-only");
		expect(result.content[0]?.text).toContain('"read"');
		expect(await investmentCount(owner.uid)).toBe(before);
		expect(await changes(owner.uid)).toHaveLength(logged);
	});

	test("a read_write token writes, and the change is logged as mcp", async () => {
		const before = await investmentCount(owner.uid);
		const logged = (await changes(owner.uid)).length;
		const result = await callTool(owner.rw, "plan_add_investment", holding);
		expect(result.isError).toBeFalsy();
		const out = JSON.parse(result.content[0]?.text ?? "null") as {
			id: unknown;
		};
		expect(out.id).toBeDefined();
		expect(await investmentCount(owner.uid)).toBe(before + 1);
		const log = await changes(owner.uid);
		expect(log).toHaveLength(logged + 1);
		const entry = log.at(-1);
		expect(entry?.source).toBe("mcp");
		expect(entry?.tokenName).toBe("laptop");
		expect(entry?.tokenId).toBe(owner.rwId);
		expect(entry?.procedure).toBe("plan.addInvestment");
	});

	test("a read token can call a read tool; the result is JSON text", async () => {
		await appDbFor(owner.uid).insert(investments).values({
			name: "Seen by a reader",
			type: "bond",
			incomeClass: "income",
		});
		const result = await callTool(owner.read, "plan_investments");
		expect(result.isError).toBeFalsy();
		expect(result.content).toHaveLength(1);
		expect(result.content[0]?.type).toBe("text");
		const rows = JSON.parse(result.content[0]?.text ?? "null") as Array<{
			name: string;
		}>;
		expect(rows.map((r) => r.name)).toContain("Seen by a reader");
	});

	test("invalid input comes back as a tool error with the oRPC message", async () => {
		const logged = (await changes(owner.uid)).length;
		const result = await callTool(owner.rw, "plan_add_investment", {
			name: 42,
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("Input validation failed");
		expect(await changes(owner.uid)).toHaveLength(logged);
	});

	test("an unknown tool is a protocol error", async () => {
		const res = await mcp(
			"tools/call",
			{ name: "no_such_tool", arguments: {} },
			bearer(owner.rw),
		);
		const body = (await res.json()) as { error?: { message: string } };
		expect(body.error?.message).toContain("no_such_tool");
	});
});

describe("/mcp when the client goes away", () => {
	test("a query still waiting for the user's lock never starts, and the call ends at once", async () => {
		const path = userDuckdbPath(dataDir(), owner.uid);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "");
		// A re-tag holds the user's lock until the test lets it finish.
		let finish!: () => void;
		const held = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const retag = runRetag(owner.uid, async () => {
			await held;
			return { ok: true, result: null, stdout: "", stderr: "", exitCode: 0 };
		});
		const client = new AbortController();
		const call = handleMcp(
			new Request("http://localhost:3000/mcp", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
					...bearer(owner.read),
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: ++rpcId,
					method: "tools/call",
					params: { name: "query", arguments: { sql: "SELECT 1" } },
				}),
				signal: client.signal,
			}),
			{ version: "9.9.9" },
		);
		await new Promise((resolve) => setTimeout(resolve, 20));
		client.abort();
		// Without the request's signal this would wait out the 30 s lock wait.
		const res = await call;
		const body = (await res.json()) as { result: ToolResult };
		expect(body.result.isError).toBe(true);
		expect(body.result.content[0]?.text).toContain("Query cancelled");
		finish();
		await retag;
	});
});

describe("the screen-lock PIN guards browser sessions only", () => {
	test("a cookie session with a PIN set and no unlock pass is LOCKED", async () => {
		const r = await rpc("plan/investments", { Cookie: pinned.cookie });
		expect(r.code).toBe("LOCKED");
	});

	test("a token context has no session row, and can't reach the lock router at all", async () => {
		const tokenCtx = contextFor({
			uid: pinned.uid,
			user: { id: pinned.uid, email: "p", name: "p", role: "user" },
			via: { kind: "token", tokenId: 0, name: "t", scope: "read_write" },
		});
		expect(tokenCtx.session?.session).toBeUndefined();
		const client = createRouterClient(appRouter, { context: tokenCtx });
		await expect(client.lock.claim()).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	test("the same user's token is not behind the lock", async () => {
		const result = await callTool(pinned.read, "plan_investments");
		expect(result.isError).toBeFalsy();
		expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual([]);
	});
});
