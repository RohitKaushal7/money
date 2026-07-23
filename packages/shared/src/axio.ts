import { createHash } from "node:crypto";
import {
	COLOR_SLOTS,
	type ColorSlot,
	OTHER_COLOR,
	slotVar,
} from "./category-colors";

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

/** One aggregated spend cell from the analytical DB: a month × category × account magnitude. */
export interface AxioSpendRow {
	month: string;
	category: string;
	account: string;
	amount: number;
	n: number;
}

/** The statement's `card_bill` total for a month (the settlement side of the cross-check). */
export interface CardBillMonth {
	month: string;
	amount: number;
}

export interface AxioHeaderSplit {
	total: number;
	cards: number;
	direct: number;
}

export interface AxioCategoryTotal {
	category: string;
	total: number;
	count: number;
}

export interface AxioSeriesPoint {
	period: string;
	total: number;
	byCategory: Record<string, number>;
}

export interface AxioCrossCheckRow {
	spendMonth: string;
	settleMonth: string;
	cardSpend: number;
	cardBill: number;
	gap: number;
}

export const AXIO_UNKNOWN = "UNKNOWN";
/** The rollup key for categories outside the current selection. */
export const AXIO_OTHER = "__other__";

/** Keep only the rows an account scope admits (`cash` counts as direct spend). */
function inScope(row: AxioSpendRow, scope: AxioAccountScope): boolean {
	if (scope === "all") return true;
	const credit = isCreditAccount(row.account);
	return scope === "cards" ? credit : !credit;
}

/** Total spend split by whether it landed on a card or a bank/cash account. */
export function headerSplit(rows: AxioSpendRow[]): AxioHeaderSplit {
	let cards = 0;
	let direct = 0;
	for (const r of rows) {
		if (isCreditAccount(r.account)) cards += r.amount;
		else direct += r.amount;
	}
	return { total: cards + direct, cards, direct };
}

/** Per-category totals within a scope, biggest first. */
export function categoryTotals(
	rows: AxioSpendRow[],
	scope: AxioAccountScope = "all",
): AxioCategoryTotal[] {
	const by = new Map<string, { total: number; count: number }>();
	for (const r of rows) {
		if (!inScope(r, scope)) continue;
		const cur = by.get(r.category) ?? { total: 0, count: 0 };
		cur.total += r.amount;
		cur.count += r.n;
		by.set(r.category, cur);
	}
	return [...by.entries()]
		.map(([category, v]) => ({ category, ...v }))
		.sort((a, b) => b.total - a.total);
}

/** The n biggest category names by total spend within a scope. */
export function topAxioCategories(
	rows: AxioSpendRow[],
	n = 5,
	scope: AxioAccountScope = "all",
): string[] {
	return categoryTotals(rows, scope)
		.slice(0, n)
		.map((c) => c.category);
}

/**
 * Reshape rows into one point per period, with the chosen categories kept and everything else summed into
 * {@link AXIO_OTHER}. Periods are sorted ascending.
 */
export function axioSeries(
	rows: AxioSpendRow[],
	opts: {
		granularity: AxioGranularity;
		scope: AxioAccountScope;
		categories: string[];
	},
): AxioSeriesPoint[] {
	const keep = new Set(opts.categories);
	const points = new Map<string, AxioSeriesPoint>();
	for (const r of rows) {
		if (!inScope(r, opts.scope)) continue;
		const period = periodOf(r.month, opts.granularity);
		const pt = points.get(period) ?? { period, total: 0, byCategory: {} };
		const key = keep.has(r.category) ? r.category : AXIO_OTHER;
		pt.byCategory[key] = (pt.byCategory[key] ?? 0) + r.amount;
		pt.total += r.amount;
		points.set(period, pt);
	}
	return [...points.values()].sort((a, b) => a.period.localeCompare(b.period));
}

/** Card spend in month M vs the statement's `card_bill` in month M+1. Advisory only — never matches rows. */
export function cardBillCrossCheck(
	rows: AxioSpendRow[],
	cardBills: CardBillMonth[],
): AxioCrossCheckRow[] {
	const cardSpendByMonth = new Map<string, number>();
	for (const r of rows) {
		if (!isCreditAccount(r.account)) continue;
		cardSpendByMonth.set(
			r.month,
			(cardSpendByMonth.get(r.month) ?? 0) + r.amount,
		);
	}
	const billByMonth = new Map(cardBills.map((b) => [b.month, b.amount]));
	return [...cardSpendByMonth.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([spendMonth, cardSpend]) => {
			const settleMonth = settlementMonth(spendMonth);
			const cardBill = billByMonth.get(settleMonth) ?? 0;
			return {
				spendMonth,
				settleMonth,
				cardSpend,
				cardBill,
				gap: cardSpend - cardBill,
			};
		});
}

/**
 * Stable colour pins for Axio's common categories — colour follows the category, not its rank (the same
 * principle as the statement palette). Leftover categories claim free slots in {@link AXIO_ORDER}; anything
 * past five distinct colours, and `UNKNOWN` (uncategorised P2P), falls to {@link OTHER_COLOR}.
 */
export const AXIO_COLOR_SLOTS: Record<string, ColorSlot> = {
	BILLS: 1,
	GROCERIES: 2,
	FUEL: 3,
	"FOOD & DRINKS": 4,
	SHOPPING: 5,
};

const AXIO_ORDER = [
	"BILLS",
	"GROCERIES",
	"FUEL",
	"FOOD & DRINKS",
	"SHOPPING",
	"TRAVEL",
	"HEALTH",
	"ENTERTAINMENT",
	"STATIONERY",
	"INVESTMENT",
];

export function axioColors(categories: string[]): Map<string, string> {
	const out = new Map<string, string>();
	const taken = new Set<ColorSlot>();
	const leftovers: string[] = [];
	for (const c of categories) {
		if (c === AXIO_UNKNOWN) {
			out.set(c, OTHER_COLOR);
			continue;
		}
		const pin = AXIO_COLOR_SLOTS[c];
		if (pin) {
			out.set(c, slotVar(pin));
			taken.add(pin);
		} else {
			leftovers.push(c);
		}
	}
	const idx = (c: string) => {
		const i = AXIO_ORDER.indexOf(c);
		return i === -1 ? Number.MAX_SAFE_INTEGER : i;
	};
	leftovers.sort((a, b) => idx(a) - idx(b) || a.localeCompare(b));
	for (const c of leftovers) {
		const free = COLOR_SLOTS.find((s) => !taken.has(s));
		if (free === undefined) {
			out.set(c, OTHER_COLOR);
			continue;
		}
		taken.add(free);
		out.set(c, slotVar(free));
	}
	return out;
}
