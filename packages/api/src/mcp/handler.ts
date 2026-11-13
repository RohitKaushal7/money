import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
	CallToolRequestSchema,
	type CallToolResult,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { ORPCError } from "@orpc/server";

import { controlDb } from "../db";
import { verifyToken } from "../tokens";
import "./extra-tools";
import { MCP_INSTRUCTIONS } from "./instructions";
import {
	buildProcedureTools,
	extraTools,
	type McpCallContext,
	mergeTools,
	type ToolDef,
} from "./tools";

/**
 * Built when the server imports this module, after `./extra-tools` has registered the extras, so a
 * duplicate tool name stops the server at startup rather than surfacing on the first call.
 */
const TOOLS: readonly ToolDef[] = mergeTools(
	buildProcedureTools(),
	extraTools(),
);

function unauthorized(error?: "invalid_token"): Response {
	return Response.json(
		{
			jsonrpc: "2.0",
			error: {
				code: -32001,
				message: "Unauthorized: send a money access token as a Bearer token.",
			},
			id: null,
		},
		{
			status: 401,
			headers: {
				"WWW-Authenticate": error
					? `Bearer realm="money", error="${error}"`
					: 'Bearer realm="money"',
			},
		},
	);
}

const text = (s: string, isError = false): CallToolResult => ({
	content: [{ type: "text", text: s }],
	...(isError ? { isError: true } : {}),
});

/** JSON for a tool result. BigInts (DuckDB counts) become numbers when they fit, else strings. */
const toJson = (value: unknown) =>
	JSON.stringify(value ?? null, (_key, v) =>
		typeof v === "bigint"
			? Number.isSafeInteger(Number(v))
				? Number(v)
				: v.toString()
			: v,
	);

interface Issue {
	message: string;
	path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
}

/** What Claude sees when a tool fails: the oRPC message, plus each validation issue so it can fix the input. */
function errorResult(name: string, e: unknown): CallToolResult {
	if (!(e instanceof ORPCError)) {
		// The same as /rpc: an unexpected failure is logged here and reported without its internals.
		console.error(`[mcp] ${name} failed:`, e);
		return text(`${name} failed: Internal server error`, true);
	}
	const lines = [`${e.code}: ${e.message}`];
	const data = e.data as { issues?: Issue[] } | undefined;
	if (Array.isArray(data?.issues)) {
		for (const issue of data.issues) {
			const where = (issue.path ?? [])
				.map((p) => String(typeof p === "object" ? p.key : p))
				.join(".");
			lines.push(`- ${where || "(input)"}: ${issue.message}`);
		}
	} else if (data !== undefined) {
		lines.push(toJson(data));
	}
	return text(lines.join("\n"), true);
}

/**
 * `requestSignal` is the HTTP request's: it aborts when the client disconnects. Each call also gets the SDK's
 * own per-call signal (a `notifications/cancelled`), and a tool sees either one abort.
 */
function createServer(
	ctx: McpCallContext,
	version: string,
	requestSignal: AbortSignal,
): Server {
	const server = new Server(
		{ name: "money", version },
		{ capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS },
	);
	const tools = TOOLS;

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: tools.map((t) => ({
			name: t.name,
			description: t.description,
			inputSchema: t.inputSchema,
			annotations: { readOnlyHint: t.kind === "read" },
		})),
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
		const { name, arguments: args } = request.params;
		const tool = tools.find((t) => t.name === name);
		if (!tool) {
			throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
		}
		if (tool.kind === "write" && ctx.via.scope !== "read_write") {
			return text(
				`This access token is read-only (scope "${ctx.via.scope}"): ${name} changes data, so it needs a token with scope "read_write". Nothing was changed.`,
				true,
			);
		}
		try {
			const signal = AbortSignal.any([extra.signal, requestSignal]);
			return text(toJson(await tool.run(ctx, args, signal)));
		} catch (e) {
			return errorResult(name, e);
		}
	});

	return server;
}

/**
 * The `/mcp` endpoint. Only a personal access token in `Authorization: Bearer` gets in — a session cookie
 * is never looked at, so a browser can't be steered into calling tools. Stateless: every request gets a
 * fresh server bound to the token's user, so there is no session to hijack or leak between tokens.
 */
export async function handleMcp(
	request: Request,
	opts: { version: string },
): Promise<Response> {
	// Stateless: there is no server-to-client stream to open (GET) or session to end (DELETE). Checked
	// before the token, so a probe that can't be served never counts as a use of it (`last_used_at`).
	if (request.method !== "POST") {
		return new Response(null, { status: 405, headers: { Allow: "POST" } });
	}

	const match = /^Bearer\s+(\S+)\s*$/i.exec(
		request.headers.get("authorization") ?? "",
	);
	if (!match?.[1]) return unauthorized();
	const verified = await verifyToken(controlDb(), match[1]);
	if (!verified) return unauthorized("invalid_token");

	const server = createServer(
		{ uid: verified.user.id, user: verified.user, via: verified.via },
		opts.version,
		request.signal,
	);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	await server.connect(transport);
	try {
		return await transport.handleRequest(request);
	} finally {
		await server.close();
	}
}
