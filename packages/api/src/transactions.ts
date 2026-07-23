/**
 * Transaction enrichment — layering the SQLite overlays (overrides, manual splits, live category→kind/label)
 * onto raw DuckDB rows. Pure and dependency-free so the list and the CSV export share ONE source of truth for
 * "what category/kind does this row show", and so it unit-tests without booting the env-validated `@money/db`
 * barrel. The runtime overlay loader (which does touch `@money/db`) lives in `./load-txn-overlays`.
 */

const UNCATEGORIZED = "uncategorized";

/** A raw transaction row as read from DuckDB (primary split joined at seq 0). */
export interface RawTxnRow {
	txnId: string;
	date: string;
	narration: string;
	amount: number;
	balance: number;
	categoryKey: string | null;
	kind: string | null;
}

/** The fields of a transaction override that the enrichment reads (a structural subset of the Drizzle row). */
export interface TxnOverrideLike {
	overrideCategoryKey: string | null;
	overrideKind: string | null;
	note: string | null;
}

/** The fields of a manual split the enrichment + pending-retag check read (a subset of the Drizzle row). */
export interface ManualSplitLike {
	categoryKey: string;
}

/** SQLite overlays as lookup maps. */
export interface TxnOverlays {
	overrideByTxn: Map<string, TxnOverrideLike>;
	manualByTxn: Map<string, ManualSplitLike[]>;
	kindByCategory: Map<string, string>;
	labelByCategory: Map<string, string>;
}

/** A transaction with the SQLite overlays applied — the effective category/kind/label shown on screen. */
export interface EnrichedTxn {
	txnId: string;
	date: string;
	narration: string;
	amount: number;
	balance: number;
	bakedCategoryKey: string;
	categoryKey: string;
	categoryLabel: string;
	kind: string;
	hasOverride: boolean;
	overrideNote: string | null;
	manualSplitCount: number;
}

/** Layer the SQLite overlays onto raw DuckDB rows. Pure — the same enrichment the list and export share. */
export function enrichTransactions(
	rows: RawTxnRow[],
	o: TxnOverlays,
): EnrichedTxn[] {
	return rows.map((r) => {
		const ov = o.overrideByTxn.get(r.txnId);
		const manual = o.manualByTxn.get(r.txnId);
		const bakedCategoryKey = r.categoryKey ?? UNCATEGORIZED;
		const effectiveCategoryKey = ov?.overrideCategoryKey ?? bakedCategoryKey;
		const effectiveKind =
			ov?.overrideKind ??
			o.kindByCategory.get(effectiveCategoryKey) ??
			r.kind ??
			"transfer";
		return {
			txnId: r.txnId,
			date: r.date,
			narration: r.narration,
			amount: r.amount,
			balance: r.balance,
			bakedCategoryKey,
			categoryKey: effectiveCategoryKey,
			categoryLabel:
				o.labelByCategory.get(effectiveCategoryKey) ?? effectiveCategoryKey,
			kind: effectiveKind,
			hasOverride: ov != null,
			overrideNote: ov?.note ?? null,
			manualSplitCount: manual?.length ?? 0,
		};
	});
}
