import { type AppDb, type ControlDb, currencies, settings } from "@money/db";
import {
	BASE_CURRENCY,
	type CurrencyConfig,
	type RateMap,
	ratesOf,
} from "@money/shared";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, protectedProcedure } from "../index";

/**
 * The **currency** router. INR is the canonical base (ADR: multi-currency). `currencies` holds each code's
 * `rateToInr` (INR per unit); `settings.display_currency` picks the active render currency. Rates are set by
 * hand or refreshed from the free, no-key frankfurter.dev ECB feed.
 *
 * {@link loadRates}/{@link loadConfig} are reused by the plan/networth/spending routers to normalise foreign
 * amounts to INR before the (currency-agnostic) aggregate compute.
 */

const DISPLAY_KEY = "display_currency";
const FRANKFURTER = "https://api.frankfurter.dev/v1/latest";

/** Read the active display currency (defaults to INR). */
export async function loadDisplay(appDb: AppDb): Promise<string> {
	const [row] = await appDb
		.select()
		.from(settings)
		.where(eq(settings.key, DISPLAY_KEY));
	return typeof row?.value === "string" ? row.value : BASE_CURRENCY;
}

/** `code → rateToInr` map for normalising foreign amounts to INR. */
export async function loadRates(controlDb: ControlDb): Promise<RateMap> {
	const rows = await controlDb.select().from(currencies);
	return ratesOf(
		rows.map((r) => ({
			code: r.code,
			symbol: r.symbol,
			rateToInr: r.rateToInr,
			enabled: r.enabled,
		})),
	);
}

export async function loadConfig(
	controlDb: ControlDb,
	appDb: AppDb,
): Promise<CurrencyConfig> {
	const [rows, display] = await Promise.all([
		controlDb.select().from(currencies),
		loadDisplay(appDb),
	]);
	return {
		base: BASE_CURRENCY,
		display,
		currencies: rows.map((r) => ({
			code: r.code,
			symbol: r.symbol,
			rateToInr: r.rateToInr,
			enabled: r.enabled,
		})),
	};
}

const codeInput = z.object({
	code: z
		.string()
		.trim()
		.regex(/^[A-Za-z]{3}$/, "3-letter ISO code")
		.transform((c) => c.toUpperCase()),
});

/** Fetch INR-per-unit for `code` from frankfurter (base=code, symbols=INR). null on any failure. */
async function fetchRateToInr(code: string): Promise<number | null> {
	if (code === BASE_CURRENCY) return 1;
	try {
		const res = await fetch(
			`${FRANKFURTER}?base=${code}&symbols=${BASE_CURRENCY}`,
		);
		if (!res.ok) return null;
		const body = (await res.json()) as { rates?: Record<string, number> };
		const rate = body.rates?.[BASE_CURRENCY];
		return typeof rate === "number" && rate > 0 ? rate : null;
	} catch {
		return null;
	}
}

export const currencyRouter = {
	/** The full currency config: every currency + the active display currency. */
	config: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"Currency settings: the base currency (always INR), the owner's display currency, and every known currency as `{ code, symbol, rateToInr, enabled }`. `rateToInr` is how many rupees one unit of that currency is worth (INR = 1). These rates are shared by everyone on this install and are used to convert foreign-currency holdings and expenses to INR. Takes no input.",
			},
		})
		.handler(({ context }) => loadConfig(context.controlDb, context.appDb)),

	/** Switch the active display currency (must be an enabled currency). */
	setDisplay: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Switch which currency the owner's app displays amounts in. Input: `code` (3-letter ISO code such as USD; case-insensitive; must already be enabled, otherwise this errors). Only affects display for this owner; stored amounts and rates do not change. Returns the updated currency settings.",
			},
		})
		.input(codeInput)
		.handler(async ({ context, input }) => {
			const [cur] = await context.controlDb
				.select()
				.from(currencies)
				.where(eq(currencies.code, input.code));
			if (!cur?.enabled) {
				throw new ORPCError("BAD_REQUEST", {
					message: `${input.code} is not enabled; only an enabled currency can be displayed`,
				});
			}
			await context.appDb
				.insert(settings)
				.values({ key: DISPLAY_KEY, value: input.code })
				.onConflictDoUpdate({
					target: settings.key,
					set: { value: input.code },
				});
			return loadConfig(context.controlDb, context.appDb);
		}),

	/** Add or update a currency (symbol / manual rate / enabled). INR's rate is pinned to 1. */
	upsert: adminProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Admin only — changes rates shared by every user of this install. Add a currency or update its symbol, rate or enabled flag. Input: `code` (3-letter ISO code), `symbol` (1-4 characters, e.g. $), optional `rateToInr` (rupees per one unit of the currency, positive; omitted keeps the existing rate, or 1 for a new currency; INR is always pinned to 1), optional `enabled` (default true for a new currency). Returns the updated currency settings.",
			},
		})
		.input(
			codeInput.extend({
				symbol: z.string().trim().min(1).max(4),
				rateToInr: z.number().positive().optional(),
				enabled: z.boolean().optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			const rateToInr =
				input.code === BASE_CURRENCY ? 1 : (input.rateToInr ?? undefined);
			await context.controlDb
				.insert(currencies)
				.values({
					code: input.code,
					symbol: input.symbol,
					rateToInr: rateToInr ?? 1,
					enabled: input.enabled ?? true,
				})
				.onConflictDoUpdate({
					target: currencies.code,
					set: {
						symbol: input.symbol,
						...(rateToInr != null ? { rateToInr } : {}),
						...(input.enabled != null ? { enabled: input.enabled } : {}),
					},
				});
			return loadConfig(context.controlDb, context.appDb);
		}),

	/** Set a manual INR-per-unit rate for one currency. */
	setRate: adminProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Admin only — changes a rate shared by every user of this install, and so every user's INR conversions. Set one currency's exchange rate by hand. Input: `code` (3-letter ISO code of an existing non-INR currency), `rateToInr` (rupees per one unit of that currency, positive, e.g. 83.2 for USD). INR itself is rejected. Returns the updated currency settings.",
			},
		})
		.input(codeInput.extend({ rateToInr: z.number().positive() }))
		.handler(async ({ context, input }) => {
			if (input.code === BASE_CURRENCY) {
				throw new ORPCError("BAD_REQUEST", {
					message: "INR is the base currency; its rate is always 1",
				});
			}
			await context.controlDb
				.update(currencies)
				.set({ rateToInr: input.rateToInr })
				.where(eq(currencies.code, input.code));
			return loadConfig(context.controlDb, context.appDb);
		}),

	/** Refresh every non-INR currency's rate from frankfurter.dev (ECB). Skips any that fail. */
	refresh: adminProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Admin only — overwrites rates shared by every user of this install. Fetch current rates for every non-INR currency from the ECB feed (frankfurter.dev) and save them, replacing any manual rates; currencies the feed fails for are skipped. Takes no input. Returns `{ updated: [codes refreshed], config }` with the new currency settings.",
			},
		})
		.handler(async ({ context }) => {
			const rows = await context.controlDb.select().from(currencies);
			// Fetch every rate first, then save them in one batch (one SQLite transaction): a failed save
			// leaves all the old rates, never some old and some new.
			const fetched: Array<{ code: string; rate: number }> = [];
			for (const row of rows) {
				if (row.code === BASE_CURRENCY) continue;
				const rate = await fetchRateToInr(row.code);
				if (rate != null) fetched.push({ code: row.code, rate });
			}
			const [first, ...rest] = fetched.map(({ code, rate }) =>
				context.controlDb
					.update(currencies)
					.set({ rateToInr: rate })
					.where(eq(currencies.code, code)),
			);
			if (first) await context.controlDb.batch([first, ...rest]);
			const updated = fetched.map((f) => f.code);
			return {
				updated,
				config: await loadConfig(context.controlDb, context.appDb),
			};
		}),
};
