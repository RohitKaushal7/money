import { afterAll, expect, test } from "bun:test";
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const APP_MIGRATIONS = fileURLToPath(
	new URL("./migrations/app", import.meta.url),
);
const dir = mkdtempSync(join(tmpdir(), "money-iso-dates-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A copy of the app migrations that stops just before `0010_iso_dates` — the state of a pre-1.2 install. */
function migrationsBefore(tag: string): string {
	const out = join(dir, "before");
	cpSync(APP_MIGRATIONS, out, { recursive: true });
	const journalPath = join(out, "meta", "_journal.json");
	const journal = JSON.parse(readFileSync(journalPath, "utf8"));
	const idx = journal.entries.findIndex((e: { tag: string }) => e.tag === tag);
	journal.entries = journal.entries.slice(0, idx);
	writeFileSync(journalPath, JSON.stringify(journal));
	return out;
}

test("0010 rewrites day-first dates to YYYY-MM-DD and leaves what it can't read", async () => {
	const url = `file:${join(dir, "app.db")}`;
	const client = createClient({ url });
	const db = drizzle({ client });
	await migrate(db, { migrationsFolder: migrationsBefore("0010_iso_dates") });

	const holdings: [number, string | null, string | null][] = [
		[1, null, "31/07/2027"],
		[2, "7/6/2026", "07/06/2027"],
		[3, "2026-01-05", "25-02-2027"],
		[4, null, "25.02.2027"],
		[5, null, "27-11-27"], // two-digit year: unreadable, left alone
		[6, null, "31/02/2027"], // not a real day: left alone
		[7, "", "2027-11-27"], // already stored right; empty clears
	];
	for (const [id, start, maturity] of holdings) {
		await client.execute({
			sql: "INSERT INTO investments (id, name, type, income_class, start_date, maturity_date) VALUES (?, 'h', 'fd', 'income', ?, ?)",
			args: [id, start, maturity],
		});
	}
	await client.execute(
		"INSERT INTO recurring_expenses (id, name, amount, start_date, end_date) VALUES (1, 'r', 1, '2024-07-01', ''), (2, 'r', 1, '15/11/2026', '1-1-2027')",
	);

	await migrate(db, { migrationsFolder: APP_MIGRATIONS });

	const inv = await client.execute(
		"SELECT id, start_date, maturity_date FROM investments ORDER BY id",
	);
	expect(inv.rows.map((r) => [r.start_date, r.maturity_date])).toEqual([
		[null, "2027-07-31"],
		["2026-06-07", "2027-06-07"],
		["2026-01-05", "2027-02-25"],
		[null, "2027-02-25"],
		[null, "27-11-27"],
		[null, "31/02/2027"],
		[null, "2027-11-27"],
	]);
	const rec = await client.execute(
		"SELECT start_date, end_date FROM recurring_expenses ORDER BY id",
	);
	expect(rec.rows.map((r) => [r.start_date, r.end_date])).toEqual([
		["2024-07-01", null],
		["2026-11-15", "2027-01-01"],
	]);
	client.close();
});
