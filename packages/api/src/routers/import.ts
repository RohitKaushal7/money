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
import { previewStatement, userDuckdbPath, userRawDir } from "@money/analytics";
import { accounts, importFiles, statementFormats } from "@money/db";
import {
	rowToStatementMapping,
	type StatementMapping,
	splitCsvHeader,
	statementHeaderSignature,
	validateStatementMapping,
} from "@money/shared";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../index";
import { ingestErrorMessage, runRebuild } from "../ingest-runner";
import { dataDir } from "../paths";

/**
 * Generic CSV import (spec 2026-07-21). The browser posts statement text; the API auto-detects a known format
 * by header signature (`detect`), previews a candidate mapping read-only (`previewMapping`), and on `commit`
 * persists the CSV as an immutable `raw/pasted-<hash>.csv` (ADR-0002) bound to its format (`import_files`),
 * then spawns the ingest runner — it NEVER opens DuckDB read-write itself (ADR-0003).
 */

/** Stable short digest of the CSV content — re-pasting identical content maps to the same raw filename. */
function contentHash(csv: string): string {
	return createHash("md5").update(csv).digest("hex").slice(0, 12);
}

/** The header column names of a pasted CSV (first line, quote-aware). */
function headerOf(csv: string): string[] {
	return splitCsvHeader(csv.split(/\r?\n/, 1)[0] ?? "");
}

/** Zod schema mirroring `StatementMapping` (the wizard sends this; cross-field checks via validateStatementMapping). */
const mappingSchema = z.object({
	dateCol: z.string().min(1),
	dateFmt: z.string().min(1),
	amountMode: z.enum(["signed", "debit_credit", "amount_indicator"]),
	amountCol: z.string().nullish(),
	signConvention: z.enum(["credit_positive", "debit_positive"]).nullish(),
	debitCol: z.string().nullish(),
	creditCol: z.string().nullish(),
	indicatorCol: z.string().nullish(),
	creditToken: z.string().nullish(),
	narrationCol: z.string().min(1),
	refCol: z.string().nullish(),
	balanceCol: z.string().nullish(),
	valueDateCol: z.string().nullish(),
	anchor: z.enum(["balance", "ref"]),
	quirks: z.array(z.enum(["multiline_unwrap"])).default([]),
});

const csvInput = z.object({
	csv: z.string().min(1, "Paste a statement CSV first."),
});

export const importRouter = {
	/** Auto-detect: does a saved format match this CSV's header? Returns the columns + the matched format, if any. */
	detect: protectedProcedure
		.input(csvInput)
		.handler(async ({ context, input }) => {
			const headers = headerOf(input.csv);
			const signature = statementHeaderSignature(headers);
			const [row] = await context.appDb
				.select()
				.from(statementFormats)
				.where(eq(statementFormats.headerSignature, signature));
			if (!row) return { headers, matched: null };
			const [acct] = await context.appDb
				.select({ name: accounts.name })
				.from(accounts)
				.where(eq(accounts.id, row.accountId));
			return {
				headers,
				matched: {
					id: row.id,
					name: row.name,
					system: row.system,
					accountId: row.accountId,
					accountName: acct?.name ?? null,
					mapping: rowToStatementMapping(row),
				},
			};
		}),

	/** Live wizard preview: parse the CSV with a candidate mapping and report sample rows + new/dup counts. */
	previewMapping: protectedProcedure
		.input(
			z.object({
				csv: z.string().min(1),
				mapping: mappingSchema,
				accountId: z.number().int().optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			const mapping = input.mapping as StatementMapping;
			const invalid = validateStatementMapping(mapping);
			if (invalid) return { ok: false as const, error: invalid };
			const tmp = join(
				tmpdir(),
				`money-preview-${context.uid}-${contentHash(input.csv + JSON.stringify(mapping))}.csv`,
			);
			writeFileSync(tmp, input.csv);
			try {
				return await previewStatement({
					userDbPath: userDuckdbPath(dataDir(), context.uid),
					csvPath: tmp,
					mapping,
					accountId: input.accountId ?? 0,
					sampleLimit: 10,
				});
			} finally {
				rmSync(tmp, { force: true });
			}
		}),

	/**
	 * Persist + rebuild. `existing` binds the file to a matched format; `new` creates the account (if new) and
	 * the format, then binds. Writes `raw/pasted-<hash>.csv` + an `import_files` row and rebuilds; on rebuild
	 * failure everything created here is rolled back so a bad import never leaves orphaned state or poisons
	 * future rebuilds.
	 */
	commit: protectedProcedure
		.input(
			z.discriminatedUnion("mode", [
				z.object({
					mode: z.literal("existing"),
					csv: z.string().min(1),
					formatId: z.number().int(),
				}),
				z.object({
					mode: z.literal("new"),
					csv: z.string().min(1),
					name: z.string().min(1),
					mapping: mappingSchema,
					account: z.discriminatedUnion("mode", [
						z.object({
							mode: z.literal("existing"),
							accountId: z.number().int(),
						}),
						z.object({ mode: z.literal("new"), name: z.string().min(1) }),
					]),
				}),
			]),
		)
		.handler(async ({ context, input }) => {
			const rawDir = userRawDir(dataDir(), context.uid);
			const file = `pasted-${contentHash(input.csv)}.csv`;
			const dest = join(rawDir, file);

			let formatId: number;
			let createdFormatId: number | null = null;
			let createdAccountId: number | null = null;

			if (input.mode === "existing") {
				const [row] = await context.appDb
					.select({ id: statementFormats.id })
					.from(statementFormats)
					.where(eq(statementFormats.id, input.formatId));
				if (!row) {
					throw new ORPCError("NOT_FOUND", { message: "No such format." });
				}
				formatId = row.id;
			} else {
				const mapping = input.mapping as StatementMapping;
				const invalid = validateStatementMapping(mapping);
				if (invalid) {
					throw new ORPCError("BAD_REQUEST", { message: invalid });
				}
				const signature = statementHeaderSignature(headerOf(input.csv));
				const [taken] = await context.appDb
					.select({ id: statementFormats.id })
					.from(statementFormats)
					.where(eq(statementFormats.headerSignature, signature));
				if (taken) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"A format for these columns already exists — use it instead.",
					});
				}
				let accountId: number;
				if (input.account.mode === "new") {
					const [acct] = await context.appDb
						.insert(accounts)
						.values({ name: input.account.name, kind: "savings" })
						.returning({ id: accounts.id });
					if (!acct) {
						throw new ORPCError("INTERNAL_SERVER_ERROR", {
							message: "Failed to create the account.",
						});
					}
					accountId = acct.id;
					createdAccountId = acct.id;
				} else {
					const [acct] = await context.appDb
						.select({ id: accounts.id })
						.from(accounts)
						.where(eq(accounts.id, input.account.accountId));
					if (!acct) {
						throw new ORPCError("BAD_REQUEST", { message: "No such account." });
					}
					accountId = acct.id;
				}
				const { quirks, ...cols } = mapping;
				const [fmt] = await context.appDb
					.insert(statementFormats)
					.values({
						name: input.name,
						system: false,
						headerSignature: signature,
						accountId,
						...cols,
						quirks: JSON.stringify(quirks ?? []),
					})
					.returning({ id: statementFormats.id });
				if (!fmt) {
					throw new ORPCError("INTERNAL_SERVER_ERROR", {
						message: "Failed to create the format.",
					});
				}
				formatId = fmt.id;
				createdFormatId = fmt.id;
			}

			const alreadyPresent = existsSync(dest);
			if (!alreadyPresent) {
				mkdirSync(rawDir, { recursive: true });
				writeFileSync(dest, input.csv);
			}
			const [existingBinding] = await context.appDb
				.select({ id: importFiles.id })
				.from(importFiles)
				.where(eq(importFiles.filename, file));
			let createdBinding = false;
			if (!existingBinding) {
				await context.appDb
					.insert(importFiles)
					.values({ filename: file, formatId });
				createdBinding = true;
			}

			const r = await runRebuild(context.uid);
			if (!r.ok) {
				// Roll back everything created here, in reverse.
				if (createdBinding) {
					await context.appDb
						.delete(importFiles)
						.where(eq(importFiles.filename, file));
				}
				if (!alreadyPresent) rmSync(dest, { force: true });
				if (createdFormatId !== null) {
					await context.appDb
						.delete(statementFormats)
						.where(eq(statementFormats.id, createdFormatId));
				}
				if (createdAccountId !== null) {
					await context.appDb
						.delete(accounts)
						.where(eq(accounts.id, createdAccountId));
				}
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: `Import rebuild failed: ${ingestErrorMessage(r)}`,
				});
			}
			return {
				file,
				alreadyPresent,
				formatId,
				transactions: Number(r.result?.transactions ?? 0),
				uncategorized: Number(r.result?.uncategorized ?? 0),
			};
		}),

	/** Raw statement files currently feeding the rebuild, each with its bound format + account. */
	listRaw: protectedProcedure.handler(async ({ context }) => {
		const rawDir = userRawDir(dataDir(), context.uid);
		if (!existsSync(rawDir)) return [];
		const names = readdirSync(rawDir)
			.filter((f) => f.toLowerCase().endsWith(".csv"))
			.sort();
		const [bindings, formats, accts] = await Promise.all([
			context.appDb.select().from(importFiles),
			context.appDb.select().from(statementFormats),
			context.appDb.select().from(accounts),
		]);
		const fmtById = new Map(formats.map((f) => [f.id, f]));
		const acctById = new Map(accts.map((a) => [a.id, a]));
		const formatByName = new Map(bindings.map((b) => [b.filename, b.formatId]));
		return names.map((name) => {
			const s = statSync(join(rawDir, name));
			const fmt = fmtById.get(formatByName.get(name) ?? -1);
			const acct = fmt ? acctById.get(fmt.accountId) : undefined;
			return {
				name,
				bytes: s.size,
				modified: s.mtime.toISOString(),
				formatName: fmt?.name ?? null,
				accountName: acct?.name ?? null,
			};
		});
	}),

	/** Remove a raw file (undo an import) + its binding, and rebuild without it. */
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
			await context.appDb
				.delete(importFiles)
				.where(eq(importFiles.filename, name));
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
