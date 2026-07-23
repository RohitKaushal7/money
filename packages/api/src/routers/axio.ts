import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { previewAxio, userRawDir } from "@money/analytics";
import type { AxioSpendRow, CardBillMonth } from "@money/shared";
import { z } from "zod";
import { analyticsReady, withReader } from "../analytics";
import { protectedProcedure } from "../index";
import { ingestErrorMessage, runRebuild } from "../ingest-runner";
import { dataDir } from "../paths";

/**
 * The **axio** router (spec 2026-07-23) — the advisory spends-explorer lens. Reads the SEPARATE
 * `axio_expenses` DuckDB ledger (read-only) plus the statement's `card_bill` totals for the soft cross-check.
 * Never writes, never feeds the KPI/Plan/statement. `axio_expenses` may be absent (never imported) — every
 * read guards for that and returns empty. Import writes an immutable `raw/axio-<hash>.csv` and spawns the
 * ingest runner; the API never opens DuckDB read-write itself (ADR-0003).
 */

/** True if the analytical DB exists AND has the Axio table (imported at least once). */
async function axioReady(uid: string): Promise<boolean> {
	if (!analyticsReady(uid)) return false;
	const rows = await withReader(uid, (r) =>
		r.query<{ n: number }>(
			"SELECT count(*) AS n FROM information_schema.tables WHERE table_name = 'axio_expenses'",
		),
	);
	return (rows[0]?.n ?? 0) > 0;
}

export const axioRouter = {
	/** Has any Axio export been imported, and what span does it cover? */
	status: protectedProcedure.handler(async ({ context }) => {
		if (!(await axioReady(context.uid)))
			return { ready: false, rowCount: 0, minMonth: null, maxMonth: null };
		const rows = await withReader(context.uid, (r) =>
			r.query<{ n: number; lo: string | null; hi: string | null }>(
				"SELECT count(*) AS n, min(month) AS lo, max(month) AS hi FROM axio_expenses",
			),
		);
		const row = rows[0];
		return {
			ready: true,
			rowCount: Number(row?.n ?? 0),
			minMonth: row?.lo ?? null,
			maxMonth: row?.hi ?? null,
		};
	}),

	/**
	 * Aggregated spend (month × category × account) for the window, plus the statement's `card_bill` per
	 * month. All reshaping (granularity, scope, top-N, cross-check) happens client-side in `@money/shared`.
	 */
	overview: protectedProcedure
		.input(
			z
				.object({ from: z.string().optional(), to: z.string().optional() })
				.optional(),
		)
		.handler(async ({ context, input }) => {
			if (!(await axioReady(context.uid)))
				return {
					spend: [] as AxioSpendRow[],
					cardBillByMonth: [] as CardBillMonth[],
				};
			const fromMonth = input?.from?.slice(0, 7) ?? "0000-00";
			const toMonth = input?.to?.slice(0, 7) ?? "9999-99";
			const spend = await withReader(context.uid, (r) =>
				r.query<AxioSpendRow>(
					`SELECT month, category, account, CAST(SUM(amount) AS DOUBLE) AS amount, count(*) AS n
					FROM axio_expenses
					WHERE is_expense = TRUE AND month >= ? AND month <= ?
					GROUP BY month, category, account
					ORDER BY month`,
					[fromMonth, toMonth],
				),
			);
			// The settlement side: the statement's card_bill lump per month (positive magnitude).
			const cardBillByMonth = await withReader(context.uid, (r) =>
				r.query<CardBillMonth>(
					`SELECT t.month, CAST(SUM(-s.amount) AS DOUBLE) AS amount
					FROM transaction_splits s JOIN transactions t USING (txn_id)
					WHERE s.category_key = 'card_bill'
					GROUP BY t.month
					ORDER BY t.month`,
				),
			);
			return { spend, cardBillByMonth };
		}),

	/** Parse a pasted/uploaded Axio CSV and report totals + a sample, writing nothing. */
	previewImport: protectedProcedure
		.input(z.object({ csv: z.string().min(1, "Upload an Axio export first.") }))
		.handler(async ({ context, input }) => {
			const tmp = join(
				tmpdir(),
				`money-axio-preview-${context.uid}-${createHash("md5").update(input.csv).digest("hex").slice(0, 12)}.csv`,
			);
			writeFileSync(tmp, input.csv);
			try {
				return await previewAxio(tmp);
			} finally {
				rmSync(tmp, { force: true });
			}
		}),

	/**
	 * Whole-history replace: write the new `raw/axio-<hash>.csv`, remove the prior Axio file, rebuild. On
	 * rebuild failure, restore the previous file so a bad import never poisons future rebuilds. Prior
	 * contents are kept in memory (not renamed across filesystems) so rollback is cross-device-safe.
	 */
	commitImport: protectedProcedure
		.input(z.object({ csv: z.string().min(1) }))
		.handler(async ({ context, input }) => {
			const rawDir = userRawDir(dataDir(), context.uid);
			mkdirSync(rawDir, { recursive: true });
			const hash = createHash("md5")
				.update(input.csv)
				.digest("hex")
				.slice(0, 12);
			const dest = join(rawDir, `axio-${hash}.csv`);
			const priorContents = readdirSync(rawDir)
				.filter((f) => f.toLowerCase().startsWith("axio-"))
				.map((f) => ({
					path: join(rawDir, f),
					body: readFileSync(join(rawDir, f)),
				}));
			for (const p of priorContents) rmSync(p.path, { force: true });
			writeFileSync(dest, input.csv);
			const result = await runRebuild(context.uid);
			if (!result.ok) {
				rmSync(dest, { force: true });
				for (const p of priorContents) writeFileSync(p.path, p.body); // restore
				throw new Error(`Axio import failed: ${ingestErrorMessage(result)}`);
			}
			return { ok: true, result: result.result };
		}),

	/** Remove the Axio ledger entirely (delete the raw file + rebuild without it). */
	removeImport: protectedProcedure.handler(async ({ context }) => {
		const rawDir = userRawDir(dataDir(), context.uid);
		if (existsSync(rawDir)) {
			for (const f of readdirSync(rawDir).filter((f) =>
				f.toLowerCase().startsWith("axio-"),
			)) {
				rmSync(join(rawDir, f), { force: true });
			}
		}
		const result = await runRebuild(context.uid);
		if (!result.ok)
			throw new Error(
				`Rebuild after removing Axio failed: ${ingestErrorMessage(result)}`,
			);
		return { ok: true };
	}),
};
