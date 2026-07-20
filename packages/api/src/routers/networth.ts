import {
	type AppDb,
	type ControlDb,
	investments,
	networthLogs,
} from "@money/db";
import { type NetworthLog, networthSeries, toInr } from "@money/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { analyticsReady, withReader } from "../analytics";
import { publicProcedure } from "../index";
import { loadRates } from "./currency";

/**
 * The **Net-worth log** router (issue 003). A curated time series of dated total-net-worth points, each
 * annotated with the annualised growth since the previous point (compute in `@money/shared/networth`).
 * SQLite-backed durable app-state — the API writes it directly (unlike DuckDB, which is read-only here;
 * ADR-0003). `logToday` reaches into DuckDB read-only for the cash leg.
 *
 * TODO(auth): `publicProcedure` for the localhost/tailnet dashboard; MUST become `protectedProcedure`
 * before any non-tailnet exposure (financial data; ADR-0006/0010).
 */

type LogRow = typeof networthLogs.$inferSelect;

function toLog(r: LogRow): NetworthLog {
	return {
		id: r.id,
		asOf: r.asOf,
		value: r.value,
		source: r.source === "computed" ? "computed" : "manual",
		note: r.note ?? undefined,
	};
}

/** Today as YYYY-MM-DD (server clock). */
function todayISO(): string {
	return new Date().toISOString().slice(0, 10);
}

const dateInput = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** Sum, per account, of the balance of its most recent statement row = the cash leg of net worth. */
async function cashOnHand(uid: string): Promise<number> {
	if (!analyticsReady(uid)) return 0;
	return withReader(uid, async (reader) => {
		const rows = await reader.query<{ cash: number }>(
			`SELECT COALESCE(SUM(latest_balance), 0) AS cash FROM (
			   SELECT account_id, last(balance ORDER BY txn_date) AS latest_balance
			   FROM transactions GROUP BY account_id
			 )`,
		);
		return Number(rows[0]?.cash ?? 0);
	});
}

/** Σ current_value (normalised to INR) across live investments — matured principal still counts as wealth. */
async function investmentValue(
	appDb: AppDb,
	controlDb: ControlDb,
): Promise<number> {
	const [rows, rates] = await Promise.all([
		appDb
			.select({ v: investments.currentValue, currency: investments.currency })
			.from(investments)
			.where(eq(investments.active, true)),
		loadRates(controlDb),
	]);
	return rows.reduce((sum, r) => sum + toInr(r.v ?? 0, r.currency, rates), 0);
}

async function upsertLog(
	appDb: AppDb,
	asOf: string,
	value: number,
	source: "manual" | "computed",
	note?: string,
): Promise<void> {
	await appDb
		.insert(networthLogs)
		.values({ asOf, value, source, note })
		.onConflictDoUpdate({
			target: networthLogs.asOf,
			set: { value, source, note: note ?? null },
		});
}

export const networthRouter = {
	/** The full chronological series with per-step annualised growth + the headline CAGR. */
	list: publicProcedure.handler(async ({ context }) => {
		const rows = await context.appDb.select().from(networthLogs);
		return networthSeries(rows.map(toLog));
	}),

	/** Compute today's net worth (cash + Σ current_value) and log it (source = computed; upserts today). */
	logToday: publicProcedure.handler(async ({ context }) => {
		const [cash, invested] = await Promise.all([
			cashOnHand(context.uid),
			investmentValue(context.appDb, context.controlDb),
		]);
		const asOf = todayISO();
		const value = Math.round((cash + invested) * 100) / 100;
		await upsertLog(
			context.appDb,
			asOf,
			value,
			"computed",
			"auto: cash + Σ current_value",
		);
		return { asOf, value, cash, invested };
	}),

	/** Add / correct a manual net-worth point (upserts on date). */
	add: publicProcedure
		.input(
			z.object({
				asOf: dateInput,
				value: z.number().nonnegative(),
				note: z.string().optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			await upsertLog(
				context.appDb,
				input.asOf,
				input.value,
				"manual",
				input.note,
			);
			return { ok: true };
		}),

	/** Delete a logged point by id. */
	remove: publicProcedure
		.input(z.object({ id: z.coerce.number().int().positive() }))
		.handler(async ({ context, input }) => {
			await context.appDb
				.delete(networthLogs)
				.where(eq(networthLogs.id, input.id));
			return { ok: true };
		}),
};
