import {
	type AppDb,
	type ControlDb,
	investments,
	networthLogs,
} from "@money/db";
import {
	isISODate,
	type NetworthLog,
	networthSeries,
	toInr,
} from "@money/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { analyticsReady, withReader } from "../analytics";
import { protectedProcedure } from "../index";
import { loadRates } from "./currency";

/**
 * The **Net-worth log** router (issue 003). A curated time series of dated total-net-worth points, each
 * annotated with the annualised growth since the previous point (compute in `@money/shared/networth`).
 * SQLite-backed durable app-state — the API writes it directly (unlike DuckDB, which is read-only here;
 * ADR-0003). `logToday` reaches into DuckDB read-only for the cash leg.
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
	.regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
	.refine(isISODate, "expected a real date as YYYY-MM-DD");

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
	list: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"The owner's net-worth log: dated total-net-worth points in INR, oldest first. Takes no input. Each point has `id`, `asOf` (YYYY-MM-DD), `value` (INR), `source` (manual | computed), optional `note`, `growth` (annualised simple growth since the previous point as a fraction, 0.1 = 10%; null for the first) and `days` since the previous point. Also returns `first`, `latest`, `change` (absolute INR, first to latest) and `cagr` (compound annual growth rate as a fraction; null with fewer than 2 points).",
			},
		})
		.handler(async ({ context }) => {
			const rows = await context.appDb.select().from(networthLogs);
			return networthSeries(rows.map(toLog));
		}),

	/** Compute today's net worth (cash + Σ current_value) and log it (source = computed; upserts today). */
	logToday: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Compute today's net worth and save it to the net-worth log. Takes no input. Net worth = cash on hand (latest statement balance of each account) + the sum of `currentValue` of all active holdings, converted to INR. Writes a point dated today with source computed, replacing any existing point for today (including one the owner entered by hand). Returns `{ asOf, value, cash, invested }` in INR.",
			},
		})
		.handler(async ({ context }) => {
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
	add: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Add or correct a manually entered net-worth point. Input: `asOf` (date, YYYY-MM-DD), `value` (total net worth in INR, not negative), optional `note`. If a point already exists for that date it is overwritten, replacing its value and note and marking it manual. Returns `{ ok: true }`.",
			},
		})
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
	remove: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Permanently delete one point from the net-worth log. Input: `id` (whole number, the point's id from the net-worth list, not its date). Not undoable. Returns `{ ok: true }` even if no point had that id.",
			},
		})
		.input(z.object({ id: z.coerce.number().int().positive() }))
		.handler(async ({ context, input }) => {
			await context.appDb
				.delete(networthLogs)
				.where(eq(networthLogs.id, input.id));
			return { ok: true };
		}),
};
