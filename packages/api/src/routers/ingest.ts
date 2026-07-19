import { ORPCError } from "@orpc/server";
import { publicProcedure } from "../index";
import { ingestErrorMessage, runRetag } from "../ingest-runner";

/**
 * The **Re-tag** button (issue 001/002) — "I edited a rule/override, apply it everywhere". Spawns
 * `scripts/ingest.ts --retag` (the sole DuckDB writer, ADR-0003), which re-derives every split from the
 * current SQLite rules/overrides/manual-splits WITHOUT re-importing CSVs (~0.3s). The API itself never
 * opens DuckDB read-write; it shells out to the sanctioned script (see `../ingest-runner`).
 *
 * TODO(auth): `publicProcedure` for the localhost/tailnet dashboard; must become `protectedProcedure`
 * before any non-tailnet exposure (ADR-0006).
 */
export const ingestRouter = {
	retag: publicProcedure.handler(async () => {
		const r = await runRetag();
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
