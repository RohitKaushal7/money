/**
 * Statement import mappings (spec 2026-07-21 generic CSV importer). A *format* describes how to turn one
 * bank's clean CSV (single header row, comma-delimited, UTF-8) into canonical `transactions` rows.
 *
 * This module is the framework-agnostic contract shared by every layer: the DuckDB engine
 * (`@money/analytics` builds the parse SQL from a `StatementMapping`), the seed (`@money/db` seeds the SBI
 * built-in), the API (validates + auto-matches by header signature), and the web mapping wizard.
 */

export type AmountMode = "signed" | "debit_credit" | "amount_indicator";
export type SignConvention = "credit_positive" | "debit_positive";
export type StatementAnchor = "balance" | "ref";

/** Named cleanup transforms a format opts into for messiness a plain column-map can't express. */
export const STATEMENT_QUIRKS = ["multiline_unwrap"] as const;
export type StatementQuirk = (typeof STATEMENT_QUIRKS)[number];

/**
 * The parsing contract the engine consumes — columns + derivation for one format, independent of DB
 * bookkeeping (id / name / account / timestamps). Column values are the *source* CSV header names.
 */
export type StatementMapping = {
	dateCol: string;
	/** DuckDB strptime format, e.g. "%d/%m/%Y". */
	dateFmt: string;
	amountMode: AmountMode;
	/** signed / amount_indicator modes */
	amountCol?: string | null;
	/** signed mode: which sign of `amountCol` is a credit */
	signConvention?: SignConvention | null;
	/** debit_credit mode */
	debitCol?: string | null;
	creditCol?: string | null;
	/** amount_indicator mode */
	indicatorCol?: string | null;
	/** amount_indicator mode: the token meaning "credit" (compared case-insensitively), e.g. "CR" */
	creditToken?: string | null;
	narrationCol: string;
	refCol?: string | null;
	balanceCol?: string | null;
	valueDateCol?: string | null;
	anchor: StatementAnchor;
	quirks: StatementQuirk[];
};

const UNIT_SEP = "\u001f";

/**
 * Normalise a CSV header row to the stable auto-match signature: trimmed column names, in order, joined by a
 * unit-separator control char. An exact signature match means "this is a known format".
 */
export function statementHeaderSignature(headers: string[]): string {
	return headers.map((h) => h.trim()).join(UNIT_SEP);
}

/** Parse the JSON-encoded `quirks` column into a validated list (unknown entries dropped). */
export function parseStatementQuirks(
	json: string | null | undefined,
): StatementQuirk[] {
	if (!json) return [];
	try {
		const parsed = JSON.parse(json);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((q): q is StatementQuirk =>
			STATEMENT_QUIRKS.includes(q as StatementQuirk),
		);
	} catch {
		return [];
	}
}

/**
 * Validate a mapping's internal consistency: the active amount mode has its columns, and the chosen identity
 * anchor has its column (spec: require a balance-or-ref anchor). Returns an error message, or null if valid.
 */
export function validateStatementMapping(m: StatementMapping): string | null {
	if (!m.dateCol) return "A date column is required.";
	if (!m.dateFmt) return "A date format is required.";
	if (!m.narrationCol) return "A narration column is required.";
	switch (m.amountMode) {
		case "debit_credit":
			if (!m.debitCol || !m.creditCol)
				return "Debit and credit columns are required for the debit/credit amount mode.";
			break;
		case "signed":
			if (!m.amountCol)
				return "An amount column is required for the signed amount mode.";
			if (
				m.signConvention !== "credit_positive" &&
				m.signConvention !== "debit_positive"
			)
				return "A sign convention is required for the signed amount mode.";
			break;
		case "amount_indicator":
			if (!m.amountCol)
				return "An amount column is required for the indicator amount mode.";
			if (!m.indicatorCol)
				return "An indicator column is required for the indicator amount mode.";
			if (!m.creditToken)
				return "A credit token (e.g. CR) is required for the indicator amount mode.";
			break;
		default:
			return `Unknown amount mode: ${m.amountMode as string}`;
	}
	if (m.anchor === "balance" && !m.balanceCol)
		return "A balance column is required when the identity anchor is balance.";
	if (m.anchor === "ref" && !m.refCol)
		return "A reference column is required when the identity anchor is ref.";
	return null;
}

/** A seeded built-in format: the mapping plus the bookkeeping the seed needs. */
export type SeedFormat = {
	/** stable machine key for the built-in (never renamed); null for user formats in the DB. */
	builtin: string;
	name: string;
	system: boolean;
	accountId: number;
	/** the exact header row this built-in matches; the signature is derived from it. */
	headers: string[];
	mapping: StatementMapping;
};

/** SBI savings statement: `Date,Details,Ref No/Cheque No,Debit,Credit,Balance` (the original hard-coded format). */
export const SBI_SEED_FORMAT: SeedFormat = {
	builtin: "sbi",
	name: "SBI",
	system: true,
	accountId: 1,
	headers: [
		"Date",
		"Details",
		"Ref No/Cheque No",
		"Debit",
		"Credit",
		"Balance",
	],
	mapping: {
		dateCol: "Date",
		dateFmt: "%d/%m/%Y",
		amountMode: "debit_credit",
		debitCol: "Debit",
		creditCol: "Credit",
		narrationCol: "Details",
		refCol: "Ref No/Cheque No",
		balanceCol: "Balance",
		anchor: "balance",
		quirks: ["multiline_unwrap"],
	},
};
