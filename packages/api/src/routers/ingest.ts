import { ORPCError } from "@orpc/server";
import { protectedProcedure } from "../index";
import { ingestErrorMessage, runRetag } from "../ingest-runner";

/**
 * The **Re-tag** button (issue 001/002) — "I edited a rule/override, apply it everywhere". Spawns
 * `scripts/ingest.ts --retag` (the sole DuckDB writer, ADR-0003), which re-derives every split from the
 * current SQLite rules/overrides/manual-splits WITHOUT re-importing CSVs (~0.3s). The API itself never
 * opens DuckDB read-write; it shells out to the sanctioned script (see `../ingest-runner`).
 */
export const ingestRouter = {
	retag: protectedProcedure.handler(async ({ context }) => {
		const r = await runRetag(context.uid);
		if (!r.ok) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: `Re-tag failed: ${ingestErrorMessage(r)}`,
			});
		}
		return {
			transactions: Number(r.result?.transactions ?? 0),
			uncategorized: Number(r.result?.uncategorized ?? 0),
		};
	}),
};
