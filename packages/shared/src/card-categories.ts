/**
 * Card-reward category taxonomy (issue 005 / cards). A merchant/spend-type axis — how card rewards are
 * actually structured — deliberately SEPARATE from the ledger's KPI expense categories (which lump all
 * shopping into `card_bill`/`upi_merchant`). The reward rules and the spend profile key off these.
 */

export interface CardCategory {
	key: string;
	label: string;
}

export const CARD_CATEGORIES: CardCategory[] = [
	{ key: "amazon", label: "Amazon" },
	{ key: "food_delivery", label: "Food delivery (Swiggy/Zomato)" },
	{ key: "online_shopping", label: "Online shopping" },
	{ key: "dining", label: "Dining" },
	{ key: "groceries", label: "Groceries" },
	{ key: "fuel", label: "Fuel" },
	{ key: "utilities", label: "Utilities & bills" },
	{ key: "rent", label: "Rent" },
	{ key: "forex", label: "Forex / international" },
	{ key: "travel", label: "Travel (flights/hotels)" },
	{ key: "insurance", label: "Insurance" },
	{ key: "education", label: "Education" },
	{ key: "upi", label: "UPI / scan & pay" },
	{ key: "offline_other", label: "Offline / other" },
];

export const CARD_CATEGORY_BY_KEY: Map<string, CardCategory> = new Map(
	CARD_CATEGORIES.map((c) => [c.key, c]),
);
