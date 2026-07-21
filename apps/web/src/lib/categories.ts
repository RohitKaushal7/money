import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";

/** The 5 fixed accounting Kinds (the KPI axis) + their display + colour. Shared across the tagging UI. */
export type Kind =
	| "active_income"
	| "passive_income"
	| "expense"
	| "investment"
	| "transfer";

export const KIND_ORDER: Kind[] = [
	"passive_income",
	"active_income",
	"expense",
	"investment",
	"transfer",
];

export const KIND_LABEL: Record<Kind, string> = {
	passive_income: "Passive income",
	active_income: "Active income",
	expense: "Expense",
	investment: "Investment",
	transfer: "Transfer",
};

export const KIND_COLOR: Record<Kind, string> = {
	passive_income: "var(--covered)",
	active_income: "oklch(0.66 0.12 235)",
	expense: "var(--uncovered)",
	investment: "oklch(0.64 0.15 300)",
	transfer: "var(--muted-foreground)",
};

export const kindColor = (k: string) =>
	KIND_COLOR[k as Kind] ?? "var(--muted-foreground)";

/** income Kinds carry the `taxable` flag. */
export const isIncomeKind = (k: string) =>
	k === "active_income" || k === "passive_income";

export type CategoryItem = {
	id: number;
	key: string;
	label: string;
	kind: string;
	taxable: boolean | null;
	system: boolean;
	active: boolean;
	sortOrder: number;
	/** Pinned `--cat-*` slot (1–5), or null to claim a free one at render time. */
	colorSlot: number | null;
	refRules: number;
	refTxns: number;
};

/** The user's per-user categories (with reference counts), the source of truth for every picker. */
export function useCategories() {
	return useQuery(orpc.categories.list.queryOptions());
}

export type CategoryGroup = {
	kind: Kind;
	label: string;
	cats: CategoryItem[];
};

/**
 * Group categories by Kind (KIND_ORDER). `activeOnly` hides categories the user has hidden, except `keepKey`
 * (so a transaction already tagged to a hidden category still shows its current value in the picker).
 */
export function groupByKind(
	cats: CategoryItem[],
	opts?: { activeOnly?: boolean; keepKey?: string },
): CategoryGroup[] {
	const visible = cats.filter(
		(c) => !opts?.activeOnly || c.active || c.key === opts?.keepKey,
	);
	return KIND_ORDER.map((kind) => ({
		kind,
		label: KIND_LABEL[kind],
		cats: visible.filter((c) => c.kind === kind),
	})).filter((g) => g.cats.length > 0);
}
