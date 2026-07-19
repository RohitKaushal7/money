import {
	index,
	integer,
	real,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import { timestamps } from "./_helpers";

/**
 * Investment master data (user-edited) — the **Plan** that drives the coverage KPI (ADR-0011 revised /
 * ADR-0014). `income_class = income` investments contribute expected interest; `growth` ones contribute
 * via imputed drawdown. Realised cashflows/XIRR are DERIVED separately in DuckDB from statement rows.
 */
export const investments = sqliteTable("investments", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	name: text("name").notNull(),
	/** asset class: bond | p2p | fd | ncd | savings | equity | mutual_fund | gold | other */
	type: text("type").notNull(),
	/** income | growth */
	incomeClass: text("income_class").notNull().default("income"),
	/** compute | nav_api | manual */
	valuationSource: text("valuation_source").notNull().default("manual"),
	isPassiveIncomeSource: integer("is_passive_income_source", {
		mode: "boolean",
	})
		.default(false)
		.notNull(),
	/** provider/counterparty, used to reconcile against statement rows ("Wint Wealth", "SustVest") */
	platform: text("platform"),
	/** rollup bucket: holdings sharing a group nest under one header with a weighted-avg XIRR (e.g. "SustVest", "Wint", "FDs") */
	group: text("group"),
	/** invested amount / cost basis (INR rupees) */
	principal: real("principal"),
	/** expected annual interest rate as a fraction, e.g. 0.11 (income investments) */
	annualRate: real("annual_rate"),
	/** explicit expected monthly interest (INR) — overrides principal×rate/12 for amortising instruments */
	expectedMonthlyInterest: real("expected_monthly_interest"),
	/** none|daily|weekly|monthly|quarterly|half_yearly|yearly|maturity */
	interestCadence: text("interest_cadence"),
	/** cash = interest deposited to the account (counts in the "cash in hand" tier); accrue = compounds/paid at maturity */
	payout: text("payout").notNull().default("accrue"),
	principalCadence: text("principal_cadence"),
	/** YYYY-MM-DD */
	startDate: text("start_date"),
	/** YYYY-MM-DD */
	maturityDate: text("maturity_date"),
	/** reinvest | withdraw | auto_renew */
	actionOnMaturity: text("action_on_maturity"),
	/** latest known value (INR) — feeds imputed drawdown + net worth */
	currentValue: real("current_value"),
	/** active | matured | closed */
	status: text("status").notNull().default("active"),
	/** type-specific extras: {compounding} | {scheme_code,units} | {symbol,qty} | {lots} */
	terms: text("terms", { mode: "json" }),
	active: integer("active", { mode: "boolean" }).default(true).notNull(),
	notes: text("notes"),
	...timestamps,
});

/**
 * Recurring committed outflows — the coverage-KPI denominator (ADR-0011 revised). Monthly-normalised in
 * `@money/shared`'s `monthlyAmount`. One-off / irregular spend does NOT live here (that's the actuals view).
 */
export const recurringExpenses = sqliteTable("recurring_expenses", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	name: text("name").notNull(),
	category: text("category"),
	/** INR per period (per `cadence`) */
	amount: real("amount").notNull(),
	/** monthly | quarterly | half_yearly | yearly */
	cadence: text("cadence").notNull().default("monthly"),
	active: integer("active", { mode: "boolean" }).default(true).notNull(),
	/** YYYY-MM-DD */
	startDate: text("start_date"),
	/** YYYY-MM-DD */
	endDate: text("end_date"),
	/** manual | seeded */
	source: text("source").notNull().default("manual"),
	notes: text("notes"),
	...timestamps,
});

/** Manually-entered current values; the resolved valuation series is rebuilt in DuckDB (spec §5). */
export const investmentValuationsManual = sqliteTable(
	"investment_valuations_manual",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		investmentId: integer("investment_id").notNull(),
		/** YYYY-MM-DD */
		asOf: text("as_of").notNull(),
		/** INR (rupees) */
		value: real("value").notNull(),
		note: text("note"),
		...timestamps,
	},
	(t) => [index("ivm_investment_idx").on(t.investmentId)],
);
