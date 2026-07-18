import {
	index,
	integer,
	real,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import { timestamps } from "./_helpers";

/**
 * Investment master data (user-edited). Cashflows for XIRR are DERIVED in DuckDB from investment-linked
 * splits (ADR-0012); only the identity/terms and manual valuations live here. `income_class = growth`
 * marks the non-yielding assets eligible for imputed drawdown (ADR-0011).
 */
export const investments = sqliteTable("investments", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	name: text("name").notNull(),
	/** sustvest | wint_wealth | sbi_fd | ppf | stock | mf */
	type: text("type").notNull(),
	/** cash_yielding | growth */
	incomeClass: text("income_class").notNull(),
	/** compute | nav_api | manual */
	valuationSource: text("valuation_source").notNull().default("manual"),
	isPassiveIncomeSource: integer("is_passive_income_source", {
		mode: "boolean",
	})
		.default(false)
		.notNull(),
	/** type-specific: {principal,rate,start,maturity,compounding} | {scheme_code,units} | {symbol,qty} | {lots} */
	terms: text("terms", { mode: "json" }),
	active: integer("active", { mode: "boolean" }).default(true).notNull(),
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
