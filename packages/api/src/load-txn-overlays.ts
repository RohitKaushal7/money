import {
	type AppDb,
	categories,
	transactionManualSplits,
	transactionOverrides,
} from "@money/db";
import type {
	ManualSplitLike,
	TxnOverlays,
	TxnOverrideLike,
} from "./transactions";

/** Read the overrides, manual splits, and live category→kind/label maps from SQLite into lookup maps. */
export async function loadTxnOverlays(appDb: AppDb): Promise<TxnOverlays> {
	const [overrides, manualSplits, cats] = await Promise.all([
		appDb.select().from(transactionOverrides),
		appDb.select().from(transactionManualSplits),
		appDb
			.select({
				key: categories.key,
				kind: categories.kind,
				label: categories.label,
			})
			.from(categories),
	]);
	const overrideByTxn = new Map<string, TxnOverrideLike>(
		overrides.map((o) => [o.txnId, o]),
	);
	const kindByCategory = new Map(cats.map((c) => [c.key, c.kind]));
	const labelByCategory = new Map(cats.map((c) => [c.key, c.label]));
	const manualByTxn = new Map<string, ManualSplitLike[]>();
	for (const m of manualSplits) {
		const arr = manualByTxn.get(m.txnId) ?? [];
		arr.push(m);
		manualByTxn.set(m.txnId, arr);
	}
	return { overrideByTxn, manualByTxn, kindByCategory, labelByCategory };
}
