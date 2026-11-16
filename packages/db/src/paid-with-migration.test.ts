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
const dir = mkdtempSync(join(tmpdir(), "money-paid-with-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("0012/0013 turn v1.3.0's method + card into paid_with text and drop the old columns", async () => {
	const before = join(dir, "before");
	cpSync(APP_MIGRATIONS, before, { recursive: true });
	const journalPath = join(before, "meta", "_journal.json");
	const journal = JSON.parse(readFileSync(journalPath, "utf8"));
	const idx = journal.entries.findIndex(
		(e: { tag: string }) => e.tag === "0012_paid_with",
	);
	journal.entries = journal.entries.slice(0, idx);
	writeFileSync(journalPath, JSON.stringify(journal));

	const client = createClient({ url: `file:${join(dir, "app.db")}` });
	const db = drizzle({ client });
	await migrate(db, { migrationsFolder: before });
	await client.execute(
		"INSERT INTO cards (id, name) VALUES (7, 'HDFC Swiggy')",
	);
	await client.execute(`INSERT INTO recurring_expenses (id, name, amount, payment_method, card_id) VALUES
		(1, 'a', 1, 'card', 7), (2, 'b', 1, 'upi_autopay', NULL), (3, 'c', 1, NULL, NULL), (4, 'd', 1, 'card', NULL)`);

	await migrate(db, { migrationsFolder: APP_MIGRATIONS });

	const rows = await client.execute(
		"SELECT paid_with FROM recurring_expenses ORDER BY id",
	);
	expect(rows.rows.map((r) => r.paid_with)).toEqual([
		"HDFC Swiggy",
		"UPI AutoPay",
		null,
		"Credit card",
	]);
	const cols = await client.execute("PRAGMA table_info(recurring_expenses)");
	const names = cols.rows.map((c) => c.name);
	expect(names).toContain("paid_with");
	expect(names).not.toContain("payment_method");
	expect(names).not.toContain("card_id");
	client.close();
});
