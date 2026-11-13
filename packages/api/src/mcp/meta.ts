import { type AnyProcedure, isProcedure } from "@orpc/server";

export type McpKind = "read" | "write";
export type McpEntity = "investments" | "recurring_expenses";
/** What an undoable write does to its entity row — stored with the change, never inferred from it. */
export type McpOperation = "insert" | "update" | "delete";

/**
 * Attached to a procedure with `.meta({ mcp: {...} })` to expose it as an MCP tool. A write to a holding
 * or expense names both its `entity` and its `operation`, which together make it undoable.
 */
export interface McpMeta {
	mcp?: {
		description: string;
		kind: McpKind;
		name?: string;
	} & (
		| { entity?: undefined; operation?: undefined }
		| { entity: McpEntity; operation: McpOperation }
	);
}

/** Who is calling when the request came in over an access token rather than a browser session. */
export interface TokenVia {
	kind: "token";
	tokenId: number;
	name: string;
	scope: "read" | "read_write";
}

/** The screen-lock PIN guards browser sessions only; a token is its own, revocable credential. */
export function pinApplies(context: { via?: TokenVia }): boolean {
	return context.via === undefined;
}

export function mcpMetaOf(procedure: unknown): McpMeta["mcp"] | undefined {
	const orpc = (procedure as { "~orpc"?: { meta?: McpMeta } } | null)?.[
		"~orpc"
	];
	return orpc?.meta?.mcp;
}

/** Routers whose procedures are never offered to Claude, whether or not they carry a description. */
export const MCP_EXCLUDED_ROUTERS = [
	"admin",
	"setup",
	"lock",
	"import",
	"tokens",
] as const;

/** Individual procedures (dotted path) that are never offered to Claude. */
export const MCP_EXCLUDED_PROCEDURES = [
	"axio.commitImport",
	"axio.removeImport",
	"healthCheck",
	"privateData",
] as const;

/** Whether a procedure (by path, e.g. `["tokens", "create"]`) is kept from Claude whatever its meta says. */
export function isMcpExcluded(path: readonly string[]): boolean {
	return (
		(MCP_EXCLUDED_ROUTERS as readonly string[]).includes(path[0] ?? "") ||
		(MCP_EXCLUDED_PROCEDURES as readonly string[]).includes(path.join("."))
	);
}

/** Every procedure under a router tree, with its path (e.g. `["plan", "ladder"]`). */
export function walkProcedures(
	router: unknown,
	prefix: string[] = [],
): Array<{ path: string[]; procedure: AnyProcedure }> {
	if (isProcedure(router)) {
		return [{ path: prefix, procedure: router as AnyProcedure }];
	}
	if (router === null || typeof router !== "object") return [];
	return Object.entries(router as Record<string, unknown>).flatMap(
		([key, child]) => walkProcedures(child, [...prefix, key]),
	);
}
