import { describe, expect, test } from "bun:test";
import {
	enrichTransactions,
	type RawTxnRow,
	type TxnOverlays,
} from "./transactions";

function overlays(partial: Partial<TxnOverlays> = {}): TxnOverlays {
	return {
		overrideByTxn: new Map(),
		manualByTxn: new Map(),
		kindByCategory: new Map([
			["groceries", "expense"],
			["salary", "active_income"],
		]),
		labelByCategory: new Map([
			["groceries", "Groceries"],
			["salary", "Salary"],
			["uncategorized", "Uncategorised"],
		]),
		...partial,
	};
}

const raw: RawTxnRow = {
	txnId: "t1",
	date: "2026-06-02",
	narration: "BLINKIT",
	amount: -1648.7,
	balance: 5000,
	categoryKey: "groceries",
	kind: "expense",
};

describe("enrichTransactions", () => {
	test("resolves baked category label + kind when there is no override", () => {
		const e = enrichTransactions([raw], overlays())[0];
		expect(e?.categoryKey).toBe("groceries");
		expect(e?.categoryLabel).toBe("Groceries");
		expect(e?.kind).toBe("expense");
		expect(e?.hasOverride).toBe(false);
	});

	test("an override wins over the baked split; label + kind follow", () => {
		const o = overlays({
			overrideByTxn: new Map([
				[
					"t1",
					{ overrideCategoryKey: "salary", overrideKind: null, note: "fixed" },
				],
			]),
		});
		const e = enrichTransactions([raw], o)[0];
		expect(e?.categoryKey).toBe("salary");
		expect(e?.categoryLabel).toBe("Salary");
		expect(e?.kind).toBe("active_income"); // overrideKind null → kindByCategory
		expect(e?.hasOverride).toBe(true);
		expect(e?.overrideNote).toBe("fixed");
	});

	test("null baked category falls back to uncategorized → transfer kind", () => {
		const e = enrichTransactions(
			[{ ...raw, categoryKey: null, kind: null }],
			overlays(),
		)[0];
		expect(e?.categoryKey).toBe("uncategorized");
		expect(e?.categoryLabel).toBe("Uncategorised");
		expect(e?.kind).toBe("transfer");
	});

	test("counts manual splits", () => {
		const o = overlays({
			manualByTxn: new Map([
				["t1", [{ categoryKey: "x" }, { categoryKey: "y" }]],
			]),
		});
		expect(enrichTransactions([raw], o)[0]?.manualSplitCount).toBe(2);
	});
});
