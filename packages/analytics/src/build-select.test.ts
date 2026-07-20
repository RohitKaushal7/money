import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SBI_SEED_FORMAT, type StatementMapping } from "@money/shared";
import { buildTransactionsSelect } from "./build-select";
import { openConnection } from "./duckdb";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
/** Expected txn_id for the documented key: md5(account | date | amount | anchor | occ). */
const key = (
	account: number,
	date: string,
	amount: number,
	anchor: string,
	occ = 0,
) => md5(`${account}|${date}|${amount.toFixed(2)}|${anchor}|${occ}`);

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "money-bs-"));
});
afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

async function run(
	name: string,
	csv: string,
	mapping: StatementMapping,
	accountId = 1,
): Promise<Record<string, unknown>[]> {
	const path = join(dir, `${name}.csv`);
	writeFileSync(path, csv);
	const conn = await openConnection(":memory:", "read_write");
	try {
		const select = buildTransactionsSelect(mapping, {
			csvPath: path,
			accountId,
			sourceFile: `${name}.csv`,
			importBatchId: 1,
		});
		return await conn.query(
			`SELECT * FROM (${select}) ORDER BY txn_date, narration`,
		);
	} finally {
		await conn.close();
	}
}

describe("SBI (debit_credit, balance anchor) — key preservation", () => {
	// A quoted multi-line Details field exercises the multiline_unwrap quirk.
	const csv = [
		"Date,Details,Ref No/Cheque No,Debit,Credit,Balance",
		"01/05/2024,SALARY MAY,,,5000.00,10000.00",
		"02/05/2024,RENT,CHQ123,200.00,,9800.00",
		'03/05/2024,"POS/cre',
		' dit card",,50.00,,9750.00',
	].join("\n");

	test("derives amount/debit/credit and the SBI txn_id", async () => {
		const rows = await run("sbi", csv, SBI_SEED_FORMAT.mapping);
		expect(rows).toHaveLength(3);

		const salary = rows.find((r) => r.narration === "SALARY MAY");
		expect(Number(salary?.amount)).toBe(5000);
		expect(salary?.credit).not.toBeNull();
		expect(salary?.debit).toBeNull();
		expect(salary?.txn_id).toBe(key(1, "2024-05-01", 5000, "10000.00"));
		expect(salary?.fy).toBe("FY2024-25");
		expect(salary?.month).toBe("2024-05");

		const rent = rows.find((r) => r.narration === "RENT");
		expect(Number(rent?.amount)).toBe(-200);
		expect(rent?.ref_no).toBe("CHQ123");
		expect(rent?.txn_id).toBe(key(1, "2024-05-02", -200, "9800.00"));
	});

	test("multiline_unwrap rejoins the split narration", async () => {
		const rows = await run("sbi", csv, SBI_SEED_FORMAT.mapping);
		expect(rows.some((r) => r.narration === "POS/credit card")).toBe(true);
	});
});

describe("signed amount mode", () => {
	const base: StatementMapping = {
		dateCol: "Date",
		dateFmt: "%Y-%m-%d",
		amountMode: "signed",
		amountCol: "Amount",
		narrationCol: "Narration",
		balanceCol: "Balance",
		anchor: "balance",
		quirks: [],
	};

	test("credit_positive: +credit / -debit", async () => {
		const csv =
			"Date,Narration,Amount,Balance\n2024-05-01,PAY,5000,10000\n2024-05-02,BUY,-200,9800";
		const rows = await run("signed-cp", csv, {
			...base,
			signConvention: "credit_positive",
		});
		const pay = rows.find((r) => r.narration === "PAY");
		expect(Number(pay?.amount)).toBe(5000);
		expect(Number(pay?.credit)).toBe(5000);
		expect(pay?.debit).toBeNull();
		const buy = rows.find((r) => r.narration === "BUY");
		expect(Number(buy?.amount)).toBe(-200);
		expect(Number(buy?.debit)).toBe(200);
		expect(buy?.credit).toBeNull();
	});

	test("debit_positive flips the sign", async () => {
		const csv = "Date,Narration,Amount,Balance\n2024-05-02,BUY,200,9800";
		const rows = await run("signed-dp", csv, {
			...base,
			signConvention: "debit_positive",
		});
		expect(Number(rows[0]?.amount)).toBe(-200);
		expect(Number(rows[0]?.debit)).toBe(200);
	});
});

describe("amount_indicator mode", () => {
	const mapping: StatementMapping = {
		dateCol: "Date",
		dateFmt: "%Y-%m-%d",
		amountMode: "amount_indicator",
		amountCol: "Amount",
		indicatorCol: "Type",
		creditToken: "CR",
		narrationCol: "Narration",
		refCol: "Ref",
		anchor: "ref",
		quirks: [],
	};

	test("Dr/Cr indicator sets the sign (case-insensitive)", async () => {
		const csv =
			"Date,Narration,Amount,Type,Ref\n2024-05-01,PAY,5000,cr,R1\n2024-05-02,BUY,200,DR,R2";
		const rows = await run("indicator", csv, mapping);
		const pay = rows.find((r) => r.narration === "PAY");
		expect(Number(pay?.amount)).toBe(5000);
		expect(Number(pay?.credit)).toBe(5000);
		const buy = rows.find((r) => r.narration === "BUY");
		expect(Number(buy?.amount)).toBe(-200);
		expect(Number(buy?.debit)).toBe(200);
	});
});

describe("ref anchor with blank-ref narration fallback", () => {
	const mapping: StatementMapping = {
		dateCol: "Date",
		dateFmt: "%Y-%m-%d",
		amountMode: "debit_credit",
		debitCol: "Debit",
		creditCol: "Credit",
		narrationCol: "Narration",
		refCol: "Ref",
		anchor: "ref",
		quirks: [],
	};

	test("uses ref when present, narration when blank; balance is null", async () => {
		const csv = [
			"Date,Narration,Debit,Credit,Ref",
			"2024-06-01,COFFEE,100,,UTR9",
			"2024-06-02,SHOP A,50,,",
			"2024-06-02,SHOP B,50,,",
		].join("\n");
		const rows = await run("ref", csv, mapping);

		const coffee = rows.find((r) => r.narration === "COFFEE");
		expect(coffee?.balance).toBeNull();
		expect(coffee?.txn_id).toBe(key(1, "2024-06-01", -100, "UTR9"));

		// two blank-ref rows, same date+amount, different narration → distinct keys via narration fallback
		const a = rows.find((r) => r.narration === "SHOP A");
		const b = rows.find((r) => r.narration === "SHOP B");
		expect(a?.txn_id).toBe(key(1, "2024-06-02", -50, "SHOP A"));
		expect(b?.txn_id).toBe(key(1, "2024-06-02", -50, "SHOP B"));
		expect(a?.txn_id).not.toBe(b?.txn_id);
	});

	test("genuinely-identical blank-ref rows disambiguate via occ", async () => {
		const csv = [
			"Date,Narration,Debit,Credit,Ref",
			"2024-06-03,DUP,10,,",
			"2024-06-03,DUP,10,,",
		].join("\n");
		const rows = await run("ref-dup", csv, mapping);
		expect(rows).toHaveLength(2);
		const ids = new Set(rows.map((r) => r.txn_id));
		expect(ids.size).toBe(2);
		expect(ids.has(key(1, "2024-06-03", -10, "DUP", 0))).toBe(true);
		expect(ids.has(key(1, "2024-06-03", -10, "DUP", 1))).toBe(true);
	});
});
