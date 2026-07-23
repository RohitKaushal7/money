#!/usr/bin/env bun
/**
 * scripts/seed-dummy.ts — fill a DUMMY user with realistic-looking but entirely FAKE data, so the landing
 * page and its screenshots never expose real financial data.
 *
 * Writes ONLY the two things a script may write: the user's SQLite `app.db` (app-state) and a raw CSV in
 * their `raw/` dir. It NEVER opens DuckDB — that is `scripts/ingest.ts`'s job (HARD RULE 3). The CSV's
 * narrations are crafted to match the GENERIC_SEED_RULES so ingest auto-categorises them.
 *
 * Usage (two steps):
 *   bun --env-file=apps/server/.env scripts/seed-dummy.ts --user <uid>
 *   bun --env-file=apps/server/.env scripts/ingest.ts     --user <uid>
 *
 * `--user <uid>` is REQUIRED (no default) so this can never accidentally target the real owner.
 */
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { controlDbPath, userAppDbPath, userRawDir } from "@money/analytics";
import {
	coverageSnapshots,
	createAppDb,
	createControlDb,
	currencies,
	investments,
	networthLogs,
	recurringExpenses,
	taxProfiles,
} from "@money/db";
import { env } from "@money/env/server";

const userIdx = process.argv.indexOf("--user");
const USER = userIdx >= 0 ? process.argv[userIdx + 1] : undefined;
if (!USER) {
	console.error("usage: bun ... scripts/seed-dummy.ts --user <uid>");
	process.exit(1);
}

const APP_DB = userAppDbPath(env.DATA_DIR, USER);
const RAW_DIR = userRawDir(env.DATA_DIR, USER);
console.log(`[seed-dummy] target user ${USER}`);
console.log(`[seed-dummy]   app.db : ${APP_DB}`);
console.log(`[seed-dummy]   raw    : ${RAW_DIR}`);

// ── deterministic RNG (reproducible CSV on re-run) ──────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rng = mulberry32(20260723);
const rand = (lo: number, hi: number): number =>
	Math.round(lo + rng() * (hi - lo));
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)] as T;
const count = (lo: number, hi: number): number[] =>
	Array.from({ length: rand(lo, hi) }, (_, i) => i);

// ── transaction generation ──────────────────────────────────────────────────────────────────────────
// One synthetic SBI current-account statement. Narrations are picked so GENERIC_SEED_RULES tag them:
// SALARY→salary, \bRENT\b→rent / rent_received, INTEREST→savings_interest, DIVIDEND→dividend,
// BSE STAR MF/GROWW→sip, ZERODHA→stock_buy, CRED CCBP/SBICARD→card_bill, SWIGGY/ZOMATO→food_dining,
// BLINKIT/ZEPTO/DMART/INSTAMART→groceries, AMAZON/FLIPKART/MYNTRA/NYKAA/AJIO→shopping,
// UBER/\bOLA\b/RAPIDO/IRCTC/FASTAG/IOCL→transport, AIRTEL/\bJIO\b/ELECTRICITY/BESCOM/TATA POWER/BBPS→
// utilities, NETFLIX/SPOTIFY/HOTSTAR/GOOGLE PLAY→subscription, APOLLO/PHARMEASY/1MG→health, bare UPI→
// upi_merchant, \bATM\b→misc_expense, SWEEP→sweep_in/out (transfer). The story: passive income climbs
// month over month while expenses hold ~flat, so the coverage ratio trends up.
interface Txn {
	y: number;
	m: number; // 1-12
	d: number;
	narration: string;
	amount: number; // signed: credit +, debit −
}

const FOOD = ["SWIGGY ORDER BLR", "ZOMATO ONLINE ORDER", "SWIGGY DINEOUT"];
const GROCERY = [
	"BLINKIT GROCERIES",
	"ZEPTO NOW",
	"BIGBASKET ORDER",
	"DMART READY",
	"INSTAMART ORDER",
];
const SHOP = [
	"AMAZON RETAIL IN",
	"FLIPKART INTERNET",
	"MYNTRA DESIGNS",
	"NYKAA ECOMM",
	"AJIO RELIANCE",
];
const TRANSPORT = [
	"UBER INDIA TRIP",
	"OLA CABS RIDE",
	"RAPIDO BIKE",
	"IRCTC RAIL TICKET",
	"FASTAG RECHARGE",
	"IOCL FUEL STATION",
];
const UTIL = [
	"AIRTEL POSTPAID BILL",
	"JIO RECHARGE",
	"BESCOM ELECTRICITY",
	"TATA POWER BILL",
	"BBPS GAS BOOKING",
];
const SUBS = [
	"NETFLIX SUBSCRIPTION",
	"SPOTIFY INDIA",
	"HOTSTAR PREMIUM",
	"GOOGLE PLAY STORE",
];
const HEALTH = ["APOLLO PHARMACY", "PHARMEASY ORDER", "1MG HEALTHCARE"];
const UPI_MISC = [
	"UPI/LOCALKIRANA/PAY",
	"UPI/CHAIWALA/PAY",
	"UPI/SALON/PAY",
	"UPI/STATIONERY/PAY",
	"UPI/STREETFOOD/PAY",
	"UPI/BOOKSTORE/PAY",
];

// 13 months ending near "today" (2026-07). [year, month] pairs in order.
const MONTHS: Array<[number, number]> = [];
for (let i = 0; i < 13; i++) {
	const base = 2025 * 12 + (7 - 1) + i; // start 2025-07
	MONTHS.push([Math.floor(base / 12), (base % 12) + 1]);
}

const txns: Txn[] = [];
/** Last valid day of month `m` (1-12) in year `y` — clamps day-28/30 fixed flows in short months. */
const daysInMonth = (y: number, m: number): number =>
	new Date(y, m, 0).getDate();
const add = (
	y: number,
	m: number,
	d: number,
	narration: string,
	amount: number,
) => txns.push({ y, m, d: Math.min(d, daysInMonth(y, m)), narration, amount });

MONTHS.forEach(([y, m], idx) => {
	const salary = idx >= 9 ? 140000 : 125000; // a raise from the 2026-04 FY
	// fixed monthly flows
	add(y, m, 1, "SALARY CREDIT ACME TECHNOLOGIES", salary);
	add(y, m, 5, "RENT PAYMENT TO LANDLORD", -18000);
	add(y, m, 7, "RENT RECEIVED FROM TENANT FLAT", idx >= 6 ? 13000 : 12000);
	add(y, m, 3, "BSE STAR MF SIP GROWW", -15000);
	// passive income — climbs with idx (the whole point of the app)
	add(
		y,
		m,
		28,
		"MONTHLY INTEREST PAYOUT FD BOND",
		6500 + idx * 560 + rand(-250, 250),
	);
	if (m % 3 === 2)
		add(y, m, 30, "INTEREST CREDIT SB ACCOUNT", rand(1800, 3600));
	if (m % 3 === 0) add(y, m, 20, "DIVIDEND CREDIT EQUITY MF", rand(1500, 4200));
	// consolidated card bill (the rest of card spend lives on the card statement, not here)
	add(y, m, 15, "CRED CCBP SBICARD PAYMENT", -rand(18000, 26000));
	// occasional lump investments
	if (m % 3 === 1)
		add(y, m, 12, "ZERODHA BROKING UPI PURCHASE", -rand(10000, 20000));
	// bank charges + the odd tax deduction
	add(y, m, 2, "SMS CHARGES GST", -rand(24, 60));
	if (m % 4 === 0)
		add(y, m, 26, "TDS DEDUCTED ON DEPOSIT INT", -rand(600, 1800));
	// auto-sweep (transfers — excluded from the KPI)
	if (idx % 2 === 0) {
		add(y, m, 18, "SWEEP TFR TO MOD DR", -rand(8000, 18000));
		add(y, m, 24, "SWEEP TRF FROM MOD", rand(8000, 18000));
	}
	// discretionary UPI/bank spend across categories
	for (const _ of count(6, 9))
		add(y, m, rand(2, 27), pick(FOOD), -rand(180, 850));
	for (const _ of count(4, 7))
		add(y, m, rand(2, 27), pick(GROCERY), -rand(300, 2600));
	for (const _ of count(2, 5))
		add(y, m, rand(2, 27), pick(SHOP), -rand(500, 6500));
	for (const _ of count(5, 8))
		add(y, m, rand(2, 27), pick(TRANSPORT), -rand(90, 1500));
	for (const _ of count(3, 5))
		add(y, m, rand(2, 27), pick(UTIL), -rand(200, 2400));
	for (const _ of count(2, 4))
		add(y, m, rand(2, 27), pick(SUBS), -rand(150, 650));
	for (const _ of count(1, 3))
		add(y, m, rand(2, 27), pick(HEALTH), -rand(180, 2100));
	for (const _ of count(4, 7))
		add(y, m, rand(2, 27), pick(UPI_MISC), -rand(60, 1600));
	if (idx % 2 === 1)
		add(y, m, rand(8, 22), "ATM WDL SBI ATM", -rand(2000, 8000));
});

// order by date, compute the running balance (the txn_id anchor), format the SBI CSV.
txns.sort((a, b) => a.y - b.y || a.m - b.m || a.d - b.d);
const pad = (n: number) => String(n).padStart(2, "0");
let balance = 220000;
const lines = ["Date,Details,Ref No/Cheque No,Debit,Credit,Balance"];
txns.forEach((t, i) => {
	balance += t.amount;
	const debit = t.amount < 0 ? (-t.amount).toFixed(2) : "";
	const credit = t.amount > 0 ? t.amount.toFixed(2) : "";
	const ref = `TXN${String(100000 + i)}`;
	lines.push(
		`${pad(t.d)}/${pad(t.m)}/${t.y},${t.narration},${ref},${debit},${credit},${balance.toFixed(2)}`,
	);
});

// clear any prior seed CSV, then write ours (the only .csv in raw/).
for (const name of readdirSync(RAW_DIR).filter((n) =>
	n.toLowerCase().endsWith(".csv"),
)) {
	rmSync(`${RAW_DIR}/${name}`, { force: true });
}
const csvPath = `${RAW_DIR}/statement-seed.csv`;
writeFileSync(csvPath, `${lines.join("\n")}\n`);
console.log(`[seed-dummy] wrote ${txns.length} transactions → ${csvPath}`);

// ── SQLite app-state ────────────────────────────────────────────────────────────────────────────────
const db = createAppDb(`file:${APP_DB}`);

// A believable ~₹33L Indian portfolio: cash-paying income assets drive the KPI, growth assets drive wealth.
const INVESTMENTS = [
	{
		name: "SBI Fixed Deposit",
		type: "fd",
		incomeClass: "income",
		platform: "SBI",
		group: "Fixed Deposits",
		principal: 500000,
		annualRate: 0.071,
		interestCadence: "quarterly",
		payout: "cash",
		isPassiveIncomeSource: true,
		currentValue: 500000,
		startDate: "2024-06-15",
		maturityDate: "2027-06-15",
	},
	{
		name: "HDFC Bank FD",
		type: "fd",
		incomeClass: "income",
		platform: "HDFC Bank",
		group: "Fixed Deposits",
		principal: 300000,
		annualRate: 0.0705,
		interestCadence: "quarterly",
		payout: "cash",
		isPassiveIncomeSource: true,
		currentValue: 300000,
		startDate: "2024-11-02",
		maturityDate: "2026-11-02",
	},
	{
		name: "Wint Wealth — Senior Secured Bond",
		type: "bond",
		incomeClass: "income",
		platform: "Wint Wealth",
		group: "Bonds (Wint)",
		principal: 200000,
		annualRate: 0.1075,
		interestCadence: "monthly",
		payout: "cash",
		isPassiveIncomeSource: true,
		currentValue: 200000,
		startDate: "2025-01-10",
		maturityDate: "2027-07-10",
	},
	{
		name: "SustVest Solar — Green Payout",
		type: "p2p",
		incomeClass: "income",
		platform: "SustVest",
		group: "P2P / Green",
		principal: 100000,
		annualRate: 0.1,
		interestCadence: "monthly",
		payout: "cash",
		isPassiveIncomeSource: true,
		currentValue: 100000,
		startDate: "2025-03-01",
		maturityDate: "2028-03-01",
	},
	{
		name: "Parag Parikh Flexi Cap",
		type: "mutual_fund",
		incomeClass: "growth",
		valuationSource: "manual",
		platform: "Groww",
		group: "Mutual Funds",
		principal: 400000,
		currentValue: 521000,
		startDate: "2023-04-05",
	},
	{
		name: "Nippon India Small Cap",
		type: "mutual_fund",
		incomeClass: "growth",
		valuationSource: "manual",
		platform: "Groww",
		group: "Mutual Funds",
		principal: 200000,
		currentValue: 287500,
		startDate: "2023-09-12",
	},
	{
		name: "Zerodha Equity Portfolio",
		type: "equity",
		incomeClass: "growth",
		valuationSource: "manual",
		platform: "Zerodha",
		group: "Equities",
		principal: 300000,
		currentValue: 381000,
		startDate: "2022-12-01",
	},
	{
		name: "PPF Account",
		type: "other",
		incomeClass: "income",
		platform: "SBI",
		group: "PPF / EPF",
		principal: 600000,
		annualRate: 0.071,
		interestCadence: "yearly",
		payout: "accrue",
		isPassiveIncomeSource: false,
		currentValue: 642000,
		startDate: "2019-04-01",
		maturityDate: "2034-03-31",
	},
	{
		name: "SBI Savings (MOD sweep)",
		type: "savings",
		incomeClass: "income",
		platform: "SBI",
		group: "Cash",
		principal: 150000,
		annualRate: 0.055,
		interestCadence: "quarterly",
		payout: "cash",
		isPassiveIncomeSource: true,
		currentValue: 150000,
	},
	{
		name: "SGB Sovereign Gold Bond",
		type: "gold",
		incomeClass: "growth",
		platform: "RBI Retail Direct",
		group: "Gold",
		principal: 100000,
		annualRate: 0.025,
		interestCadence: "half_yearly",
		payout: "cash",
		isPassiveIncomeSource: true,
		currentValue: 129500,
		startDate: "2023-08-01",
		maturityDate: "2031-08-01",
	},
] as const;

const RECURRING = [
	{
		name: "House rent",
		category: "rent",
		amount: 18000,
		cadence: "monthly",
		currency: "INR",
	},
	{
		name: "Groceries",
		category: "groceries",
		amount: 11000,
		cadence: "monthly",
		currency: "INR",
	},
	{
		name: "Electricity + gas",
		category: "utilities",
		amount: 2600,
		cadence: "monthly",
		currency: "INR",
	},
	{
		name: "Mobile + broadband",
		category: "utilities",
		amount: 1400,
		cadence: "monthly",
		currency: "INR",
	},
	{
		name: "OTT subscriptions",
		category: "subscription",
		amount: 1200,
		cadence: "monthly",
		currency: "INR",
	},
	{
		name: "Term + health insurance",
		category: "insurance_premium",
		amount: 52000,
		cadence: "yearly",
		currency: "INR",
	},
	{
		name: "Claude Max",
		category: "subscription",
		amount: 200,
		cadence: "monthly",
		currency: "USD",
	},
	{
		name: "Contabo VPS",
		category: "utilities",
		amount: 15,
		cadence: "monthly",
		currency: "EUR",
	},
	{
		name: "Gym membership",
		category: "health",
		amount: 1800,
		cadence: "monthly",
		currency: "INR",
	},
] as const;

// net worth log: 15 monthly points climbing ~₹21.8L → ~₹34.5L, with a little noise.
const NETWORTH: Array<{ asOf: string; value: number; source: string }> = [];
{
	const start = 2025 * 12 + (5 - 1); // 2025-05
	for (let i = 0; i < 15; i++) {
		const ym = start + i;
		const y = Math.floor(ym / 12);
		const mo = (ym % 12) + 1;
		const base = 2180000 + i * 88000 + Math.round((rng() - 0.5) * 40000);
		NETWORTH.push({
			asOf: `${y}-${pad(mo)}-01`,
			value: base,
			source: i % 4 === 0 ? "manual" : "computed",
		});
	}
}

await db.delete(investments);
await db.delete(recurringExpenses);
await db.delete(networthLogs);
await db.delete(taxProfiles);

await db.insert(investments).values(INVESTMENTS.map((v) => ({ ...v })));
await db.insert(recurringExpenses).values(RECURRING.map((v) => ({ ...v })));
await db.insert(networthLogs).values(NETWORTH);
await db.insert(taxProfiles).values({
	fy: "FY2026-27",
	regimeChoice: "new",
	salaryIncome: 1560000,
	otherIncome: 245000,
	basicSalary: 780000,
	hraReceived: 312000,
	rentPaid: 216000,
	metro: true,
	capitalGains: {
		equityStcg: 0,
		equityLtcg: 85000,
		crypto: 0,
		otherStcg: 0,
		otherLtcg: 0,
	},
	deductions: { s80c: 150000, s80d: 25000, s80tta: 10000, s80dd: 0 },
});

console.log(
	`[seed-dummy] seeded app.db: ${INVESTMENTS.length} investments, ${RECURRING.length} recurring, ${NETWORTH.length} net-worth points, 1 tax profile`,
);

// ── coverage history backfill (the home dashboard hero trend) ─────────────────────────────────────
// The hero reads coverage_snapshots, which are empty until plan.ladder runs — and plan.ladder only ever
// writes the current month, so a fresh user's trend line has nothing to draw. Backfill ~12 months,
// scaling the plan's income up toward the present so the north-star ratio visibly climbs. The stored
// plan_json is the same {investments, recurring} shape plan.ladder writes: INR-normalised, pre-tax.
const controlDb = createControlDb(`file:${controlDbPath(env.DATA_DIR)}`);
const curRows = await controlDb.select().from(currencies);
// INR per 1 unit. Fallbacks keep USD/EUR realistic if the shared config hasn't enabled them yet.
const rateToInr = new Map<string, number>([
	["USD", 83.5],
	["EUR", 90],
	...curRows.map((c) => [c.code, c.rateToInr] as [string, number]),
]);
const toInr = (amt: number, cur = "INR"): number =>
	amt * (rateToInr.get(cur) ?? 1);

// The shared Investment shape coverageLadder consumes (all seeded holdings are already INR).
const inrInvestments = INVESTMENTS.map((v, i) => ({
	id: String(i + 1),
	name: v.name,
	type: v.type,
	incomeClass: v.incomeClass,
	valuationSource: "valuationSource" in v ? v.valuationSource : "manual",
	isPassiveIncomeSource:
		"isPassiveIncomeSource" in v ? v.isPassiveIncomeSource : false,
	active: true,
	platform: v.platform,
	group: v.group,
	payout: "payout" in v ? v.payout : undefined,
	principal: v.principal,
	annualRate: "annualRate" in v ? v.annualRate : undefined,
	interestCadence: "interestCadence" in v ? v.interestCadence : undefined,
	currentValue: v.currentValue,
	currency: "INR",
	startDate: "startDate" in v ? v.startDate : undefined,
	maturityDate: "maturityDate" in v ? v.maturityDate : undefined,
	status: "active",
}));
const inrRecurring = RECURRING.map((r, i) => ({
	id: String(i + 1),
	name: r.name,
	category: r.category,
	amount: Math.round(toInr(r.amount, r.currency)),
	currency: "INR",
	cadence: r.cadence,
	active: true,
}));
const scale = (f: number) =>
	inrInvestments.map((inv) => ({
		...inv,
		principal:
			inv.principal == null ? inv.principal : Math.round(inv.principal * f),
		currentValue:
			inv.currentValue == null
				? inv.currentValue
				: Math.round(inv.currentValue * f),
	}));

const snapshots: Array<{ month: string; planJson: string }> = [];
const snapStart = 2025 * 12 + (8 - 1); // 2025-08
for (let i = 0; i < 12; i++) {
	const ym = snapStart + i;
	const sy = Math.floor(ym / 12);
	const sm = (ym % 12) + 1;
	const f = 0.6 + 0.4 * (i / 11); // 0.60 (oldest) → 1.00 (current)
	snapshots.push({
		month: `${sy}-${pad(sm)}`,
		planJson: JSON.stringify({
			investments: scale(f),
			recurring: inrRecurring,
		}),
	});
}
await db.delete(coverageSnapshots);
await db.insert(coverageSnapshots).values(snapshots);
console.log(
	`[seed-dummy] backfilled ${snapshots.length} coverage snapshots (${snapshots[0]?.month} → ${snapshots.at(-1)?.month}, trending up)`,
);

console.log(
	`[seed-dummy] NEXT: bun --env-file=apps/server/.env scripts/ingest.ts --user ${USER}`,
);
