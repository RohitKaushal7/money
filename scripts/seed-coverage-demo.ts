#!/usr/bin/env bun
import { Database } from "bun:sqlite";
/**
 * Seed SYNTHETIC coverage history so the trend chart has something to draw before real months accumulate.
 *
 *   bun scripts/seed-coverage-demo.ts --user <uid> [--months 12]
 *   bun scripts/seed-coverage-demo.ts --user <uid> --clear      # remove every synthetic row
 *
 * ⚠ This writes fabricated financial history into a real database. Two guards make that safe:
 *
 *   1. Every synthetic row carries `"_demo": true` inside `plan_json`, so it is identifiable forever and
 *      `--clear` removes exactly those rows and nothing else. Genuinely captured months are never touched.
 *   2. The app.db is copied to `app.db.bak-<timestamp>` before any write.
 *
 * The shape is derived by scaling the most recent REAL snapshot backwards, rather than inventing numbers —
 * so the chart shows your actual portfolio's composition, just smaller in the past. Income is scaled down
 * harder than expenses, which is what produces a rising coverage ratio.
 */
import { copyFileSync, existsSync } from "node:fs";

function arg(flag: string): string | undefined {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

const uid = arg("--user");
const months = Number(arg("--months") ?? 12);
const clear = process.argv.includes("--clear");
const dataDir = arg("--data-dir") ?? "data";

if (!uid) {
	console.error(
		"usage: bun scripts/seed-coverage-demo.ts --user <uid> [--months 12] [--clear]",
	);
	process.exit(1);
}

const dbPath = `${dataDir}/users/${uid}/app.db`;
if (!existsSync(dbPath)) {
	console.error(`[seed-coverage] no such database: ${dbPath}`);
	process.exit(1);
}

/** Deterministic ±jitter from a string, so re-running produces the same series. */
function jitter(seed: string, spread: number): number {
	let h = 0;
	for (let i = 0; i < seed.length; i += 1)
		h = (h * 31 + seed.charCodeAt(i)) | 0;
	return ((Math.abs(h) % 1000) / 1000 - 0.5) * 2 * spread;
}

/** Step back n months from a YYYY-MM. */
function minusMonths(month: string, n: number): string {
	const [y, m] = month.split("-").map(Number);
	const d = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1 - n, 1));
	return d.toISOString().slice(0, 7);
}

interface Scalable {
	principal?: number;
	currentValue?: number;
	expectedMonthlyInterest?: number;
	amount?: number;
}

const backup = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
copyFileSync(dbPath, backup);
console.log(`[seed-coverage] backed up -> ${backup}`);

const db = new Database(dbPath);

if (clear) {
	const { c } = db
		.query<{ c: number }, []>(
			"select count(*) c from coverage_snapshots where plan_json like '%\"_demo\":true%'",
		)
		.get() ?? { c: 0 };
	db.run(
		"delete from coverage_snapshots where plan_json like '%\"_demo\":true%'",
	);
	console.log(
		`[seed-coverage] removed ${c} synthetic row(s). Real months kept.`,
	);
	db.close();
	process.exit(0);
}

const latest = db
	.query<{ month: string; plan_json: string }, []>(
		"select month, plan_json from coverage_snapshots where plan_json not like '%\"_demo\":true%' order by month desc limit 1",
	)
	.get();

if (!latest) {
	console.error(
		"[seed-coverage] no real snapshot to derive from. Open the app's Overview once so plan.ladder captures this month, then re-run.",
	);
	db.close();
	process.exit(1);
}

const base = JSON.parse(latest.plan_json) as {
	investments: Scalable[];
	recurring: Scalable[];
};
console.log(
	`[seed-coverage] deriving from real ${latest.month} (${base.investments.length} investments, ${base.recurring.length} recurring)`,
);

const scale = (v: number | undefined, f: number) =>
	v == null ? undefined : Math.round(v * f * 100) / 100;

const insert = db.prepare(
	"insert into coverage_snapshots (month, plan_json) values (?, ?) on conflict(month) do nothing",
);

let written = 0;
for (let n = 1; n <= months; n += 1) {
	const month = minusMonths(latest.month, n);
	const exists = db
		.query<{ c: number }, [string]>(
			"select count(*) c from coverage_snapshots where month = ?",
		)
		.get(month);
	if (exists && exists.c > 0) {
		console.log(`[seed-coverage] ${month} already exists — left alone`);
		continue;
	}

	// Income shrinks ~3.5%/month going back; expenses only ~0.6%. The gap is the rising trend.
	const income = Math.max(0.2, 1 - 0.035 * n + jitter(`${month}i`, 0.02));
	const expense = Math.max(0.5, 1 - 0.006 * n + jitter(`${month}e`, 0.012));

	const snapshot = {
		investments: base.investments.map((i) => ({
			...i,
			principal: scale(i.principal, income),
			currentValue: scale(i.currentValue, income),
			expectedMonthlyInterest: scale(i.expectedMonthlyInterest, income),
		})),
		recurring: base.recurring.map((r) => ({
			...r,
			amount: scale(r.amount, expense),
		})),
		_demo: true,
	};
	insert.run(month, JSON.stringify(snapshot));
	written += 1;
}

console.log(
	`[seed-coverage] wrote ${written} synthetic month(s). Undo with:  bun scripts/seed-coverage-demo.ts --user ${uid} --clear`,
);
db.close();
