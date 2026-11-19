/**
 * A statement narration → the name a person would say: `SWIGGY ORDER BLR` → "Swiggy",
 * `UPI/DR/412345678901/CHAIWALA/YESB/q123@ybl/Payment` → "Chaiwala".
 *
 * **Conservative on purpose.** This is a display label for a phone row, never a key: rules and search still
 * match the raw narration, and the raw narration stays one tap away. So when a step isn't sure it leaves the
 * text alone, and the worst case is the whole narration in title case rather than a confident wrong name.
 *
 * Three steps, in order:
 * 1. drop the bank's own wrapper (`TO TRANSFER-`, `BY TRANSFER-`, `DEBIT-`);
 * 2. for a payment rail (`UPI/…`, `IMPS/…`, `NEFT*…`), keep the first segment that looks like a name, not
 *    a direction code, a reference number, an IFSC or a VPA;
 * 3. if a well-known merchant appears as a whole word, use its proper spelling; otherwise title-case what's
 *    left, minus long reference numbers and company suffixes.
 */

/** Well-known Indian merchants, as their own brands spell them. Matched as whole words, case-insensitive. */
const BRAND_NAMES: [string, string][] = [
	["SWIGGY", "Swiggy"],
	["ZOMATO", "Zomato"],
	["BLINKIT", "Blinkit"],
	["ZEPTO", "Zepto"],
	["BIG ?BASKET", "BigBasket"],
	["D ?MART", "DMart"],
	["INSTAMART", "Instamart"],
	["AMAZON", "Amazon"],
	["FLIPKART", "Flipkart"],
	["MYNTRA", "Myntra"],
	["NYKAA", "Nykaa"],
	["AJIO", "Ajio"],
	["MEESHO", "Meesho"],
	["UBER", "Uber"],
	["OLA", "Ola"],
	["RAPIDO", "Rapido"],
	["IRCTC", "IRCTC"],
	["FASTAG", "FASTag"],
	["IOCL", "Indian Oil"],
	["AIRTEL", "Airtel"],
	["JIO", "Jio"],
	["BESCOM", "BESCOM"],
	["TATA POWER", "Tata Power"],
	["NETFLIX", "Netflix"],
	["SPOTIFY", "Spotify"],
	["HOTSTAR", "Hotstar"],
	["YOUTUBE", "YouTube"],
	["GOOGLE PLAY", "Google Play"],
	["APOLLO", "Apollo"],
	["PHARMEASY", "PharmEasy"],
	["1MG", "1mg"],
	["ZERODHA", "Zerodha"],
	["GROWW", "Groww"],
	["CRED", "CRED"],
	["PAYTM", "Paytm"],
	["PHONEPE", "PhonePe"],
	["MAKEMYTRIP", "MakeMyTrip"],
	["BOOKMYSHOW", "BookMyShow"],
];
const BRANDS = BRAND_NAMES.map(([pattern, name]): [RegExp, string] => [
	new RegExp(`\\b${pattern}\\b`, "i"),
	name,
]);

/** Words that are a rail's grammar, not the payee. */
const RAIL_WORDS = new Set([
	"UPI",
	"IMPS",
	"NEFT",
	"RTGS",
	"DR",
	"CR",
	"P2A",
	"P2M",
	"P2P",
	"PAY",
	"PAYMENT",
	"MOB",
	"INB",
	"REF",
	"NA",
]);

/** Short bank codes that sit in a UPI narration where the payee's bank goes. */
const BANK_CODES = new Set([
	"SBIN",
	"HDFC",
	"ICIC",
	"UTIB",
	"YESB",
	"KKBK",
	"PUNB",
	"BARB",
	"CNRB",
	"UBIN",
	"IDIB",
	"INDB",
	"FDRL",
	"IDFB",
	"PYTM",
	"AIRP",
	"AUBL",
	"BKID",
]);

/** Letters-only tokens that read wrong in title case. */
const ACRONYMS = new Set([
	"ATM",
	"SBI",
	"HDFC",
	"ICICI",
	"GST",
	"TDS",
	"SMS",
	"EMI",
	"FD",
	"RD",
	"SB",
	"MF",
	"SIP",
	"LIC",
	"BSE",
	"NSE",
	"NEFT",
	"IMPS",
	"RTGS",
	"UPI",
	"ACH",
	"NACH",
	"ECS",
	"PPF",
	"NPS",
	"EPF",
	"HUF",
	"OTT",
	"BBPS",
]);

const SMALL_WORDS = new Set([
	"to",
	"of",
	"for",
	"from",
	"and",
	"by",
	"on",
	"at",
]);

const BANK_WRAPPER =
	/^(?:(?:TO|BY)\s+(?:TRANSFER|CLEARING|CASH)|DEBIT|CREDIT)\s*-\s*/i;
const RAIL = /^(UPI|IMPS|NEFT|RTGS)\s*[/*-]/i;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/i;
const COMPANY_SUFFIX =
	/\s+(?:PVT\.?\s*LTD\.?|PRIVATE\s+LIMITED|LTD\.?|LIMITED|LLP|INC\.?)$/i;

function looksLikeName(segment: string): boolean {
	const s = segment.trim();
	if (s.length < 3) return false;
	const upper = s.toUpperCase();
	if (RAIL_WORDS.has(upper) || BANK_CODES.has(upper)) return false;
	if (s.includes("@")) return false; // a VPA
	if (IFSC.test(s)) return false;
	const letters = (s.match(/[a-z]/gi) ?? []).length;
	const digits = (s.match(/\d/g) ?? []).length;
	// reference numbers, and refs with a letter prefix like N123456
	return letters >= 3 && digits <= letters;
}

function titleCase(text: string): string {
	return text
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.map((word, i) => {
			const upper = word.toUpperCase();
			if (ACRONYMS.has(upper)) return upper;
			if (i > 0 && SMALL_WORDS.has(word)) return word;
			return word.charAt(0).toUpperCase() + word.slice(1);
		})
		.join(" ");
}

function tidy(text: string): string {
	return text
		.replace(/\b\d{6,}\b/g, " ") // reference numbers
		.replace(/[*/|_]+/g, " ")
		.replace(/-{2,}/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^[-\s]+|[-\s]+$/g, "")
		.replace(COMPANY_SUFFIX, "")
		.trim();
}

export function cleanMerchant(narration: string): string {
	const raw = narration.replace(/\s+/g, " ").trim();
	if (!raw) return "";
	let text = raw.replace(BANK_WRAPPER, "");

	const rail = text.match(RAIL);
	if (rail) {
		const payee = text.slice(rail[0].length).split(/[/*]/).find(looksLikeName);
		if (payee) text = payee;
	}

	// the brand that appears first wins, so "SWIGGY INSTAMART" is Swiggy
	let best: { at: number; name: string } | null = null;
	for (const [re, name] of BRANDS) {
		const m = re.exec(text);
		if (m && (best == null || m.index < best.at)) best = { at: m.index, name };
	}
	if (best) return best.name;

	if (/\bATM\b/i.test(text) && /\bWDL\b|WITHDRAWAL/i.test(text))
		return "ATM withdrawal";

	return titleCase(tidy(text)) || titleCase(raw);
}
