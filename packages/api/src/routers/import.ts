import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { userRawDir } from "@money/analytics";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure } from "../index";
import { ingestErrorMessage, runDryRun, runRebuild } from "../ingest-runner";
import { dataDir } from "../paths";

/**
 * Paste-CSV import (ADR-0013): the browser posts statement text, the API persists it as an immutable raw
 * file under the user's `raw/` dir (ADR-0002) and spawns the ingest runner — it NEVER opens DuckDB
 * read-write itself. `dryRun` previews new-vs-duplicate counts before anything is written.
 */

/** Stable short digest of the CSV content — re-pasting identical content maps to the same raw filename. */
function contentHash(csv: string): string {
	return createHash("md5").update(csv).digest("hex").slice(0, 12);
}

const csvInput = z.object({
	csv: z.string().min(1, "Paste a statement CSV first."),
});

/** Loose sanity check — an SBI export header carries a Date and a Balance column. */
function looksLikeStatement(csv: string): boolean {
	const head = csv.slice(0, 4000);
	return /Date/i.test(head) && /Balance/i.test(head);
}

export interface DryRunCounts {
	rowsTotal: number;
	rowsNew: number;
	rowsDuplicate: number;
	rowsConflict: number;
}

/** Write the CSV to a temp file and count new/duplicate rows via the runner. Never touches the raw dir. */
async function previewCsv(csv: string, uid: string): Promise<DryRunCounts> {
	const tmp = join(tmpdir(), `money-import-${contentHash(csv)}.csv`);
	writeFileSync(tmp, csv);
	try {
		const r = await runDryRun(uid, tmp);
		if (!r.ok || r.result?.mode !== "dryrun") {
			throw new ORPCError("BAD_REQUEST", {
				message: `Could not parse that CSV: ${ingestErrorMessage(r)}`,
			});
		}
		return {
			rowsTotal: Number(r.result.rowsTotal ?? 0),
			rowsNew: Number(r.result.rowsNew ?? 0),
			rowsDuplicate: Number(r.result.rowsDuplicate ?? 0),
			rowsConflict: Number(r.result.rowsConflict ?? 0),
		};
	} finally {
		rmSync(tmp, { force: true });
	}
}

export const importRouter = {
	/** Preview: how many rows are new vs already imported. Writes nothing. */
	dryRun: protectedProcedure.input(csvInput).handler(({ context, input }) => {
		if (!looksLikeStatement(input.csv)) {
			throw new ORPCError("BAD_REQUEST", {
				message:
					"That doesn't look like an SBI statement export (no Date/Balance header).",
			});
		}
		return previewCsv(input.csv, context.uid);
	}),

	/**
	 * Persist the pasted CSV as an immutable `raw/pasted-<hash>.csv` (re-pasting identical content is a
	 * no-op) and rebuild. Validates the parse FIRST so a bad file never lands in the raw dir (it would poison
	 * every future rebuild); rolls the file back if the rebuild itself fails.
	 */
	commit: protectedProcedure
		.input(csvInput)
		.handler(async ({ context, input }) => {
			if (!looksLikeStatement(input.csv)) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"That doesn't look like an SBI statement export (no Date/Balance header).",
				});
			}
			const rawDir = userRawDir(dataDir(), context.uid);
			const counts = await previewCsv(input.csv, context.uid);
			const file = `pasted-${contentHash(input.csv)}.csv`;
			const dest = join(rawDir, file);
			const alreadyPresent = existsSync(dest);
			if (!alreadyPresent) {
				mkdirSync(rawDir, { recursive: true });
				writeFileSync(dest, input.csv);
			}
			const r = await runRebuild(context.uid);
			if (!r.ok) {
				if (!alreadyPresent) rmSync(dest, { force: true }); // rollback
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: `Import rebuild failed: ${ingestErrorMessage(r)}`,
				});
			}
			return {
				file,
				alreadyPresent,
				...counts,
				transactions: Number(r.result?.transactions ?? 0),
				uncategorized: Number(r.result?.uncategorized ?? 0),
			};
		}),

	/** Raw statement files currently feeding the rebuild. */
	listRaw: protectedProcedure.handler(({ context }) => {
		const rawDir = userRawDir(dataDir(), context.uid);
		if (!existsSync(rawDir)) return [];
		return readdirSync(rawDir)
			.filter((f) => f.toLowerCase().endsWith(".csv"))
			.sort()
			.map((f) => {
				const s = statSync(join(rawDir, f));
				return { name: f, bytes: s.size, modified: s.mtime.toISOString() };
			});
	}),

	/** Remove a raw file (undo an import) and rebuild without it. */
	remove: protectedProcedure
		.input(z.object({ name: z.string().min(1) }))
		.handler(async ({ context, input }) => {
			const { name } = input;
			if (
				name.includes("/") ||
				name.includes("..") ||
				!name.toLowerCase().endsWith(".csv")
			) {
				throw new ORPCError("BAD_REQUEST", { message: "Invalid file name." });
			}
			const rawDir = userRawDir(dataDir(), context.uid);
			const target = join(rawDir, name);
			if (!existsSync(target)) {
				throw new ORPCError("NOT_FOUND", { message: "No such raw file." });
			}
			rmSync(target, { force: true });
			const r = await runRebuild(context.uid);
			if (!r.ok) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: `Rebuild after removal failed: ${ingestErrorMessage(r)}`,
				});
			}
			return {
				removed: name,
				transactions: Number(r.result?.transactions ?? 0),
				uncategorized: Number(r.result?.uncategorized ?? 0),
			};
		}),
};
