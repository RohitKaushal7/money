/**
 * Every MCP tool that isn't an oRPC procedure registers itself (via `registerExtraTool`) when its module
 * is imported. The handler imports this file, so a tool module is live once it is imported here.
 */
import "./update-holdings";
