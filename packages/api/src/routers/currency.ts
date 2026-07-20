import { type AppDb, type ControlDb, currencies, settings } from "@money/db";
import {
	BASE_CURRENCY,
	type CurrencyConfig,
	type RateMap,
	ratesOf,
} from "@money/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../index";

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
	config: protectedProcedure.handler(({ context }) =>
		loadConfig(context.controlDb, context.appDb),
	),

	/** Switch the active display currency (must be an enabled currency). */
	setDisplay: protectedProcedure
		.input(codeInput)
		.handler(async ({ context, input }) => {
			const [cur] = await context.controlDb
				.select()
				.from(currencies)
				.where(eq(currencies.code, input.code));
			if (!cur || !cur.enabled) throw new Error("currency not enabled");
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
	upsert: protectedProcedure
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
	setRate: protectedProcedure
		.input(codeInput.extend({ rateToInr: z.number().positive() }))
		.handler(async ({ context, input }) => {
			if (input.code === BASE_CURRENCY) throw new Error("INR is the base (=1)");
			await context.controlDb
				.update(currencies)
				.set({ rateToInr: input.rateToInr })
				.where(eq(currencies.code, input.code));
			return loadConfig(context.controlDb, context.appDb);
		}),

	/** Refresh every non-INR currency's rate from frankfurter.dev (ECB). Skips any that fail. */
	refresh: protectedProcedure.handler(async ({ context }) => {
		const rows = await context.controlDb.select().from(currencies);
		const updated: string[] = [];
		for (const row of rows) {
			if (row.code === BASE_CURRENCY) continue;
			const rate = await fetchRateToInr(row.code);
			if (rate == null) continue;
			await context.controlDb
				.update(currencies)
				.set({ rateToInr: rate })
				.where(eq(currencies.code, row.code));
			updated.push(row.code);
		}
		return {
			updated,
			config: await loadConfig(context.controlDb, context.appDb),
		};
	}),
};
