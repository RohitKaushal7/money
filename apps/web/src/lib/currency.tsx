import {
	type CurrencyConfig,
	convert,
	type RateMap,
	ratesOf,
} from "@money/shared";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { maskDigits } from "@/lib/format";
import { usePreference } from "@/lib/preferences";
import { orpc } from "@/utils/orpc";

/**
 * Client-side currency display. The server keeps everything INR-canonical; here we convert INR → the active
 * display currency and render the source value dim-in-brackets when it differs.
 *
 * - `<Money inr={…} />`      — an INR-canonical aggregate (net worth, coverage, a spend total).
 * - `<MoneyNative amount code />` — a value stored in its own currency (a USD subscription, a EUR VPS).
 * - `useMoney().fmt(inr)`     — a plain string for tooltips / titles / chart ticks.
 */

const FALLBACK: CurrencyConfig = {
	base: "INR",
	display: "INR",
	currencies: [{ code: "INR", symbol: "₹", rateToInr: 1, enabled: true }],
};

export function useCurrencyConfig(): CurrencyConfig {
	const q = useQuery(orpc.currency.config.queryOptions());
	return q.data ?? FALLBACK;
}

function symbolOf(cfg: CurrencyConfig, code: string): string {
	return cfg.currencies.find((c) => c.code === code)?.symbol ?? `${code} `;
}

function compactNumber(n: number, code: string): string {
	const abs = Math.abs(n);
	if (code === "INR") {
		if (abs >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
		if (abs >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
		if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
		return String(Math.round(n));
	}
	if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
	if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
	if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
	return String(Math.round(n));
}

/**
 * Format `amount` already expressed in `code`, with that currency's symbol + grouping.
 *
 * Every amount this module renders passes through here, which is why privacy masking lives here too rather
 * than at the seventeen call sites. The symbol is never masked — `₹••,•••` still reads as money.
 */
function fmtIn(
	cfg: CurrencyConfig,
	amount: number,
	code: string,
	compact: boolean,
	hidden = false,
): string {
	const sym = symbolOf(cfg, code);
	const locale = code === "INR" ? "en-IN" : "en-US";
	const dp = code === "INR" ? 0 : 2;
	const body = compact
		? compactNumber(amount, code)
		: amount.toLocaleString(locale, {
				minimumFractionDigits: 0,
				maximumFractionDigits: dp,
			});
	return sym + (hidden ? maskDigits(body) : body);
}

export interface MoneyKit {
	cfg: CurrencyConfig;
	display: string;
	rates: RateMap;
	/** enabled currencies (for pickers / the display switcher) */
	enabled: CurrencyConfig["currencies"];
	/** is privacy mode on? The formatters below already honour it; this is for anything that needs to know. */
	hidden: boolean;
	/** INR-canonical amount → a display-currency string (no bracket). */
	fmt: (inr: number) => string;
	/** compact variant (₹1.2L / $1.2k). */
	fmtc: (inr: number) => string;
	/** format a native amount (already in `code`) as a display-currency string. */
	fmtNative: (amount: number, code: string) => string;
	symbolOf: (code: string) => string;
}

export function useMoney(): MoneyKit {
	const cfg = useCurrencyConfig();
	const [hidden] = usePreference("privacy.hidden");
	const rates = ratesOf(cfg.currencies);
	const display = cfg.display;
	return {
		cfg,
		display,
		rates,
		enabled: cfg.currencies.filter((c) => c.enabled),
		hidden,
		fmt: (inr) =>
			fmtIn(cfg, convert(inr, "INR", display, rates), display, false, hidden),
		fmtc: (inr) =>
			fmtIn(cfg, convert(inr, "INR", display, rates), display, true, hidden),
		fmtNative: (amount, code) =>
			fmtIn(cfg, convert(amount, code, display, rates), display, false, hidden),
		symbolOf: (code) => symbolOf(cfg, code),
	};
}

function Bracket({ children }: { children: ReactNode }) {
	return (
		<span className="ml-1 text-[0.82em] text-muted-foreground opacity-80">
			({children})
		</span>
	);
}

/** An INR-canonical amount rendered in the active currency; the ₹ source shows dim when display ≠ INR. */
export function Money({ inr, compact }: { inr: number; compact?: boolean }) {
	const { cfg, display, rates, hidden } = useMoney();
	const primary = fmtIn(
		cfg,
		convert(inr, "INR", display, rates),
		display,
		!!compact,
		hidden,
	);
	return (
		<span className="tnum">
			{primary}
			{display !== "INR" && (
				<Bracket>{fmtIn(cfg, inr, "INR", !!compact, hidden)}</Bracket>
			)}
		</span>
	);
}

/** A value stored in its own currency, rendered in the active currency; its native value shows dim. */
export function MoneyNative({
	amount,
	code,
	compact,
}: {
	amount: number;
	code: string;
	compact?: boolean;
}) {
	const { cfg, display, rates, hidden } = useMoney();
	const primary = fmtIn(
		cfg,
		convert(amount, code, display, rates),
		display,
		!!compact,
		hidden,
	);
	return (
		<span className="tnum">
			{primary}
			{code !== display && (
				<Bracket>{fmtIn(cfg, amount, code, !!compact, hidden)}</Bracket>
			)}
		</span>
	);
}
