import { describe, expect, test } from "bun:test";
import { CARD_CATEGORIES, CARD_CATEGORY_BY_KEY } from "./card-categories";

describe("card categories", () => {
	test("covers the merchant + general buckets", () => {
		const keys = CARD_CATEGORIES.map((c) => c.key);
		expect(keys).toEqual(
			expect.arrayContaining([
				"amazon",
				"food_delivery",
				"online_shopping",
				"dining",
				"groceries",
				"fuel",
				"utilities",
				"rent",
				"forex",
				"travel",
				"insurance",
				"education",
				"upi",
				"offline_other",
			]),
		);
	});

	test("lookup by key works", () => {
		expect(CARD_CATEGORY_BY_KEY.get("fuel")?.label).toBe("Fuel");
		expect(CARD_CATEGORY_BY_KEY.get("nope")).toBeUndefined();
	});
});
