import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { timestamps } from "./_helpers";

/**
 * Per-FY tax inputs (Q11 / issue 005). Income is auto-suggested from the ledger but stored here once
 * confirmed; deductions are manual (old-regime only). Capital gains are a manual FY-end entry, split into
 * the four rate buckets. Slab/regime rules are curated reference data (@money/shared/tax-reference), not here.
 */
export const taxProfiles = sqliteTable("tax_profiles", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	/** e.g. "FY2026-27" */
	fy: text("fy").notNull().unique(),
	/** old | new | null (undecided) */
	regimeChoice: text("regime_choice"),
	salaryIncome: real("salary_income"),
	otherIncome: real("other_income"),
	/** HRA inputs (rent comes from the ledger) */
	basicSalary: real("basic_salary"),
	hraReceived: real("hra_received"),
	metro: integer("metro", { mode: "boolean" }),
	/** { equityStcg, equityLtcg, crypto, otherStcg, otherLtcg } */
	capitalGains: text("capital_gains", { mode: "json" }),
	/** { s80c, s80d, s80tta, s80dd } */
	deductions: text("deductions", { mode: "json" }),
	notes: text("notes"),
	...timestamps,
});
