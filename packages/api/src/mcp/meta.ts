export type McpKind = "read" | "write";
export type McpEntity = "investments" | "recurring_expenses";

/** Attached to a procedure with `.meta({ mcp: {...} })` to expose it as an MCP tool. */
export interface McpMeta {
	mcp?: {
		description: string;
		kind: McpKind;
		name?: string;
		entity?: McpEntity;
	};
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
