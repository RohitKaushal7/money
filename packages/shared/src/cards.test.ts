import { describe, expect, test } from "bun:test";
import { bestCardForCategory, type CardInfo, type RewardRule } from "./cards";

const cards: CardInfo[] = [
	{ id: 1, name: "OneCard", isLtf: true },
	{ id: 2, name: "HDFC Swiggy", isLtf: false },
	{ id: 3, name: "Amazon ICICI", isLtf: true },
];

const rules: RewardRule[] = [
	// OneCard: base 0.2% (points), conditional 1% on food_delivery
	{
		cardId: 1,
		category: "base",
		isBase: true,
		rate: 0.002,
		isExclusion: false,
		rewardType: "points",
	},
	{
		cardId: 1,
		category: "food_delivery",
		isBase: false,
		rate: 0.01,
		isExclusion: false,
		rewardType: "points",
		condition: "needs 3×₹750 unlock; else 0.2%",
		capText: "25,000 RP/mo combined",
	},
	// HDFC Swiggy: 10% food_delivery (cashback), excludes fuel
	{
		cardId: 2,
		category: "food_delivery",
		isBase: false,
		rate: 0.1,
		isExclusion: false,
		rewardType: "cashback",
		condition: "via Swiggy app, min ₹249",
		capText: "₹1,500/cycle",
	},
	{
		cardId: 2,
		category: "fuel",
		isBase: false,
		rate: 0,
		isExclusion: true,
		rewardType: "cashback",
	},
	// Amazon ICICI: base 1% cashback (no food_delivery-specific rule → base fallback)
	{
		cardId: 3,
		category: "base",
		isBase: true,
		rate: 0.01,
		isExclusion: false,
		rewardType: "cashback",
	},
];

describe("bestCardForCategory", () => {
	test("highest rate wins; exact-category rule beats base", () => {
		const out = bestCardForCategory("food_delivery", cards, rules);
		expect(out[0]?.cardName).toBe("HDFC Swiggy"); // 10%
		expect(out[0]?.rate).toBe(0.1);
		const onecard = out.find((r) => r.cardName === "OneCard");
		expect(onecard?.rate).toBe(0.01); // the conditional food_delivery rule, not base 0.2%
		const amazon = out.find((r) => r.cardName === "Amazon ICICI");
		expect(amazon?.rate).toBe(0.01); // base fallback (no food_delivery rule)
	});

	test("the winning rule's condition + cap ride along as caveats", () => {
		const out = bestCardForCategory("food_delivery", cards, rules);
		expect(out[0]?.caveats.join(" ")).toContain("Swiggy app");
		expect(out[0]?.caveats.join(" ")).toContain("₹1,500/cycle");
		const onecard = out.find((r) => r.cardName === "OneCard");
		expect(onecard?.caveats.join(" ")).toContain("3×₹750");
	});

	test("tie on rate → cashback beats points, then LTF", () => {
		// OneCard (1%, points, LTF) vs Amazon ICICI (1%, cashback, LTF): cashback wins the tie
		const out = bestCardForCategory("food_delivery", cards, rules);
		const idxAmazon = out.findIndex((r) => r.cardName === "Amazon ICICI");
		const idxOne = out.findIndex((r) => r.cardName === "OneCard");
		expect(idxAmazon).toBeLessThan(idxOne);
	});

	test("exclusions are flagged and sorted last", () => {
		const out = bestCardForCategory("fuel", cards, rules);
		const swiggy = out.find((r) => r.cardName === "HDFC Swiggy");
		expect(swiggy?.excluded).toBe(true);
		expect(swiggy?.rate).toBe(0);
		expect(out[out.length - 1]?.cardName).toBe("HDFC Swiggy");
	});

	test("card gotchas ride along", () => {
		const out = bestCardForCategory("food_delivery", cards, rules, {
			1: ["5x only after the 3-category unlock"],
		});
		const onecard = out.find((r) => r.cardName === "OneCard");
		expect(onecard?.caveats).toContain("5x only after the 3-category unlock");
	});
});
