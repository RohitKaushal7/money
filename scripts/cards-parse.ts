/**
 * Pure parse helpers for the cards importer (issue 005 / cards). Zero dependencies so they can be unit-tested
 * without pulling in the DB/yaml chain. The importer (cards-import.ts) composes these with I/O.
 */

/** First percentage in a string → fraction (0.2% → 0.002). null if none. */
export function parseRate(
	s: string | number | undefined | null,
): number | null {
	if (s == null) return null;
	const m = /(-?\d+(?:\.\d+)?)\s*%/.exec(String(s));
	return m ? Number(m[1]) / 100 : null;
}

/** Leading number in a fee string, commas stripped (Indian grouping). "500 + GST" → 500. null if none. */
export function parseFee(s: string | number | undefined | null): number | null {
	if (s == null) return null;
	if (typeof s === "number") return s;
	const digits = s.replace(/,/g, "");
	const m = /(\d+(?:\.\d+)?)/.exec(digits);
	return m ? Number(m[1]) : null;
}

const CATEGORY_KEYWORDS: [RegExp, string][] = [
	[/swiggy|zomato|food delivery|instamart/i, "food_delivery"],
	[/amazon/i, "amazon"],
	[/cleartrip|flight|hotel|travel|makemytrip|goibibo/i, "travel"],
	[/online shopping|eligible mcc|e-commerce|ecommerce/i, "online_shopping"],
	[/dining|restaurant|dineout/i, "dining"],
	[/grocery|groceries|supermarket/i, "groceries"],
	[/fuel|petrol|diesel/i, "fuel"],
	[/utility|utilities|bill|telecom|electricity|broadband/i, "utilities"],
	[/rent/i, "rent"],
	[/forex|international|overseas/i, "forex"],
	[/insurance/i, "insurance"],
	[/education|tuition/i, "education"],
	[/scan-?and-?pay|upi/i, "upi"],
];

/** Keyword-map a prose reward 'on' description to a card-category key; fallback offline_other. */
export function mapCategory(onText: string | undefined | null): string {
	if (!onText) return "offline_other";
	for (const [re, key] of CATEGORY_KEYWORDS) if (re.test(onText)) return key;
	return "offline_other";
}
