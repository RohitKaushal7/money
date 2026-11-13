import { type AnyRouter, createRouterClient } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

import type { Context } from "../context";
import { controlDb } from "../db";
import { appRouter } from "../routers/index";
import type { VerifiedUser } from "../tokens";
import {
	MCP_EXCLUDED_PROCEDURES,
	MCP_EXCLUDED_ROUTERS,
	type McpKind,
	mcpMetaOf,
	type TokenVia,
	walkProcedures,
} from "./meta";

/** A tool's input schema. MCP requires the top level to be an object. */
export interface JSONSchema {
	type: "object";
	properties?: Record<string, unknown>;
	required?: string[];
	[key: string]: unknown;
}

/** Who a tool runs as: the token's user, and the token itself. */
export interface McpCallContext {
	uid: string;
	user: VerifiedUser;
	via: TokenVia;
}

export interface ToolDef {
	name: string;
	description: string;
	inputSchema: JSONSchema;
	kind: McpKind;
	run(ctx: McpCallContext, args: unknown): Promise<unknown>;
}

const snake = (s: string) =>
	s
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.toLowerCase();

/** `["plan", "updateInvestment"]` → `plan_update_investment`; an explicit `mcp.name` wins over the path. */
export function toolName(path: string[], explicit?: string): string {
	return (explicit ? [explicit] : path).map(snake).join("_");
}

const isExcluded = (path: string[]) =>
	(MCP_EXCLUDED_ROUTERS as readonly string[]).includes(path[0] ?? "") ||
	(MCP_EXCLUDED_PROCEDURES as readonly string[]).includes(path.join("."));

/** The oRPC context a tool call runs under — what a signed-in browser has, plus `via`, minus the cookie. */
export function contextFor(ctx: McpCallContext): Context {
	return {
		session: { user: ctx.user } as unknown as Context["session"],
		controlDb: controlDb(),
		unlockToken: null,
		via: ctx.via,
		batchId: undefined,
	};
}

/**
 * One tool per described, non-excluded procedure. A call goes through the router client, so it runs the
 * procedure's own middleware (auth, admin gate, change log) and input validation — exactly what the app's
 * `/rpc` runs, never a second implementation of it.
 */
export function buildProcedureTools(router: AnyRouter = appRouter): ToolDef[] {
	const converter = new ZodToJsonSchemaConverter();
	const tools: ToolDef[] = [];
	for (const { path, procedure } of walkProcedures(router)) {
		const meta = mcpMetaOf(procedure);
		if (!meta || isExcluded(path)) continue;
		const name = toolName(path, meta.name);
		const schema = procedure["~orpc"].inputSchema;
		let inputSchema: JSONSchema = { type: "object", properties: {} };
		if (schema) {
			const [, json] = converter.convert(schema, { strategy: "input" });
			if (json.type !== "object") {
				throw new Error(
					`MCP tool ${name}: input must be an object schema, got ${JSON.stringify(json.type)}`,
				);
			}
			inputSchema = json as JSONSchema;
		}
		tools.push({
			name,
			description: meta.description,
			inputSchema,
			kind: meta.kind,
			run(ctx, args) {
				const client = createRouterClient(router, {
					context: contextFor(ctx),
				}) as unknown as Record<string, unknown>;
				const fn = path.reduce<unknown>(
					(node, key) => (node as Record<string, unknown>)[key],
					client,
				) as (input: unknown) => Promise<unknown>;
				return fn(args);
			},
		});
	}
	return tools;
}

const extras: ToolDef[] = [];

/**
 * Add a tool that isn't a procedure. Called at import time by modules that `./extra-tools` imports, so
 * the handler sees every one of them.
 */
export function registerExtraTool(tool: ToolDef): void {
	if (extras.some((t) => t.name === tool.name)) {
		throw new Error(`MCP tool ${tool.name} is already registered`);
	}
	extras.push(tool);
}

export function extraTools(): readonly ToolDef[] {
	return extras;
}
