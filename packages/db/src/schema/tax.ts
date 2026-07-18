import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { timestamps } from "./_helpers";

/**
 * Per-FY tax inputs (Q11). Income is auto-suggested from the ledger but stored here once confirmed;
 * deductions/exemptions are manual (JSON: 80C/80D/HRA components/home-loan interest/…); capital gains are
 * a manual FY-end section. Slab/regime rules are curated reference data (not this table).
 */
export const taxProfiles = sqliteTable("tax_profiles", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	/** e.g. "FY2026-27" */
	fy: text("fy").notNull().unique(),
	/** old | new | null (undecided) */
	regimeChoice: text("regime_choice"),
	salaryIncome: real("salary_income"),
	otherIncome: real("other_income"),
	capitalGainsStcg: real("capital_gains_stcg"),
	capitalGainsLtcg: real("capital_gains_ltcg"),
	/** { "80C": n, "80D": n, hra: {...}, homeLoanInterest: n, ... } */
	deductions: text("deductions", { mode: "json" }),
	notes: text("notes"),
	...timestamps,
});
