import { createHash } from "node:crypto";

/**
 * Axio (formerly Walnut) spends explorer — a SEPARATE, advisory expense ledger.
 *
 * Axio reads transaction SMS across every account and card and categorises each spend; its `EXPENSE=Yes`
 * flag is already a de-duplicated spend ledger (transfers and card-bill settlements are flagged out). This
 * module is the pure domain layer: row identity, the account classifier, the billing-cycle calendar, and
 * the chart reshaping. The CSV parse itself lives in `@money/analytics` (DuckDB), and nothing here is ever
 * read into the coverage KPI. See docs/superpowers/specs/2026-07-23-axio-spends-explorer-design.md.
 */

export type AxioGranularity = "month" | "quarter" | "year";
export type AxioAccountScope = "all" | "cards" | "direct";

/** The fields that identify an Axio row. Excludes category and the flags, so re-curating keeps the id. */
export interface AxioIdParts {
	date: string;
	time: string;
	amount: number;
	drcr: string;
	account: string;
	place: string;
}

/**
 * Deterministic row id: `md5(date|time|amount|drcr|account|place)`, amount to 2 decimals. MUST stay
 * byte-identical to the SQL expression in `buildAxioSelect` — a parity test pins the two together.
 */
export function axioRowId(p: AxioIdParts): string {
	const key = [
		p.date,
		p.time,
		p.amount.toFixed(2),
		p.drcr,
		p.account,
		p.place,
	].join("|");
	return createHash("md5").update(key).digest("hex");
}

/** Known credit lines whose Axio account name lacks the `credit` token. */
const CREDIT_ALIASES = ["slice"];

/**
 * Classify an Axio account. `credit` = a card (the `credit` token, plus known aliases like Slice); `cash` =
 * `CASH Spends`; everything else (`SBI`, `Federal Bk`, `Paytm Bank`, wallets) is `direct`. Advisory-grade —
 * nothing downstream is authoritative.
 */
export function accountKind(name: string): "credit" | "direct" | "cash" {
	const n = name.toLowerCase();
	if (n.includes("credit") || CREDIT_ALIASES.some((a) => n.startsWith(a)))
		return "credit";
	if (n.startsWith("cash")) return "cash";
	return "direct";
}

export function isCreditAccount(name: string): boolean {
	return accountKind(name) === "credit";
}

/** The month that settles a month's card spend. All cards bill monthly on the 1st–3rd, so `M → M+1`. */
export function settlementMonth(ym: string): string {
	const [y, m] = ym.split("-").map(Number);
	const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
	return `${next.y}-${String(next.m).padStart(2, "0")}`;
}

/** Bucket a `YYYY-MM` month into the chosen granularity's period key. */
export function periodOf(ym: string, g: AxioGranularity): string {
	if (g === "year") return ym.slice(0, 4);
	if (g === "month") return ym;
	const [y, m] = ym.split("-").map(Number);
	return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}
