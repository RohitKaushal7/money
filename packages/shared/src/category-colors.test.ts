import { describe, expect, test } from "bun:test";
import {
	COLOR_SLOTS,
	DEFAULT_COLOR_SLOTS,
	OTHER_COLOR,
	resolveCategoryColors,
	slotVar,
} from "./category-colors";

const colors = (keys: string[], pinned = {}) =>
	resolveCategoryColors(keys, pinned);

describe("pinned categories", () => {
	test("a pin wins, whatever else is on screen", () => {
		const m = colors(["rent"], { rent: 5 });
		expect(m.get("rent")).toBe(slotVar(5));
	});

	test("the seeded defaults apply when nothing is pinned in the database", () => {
		const m = colors(["card_bill", "upi_merchant", "rent", "tax_paid"]);
		// The four that actually dominate spend, in the order the migration seeds them.
		expect(m.get("card_bill")).toBe(slotVar(1));
		expect(m.get("upi_merchant")).toBe(slotVar(2));
		expect(m.get("rent")).toBe(slotVar(3));
		expect(m.get("tax_paid")).toBe(slotVar(4));
		expect(DEFAULT_COLOR_SLOTS).toEqual({
			card_bill: 1,
			upi_merchant: 2,
			rent: 3,
			tax_paid: 4,
		});
	});

	test("a user pin overrides the seeded default", () => {
		const m = colors(["rent"], { rent: 1 });
		expect(m.get("rent")).toBe(slotVar(1));
	});

	test("null and undefined mean unpinned, not slot zero", () => {
		const m = colors(["groceries", "shopping"], {
			groceries: null,
			shopping: undefined,
		});
		expect(m.get("groceries")).not.toBe(OTHER_COLOR);
		expect(m.get("shopping")).not.toBe(OTHER_COLOR);
	});
});

describe("colour follows the category, not its rank", () => {
	// The bug this module exists to kill: colours were assigned by stack position, so reordering the
	// series repainted every one of them.
	test("reordering the same categories changes nothing", () => {
		const a = colors(["card_bill", "upi_merchant", "rent", "tax_paid"]);
		const b = colors(["tax_paid", "rent", "upi_merchant", "card_bill"]);
		for (const key of a.keys()) expect(b.get(key)).toBe(a.get(key) as string);
	});

	test("a survivor keeps its colour when another category drops out", () => {
		const before = colors(["card_bill", "upi_merchant", "rent", "tax_paid"]);
		const after = colors(["card_bill", "rent"]);
		expect(after.get("card_bill")).toBe(before.get("card_bill") as string);
		expect(after.get("rent")).toBe(before.get("rent") as string);
	});

	test("an unpinned category keeps its colour when a *smaller* one appears beside it", () => {
		const before = colors(["groceries"]);
		const after = colors(["groceries", "health"]);
		expect(after.get("groceries")).toBe(before.get("groceries") as string);
	});
});

describe("unpinned categories claim free slots", () => {
	test("a leftover takes the lowest slot no pin is holding", () => {
		// card_bill pins slot 1 and rent pins slot 3, so the first leftover gets 2.
		const m = colors(["card_bill", "rent", "groceries"]);
		expect(m.get("groceries")).toBe(slotVar(2));
	});

	test("leftovers are ordered by the taxonomy, never by the order they were passed", () => {
		// `groceries` precedes `health` in CATEGORIES, so it takes the lower slot either way round.
		const forward = colors(["groceries", "health"]);
		const reverse = colors(["health", "groceries"]);
		expect(forward.get("groceries")).toBe(reverse.get("groceries") as string);
		expect(forward.get("health")).toBe(reverse.get("health") as string);
		expect(forward.get("groceries")).toBe(slotVar(1));
		expect(forward.get("health")).toBe(slotVar(2));
	});

	test("two leftovers never land on the same slot", () => {
		const m = colors(["groceries", "health", "shopping", "transport"]);
		const used = [...m.values()];
		expect(new Set(used).size).toBe(used.length);
	});

	test("an unknown key still gets a colour rather than crashing", () => {
		const m = colors(["some_custom_category_the_user_made"]);
		expect(m.get("some_custom_category_the_user_made")).toBe(slotVar(1));
	});
});

describe("overflow", () => {
	test("past five, the rest go to Other rather than inventing a hue", () => {
		const keys = [
			"groceries",
			"food_dining",
			"shopping",
			"transport",
			"utilities",
			"subscription",
			"health",
		];
		const m = colors(keys);
		const other = keys.filter((k) => m.get(k) === OTHER_COLOR);
		expect(other.length).toBe(keys.length - COLOR_SLOTS.length);
	});

	test("every key asked for gets an answer", () => {
		const keys = ["rent", "groceries", "health", "shopping", "transport", "x"];
		const m = colors(keys);
		for (const k of keys) expect(m.get(k)).toBeTruthy();
	});

	test("pins are honoured even when they would otherwise overflow", () => {
		const keys = ["a", "b", "c", "d", "e", "rent"];
		const m = colors(keys, { rent: 5 });
		expect(m.get("rent")).toBe(slotVar(5));
	});
});
