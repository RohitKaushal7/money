/**
 * Multi-currency helpers (pure; ADR-0007). **INR is the canonical base**: every stored foreign amount is
 * normalised to INR for aggregate math, and the UI converts INR → the active display currency. Rates are
 * quoted as `rateToInr` (INR per 1 unit; INR = 1), so conversion is a ratio and any pair goes via INR.
 */

export const BASE_CURRENCY = "INR";

export interface Currency {
	/** ISO 4217, e.g. "USD" */
	code: string;
	/** display symbol, e.g. "$" */
	symbol: string;
	/** INR per 1 unit (INR = 1) */
	rateToInr: number;
	enabled: boolean;
}

/** The app's currency configuration: which currencies exist, and which one values render in. */
export interface CurrencyConfig {
	/** always "INR" — the canonical base every amount normalises through */
	base: string;
	/** the active display currency values render in */
	display: string;
	currencies: Currency[];
}

/** A `code → rateToInr` lookup (INR = 1). Missing/unknown codes are treated as INR (factor 1). */
export type RateMap = Record<string, number>;

/** Build a {@link RateMap} from a currency list. */
export function ratesOf(currencies: Currency[]): RateMap {
	const map: RateMap = { [BASE_CURRENCY]: 1 };
	for (const c of currencies) map[c.code] = c.rateToInr;
	return map;
}

/** Normalise a native amount to INR: `amount × rateToInr(currency)`. Unknown currency ⇒ unchanged. */
export function toInr(
	amount: number,
	currency: string | undefined,
	rates: RateMap,
): number {
	return amount * (rates[currency ?? BASE_CURRENCY] ?? 1);
}

/** Convert `amount` from one currency to another via INR. Unknown codes ⇒ factor 1. */
export function convert(
	amount: number,
	from: string,
	to: string,
	rates: RateMap,
): number {
	if (from === to) return amount;
	return toInr(amount, from, rates) / (rates[to] ?? 1);
}
