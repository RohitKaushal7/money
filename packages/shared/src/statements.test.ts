import { describe, expect, test } from "bun:test";
import {
	SBI_SEED_FORMAT,
	type StatementMapping,
	statementHeaderSignature,
	validateStatementMapping,
} from "./statements";

describe("statementHeaderSignature", () => {
	test("trims and orders column names", () => {
		expect(statementHeaderSignature([" Date ", "Amount"])).toBe(
			statementHeaderSignature(["Date", "Amount"]),
		);
	});

	test("is order-sensitive", () => {
		expect(statementHeaderSignature(["A", "B"])).not.toBe(
			statementHeaderSignature(["B", "A"]),
		);
	});

	test("distinguishes different column sets", () => {
		expect(statementHeaderSignature(["Date", "Debit", "Credit"])).not.toBe(
			statementHeaderSignature(["Date", "Amount"]),
		);
	});
});

describe("validateStatementMapping", () => {
	test("SBI seed mapping is valid", () => {
		expect(validateStatementMapping(SBI_SEED_FORMAT.mapping)).toBeNull();
	});

	test("debit_credit requires both columns", () => {
		const m: StatementMapping = {
			...SBI_SEED_FORMAT.mapping,
			creditCol: null,
		};
		expect(validateStatementMapping(m)).toMatch(/debit and credit/i);
	});

	test("signed requires a sign convention", () => {
		const m: StatementMapping = {
			dateCol: "Date",
			dateFmt: "%d/%m/%Y",
			amountMode: "signed",
			amountCol: "Amount",
			narrationCol: "Narration",
			balanceCol: "Balance",
			anchor: "balance",
			quirks: [],
		};
		expect(validateStatementMapping(m)).toMatch(/sign convention/i);
		expect(
			validateStatementMapping({ ...m, signConvention: "credit_positive" }),
		).toBeNull();
	});

	test("amount_indicator requires amount, indicator, and credit token", () => {
		const base: StatementMapping = {
			dateCol: "Date",
			dateFmt: "%Y-%m-%d",
			amountMode: "amount_indicator",
			amountCol: "Amount",
			indicatorCol: "Dr/Cr",
			creditToken: "CR",
			narrationCol: "Narration",
			refCol: "Ref",
			anchor: "ref",
			quirks: [],
		};
		expect(validateStatementMapping(base)).toBeNull();
		expect(validateStatementMapping({ ...base, creditToken: null })).toMatch(
			/credit token/i,
		);
	});

	test("balance anchor requires a balance column", () => {
		const m: StatementMapping = {
			...SBI_SEED_FORMAT.mapping,
			anchor: "balance",
			balanceCol: null,
		};
		expect(validateStatementMapping(m)).toMatch(/balance column/i);
	});

	test("ref anchor requires a ref column", () => {
		const m: StatementMapping = {
			dateCol: "Date",
			dateFmt: "%Y-%m-%d",
			amountMode: "debit_credit",
			debitCol: "Withdrawal",
			creditCol: "Deposit",
			narrationCol: "Narration",
			anchor: "ref",
			quirks: [],
		};
		expect(validateStatementMapping(m)).toMatch(/reference column/i);
	});
});
