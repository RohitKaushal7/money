import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { axioRowId } from "@money/shared";
import { buildAxioSelect } from "./build-axio-select";
import { openConnection } from "./duckdb";
import { applySchema } from "./ingest";

// A faithful slice of an Axio export: 6-line preamble, header on line 7, rows, a blank line, a footer.
const CSV = [
	'"","axio","EXPENSE","REPORT","","","","","","",""',
	'"Name","Jane Doe ","","","","","","","","",""',
	'"Phone Number","\'+919000000000","","","","","","","","",""',
	'"Email","jane@example.com","","","","","","","","",""',
	'"FROM","2026-06-01","TO","2026-06-30"',
	"",
	'"DATE","TIME","PLACE","AMOUNT","DR/CR","ACCOUNT","EXPENSE","INCOME","CATEGORY","TAGS","NOTE"',
	'"2026-06-02","03:49 PM","BLINKIT","1,648.7","DR","Axis credit 1111","Yes","\'-","GROCERIES","#Online",""',
	'"2026-06-03","05:14 PM","M/S.HUNGRY POINT","380","DR","YesBank credit 2222","Yes","\'-","FOOD & DRINKS","",""',
	'"2026-06-01","01:51 PM","M S SAINI TRADERS","30,500","DR","YesBank credit 2222","No","\'-","TRANSFER","",""',
	'"2026-06-04","08:00 AM","SBI DIVIDEND FY26","277.6","CR","SBI  3333","\'-","No","CREDIT","",""',
	"",
	'"","","","","","","","POWERED","","",""',
].join("\n");

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "money-axio-"));
});
afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

async function parse(): Promise<Record<string, unknown>[]> {
	const path = join(dir, "axio.csv");
	writeFileSync(path, CSV);
	const conn = await openConnection(":memory:", "read_write");
	try {
		return await conn.query(
			`SELECT * FROM (${buildAxioSelect(path, "axio.csv")}) ORDER BY txn_date, place`,
		);
	} finally {
		await conn.close();
	}
}

describe("buildAxioSelect", () => {
	test("keeps only real data rows (preamble, blank, POWERED footer dropped)", async () => {
		const rows = await parse();
		expect(rows).toHaveLength(4); // 2 expenses + 1 transfer + 1 credit
	});

	test("EXPENSE=Yes spend sums correctly, commas stripped", async () => {
		const rows = await parse();
		const spend = rows
			.filter((r) => r.is_expense === true)
			.reduce((s, r) => s + Number(r.amount), 0);
		expect(spend).toBeCloseTo(2028.7, 2); // 1648.7 + 380
	});

	test("flags and native category are preserved verbatim", async () => {
		const rows = await parse();
		const blinkit = rows.find((r) => r.place === "BLINKIT");
		expect(blinkit?.is_expense).toBe(true);
		expect(blinkit?.category).toBe("GROCERIES");
		expect(blinkit?.month).toBe("2026-06");
		const credit = rows.find((r) => r.drcr === "CR");
		expect(credit?.is_expense).toBe(false);
		expect(credit?.is_income).toBe(false);
	});

	test("axio_id matches the shared axioRowId (parse ↔ pure parity)", async () => {
		const rows = await parse();
		const blinkit = rows.find((r) => r.place === "BLINKIT");
		expect(blinkit?.axio_id).toBe(
			axioRowId({
				date: "2026-06-02",
				time: "03:49 PM",
				amount: 1648.7,
				drcr: "DR",
				account: "Axis credit 1111",
				place: "BLINKIT",
			}),
		);
	});

	test("re-parsing yields identical ids (idempotent replace is lossless)", async () => {
		const a = await parse();
		const b = await parse();
		expect(b.map((r) => r.axio_id).sort()).toEqual(
			a.map((r) => r.axio_id).sort(),
		);
	});

	test("INSERT via buildAxioSelect populates axio_expenses and de-dupes by id", async () => {
		const path = join(dir, "axio-load.csv");
		writeFileSync(path, CSV);
		const conn = await openConnection(":memory:", "read_write");
		try {
			await applySchema(conn);
			const sel = buildAxioSelect(path, "axio-load.csv");
			await conn.run(
				`INSERT INTO axio_expenses BY NAME (${sel}) ON CONFLICT DO NOTHING`,
			);
			await conn.run(
				`INSERT INTO axio_expenses BY NAME (${sel}) ON CONFLICT DO NOTHING`,
			); // replace re-runs
			const counted = await conn.query<{ n: number }>(
				"SELECT count(*) AS n FROM axio_expenses",
			);
			expect(Number(counted[0]?.n)).toBe(4); // still 4 — ON CONFLICT dropped the second pass
		} finally {
			await conn.close();
		}
	});
});
