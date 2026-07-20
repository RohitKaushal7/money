#!/usr/bin/env bun
/**
 * One-time seed: the packages/info credit-card YAMLs → SQLite (issue 005 / cards). Run `bun run cards:import`.
 * Idempotent (upsert by card name; a card's reward rules are cleared before re-insert). Reads the gitignored
 * packages/info; does NOT delete the source. Rates are parsed best-effort to numbers with the raw string kept.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	cardExtras,
	cardRewardRules,
	cardSpendProfile,
	cards,
	createControlDb,
	settings,
} from "@money/db";
import { eq } from "drizzle-orm";
import { parse as parseYaml } from "yaml";
import { mapCategory, parseFee, parseRate } from "./cards-parse";

// ── I/O below (the pure parse helpers live in ./cards-parse and are unit-tested there) ────────────────

const db = createControlDb();

const INFO_DIR = fileURLToPath(new URL("../packages/info", import.meta.url));

interface RawBoost {
	on?: string;
	rate?: string;
	condition?: string;
	cap?: string | number;
}

interface RawCard {
	name: string;
	issuer?: string;
	network?: string;
	variant?: string;
	status?: string;
	lifetime_free?: boolean;
	vintage?: number;
	last_updated?: string;
	terms_effective?: string;
	confidence?: string;
	fees?: {
		joining?: string | number;
		annual?: string | number;
		annual_waiver?: string;
		forex_markup?: string;
	};
	rewards?: {
		currency?: string;
		base_rate?: string;
		accelerated?: RawBoost[];
	};
	milestones?: unknown;
	lounge?: unknown;
	exclusions?: { category?: string; note?: string }[];
	gotchas?: unknown;
	best_for?: unknown;
	avoid_for?: unknown;
	redemption?: unknown;
	sources?: unknown;
}

async function upsertCard(raw: RawCard): Promise<number> {
	const status = raw.status ?? "active";
	const rowVals = {
		name: raw.name,
		issuer: raw.issuer ?? null,
		network: raw.network ?? null,
		variant: raw.variant ?? null,
		status,
		isLtf: raw.lifetime_free ?? false,
		annualFee: parseFee(raw.fees?.annual),
		joiningFee: parseFee(raw.fees?.joining),
		feeWaiverCondition: raw.fees?.annual_waiver ?? null,
		forexMarkup: parseRate(raw.fees?.forex_markup),
		forexMarkupText: raw.fees?.forex_markup ?? null,
		vintageYear: raw.vintage ?? null,
		lastUpdated: raw.last_updated ?? null,
		termsEffective: raw.terms_effective ?? null,
		confidence: raw.confidence ?? null,
		active: status === "active",
	};
	await db
		.insert(cards)
		.values(rowVals)
		.onConflictDoUpdate({ target: cards.name, set: rowVals });
	const [row] = await db.select().from(cards).where(eq(cards.name, raw.name));
	if (!row) throw new Error(`upsert failed for ${raw.name}`);
	return row.id;
}

async function importCard(raw: RawCard): Promise<void> {
	const id = await upsertCard(raw);

	// reward rules: clear then re-insert (base + each accelerated boost + each exclusion)
	await db.delete(cardRewardRules).where(eq(cardRewardRules.cardId, id));
	const currency = raw.rewards?.currency ?? null;
	const rewardType = /cashback/i.test(currency ?? "") ? "cashback" : "points";
	const ruleRows: (typeof cardRewardRules.$inferInsert)[] = [];
	if (raw.rewards?.base_rate) {
		ruleRows.push({
			cardId: id,
			category: "base",
			isBase: true,
			rate: parseRate(raw.rewards.base_rate),
			rateText: raw.rewards.base_rate,
			rewardType,
			rewardCurrency: currency,
			isExclusion: false,
		});
	}
	for (const b of raw.rewards?.accelerated ?? []) {
		const capNum = typeof b.cap === "number" ? b.cap : parseFee(b.cap);
		ruleRows.push({
			cardId: id,
			category: mapCategory(b.on),
			isBase: false,
			rate: parseRate(b.rate),
			rateText: b.rate ?? null,
			cap: capNum,
			capText: typeof b.cap === "string" ? b.cap : null,
			condition: typeof b.condition === "string" ? b.condition : null,
			rewardType,
			rewardCurrency: currency,
			isExclusion: false,
		});
	}
	for (const ex of raw.exclusions ?? []) {
		ruleRows.push({
			cardId: id,
			category: mapCategory(ex.category),
			isBase: false,
			rate: 0,
			condition: ex.note ?? null,
			isExclusion: true,
		});
	}
	if (ruleRows.length) await db.insert(cardRewardRules).values(ruleRows);

	// extras (JSON) — lossless bucket for the irregular rich bits
	const extraVals = {
		cardId: id,
		milestones: raw.milestones ?? null,
		gotchas: raw.gotchas ?? null,
		lounge: raw.lounge ?? null,
		exclusions: raw.exclusions ?? null,
		bestFor: raw.best_for ?? null,
		avoidFor: raw.avoid_for ?? null,
		redemption: raw.redemption ?? null,
		sources: raw.sources ?? null,
	};
	await db
		.insert(cardExtras)
		.values(extraVals)
		.onConflictDoUpdate({ target: cardExtras.cardId, set: extraVals });
}

async function importSpendProfile(): Promise<void> {
	const path = join(INFO_DIR, "spending/spending-profile.yaml");
	const doc = parseYaml(readFileSync(path, "utf8")) as {
		monthly?: Record<string, number>;
	};
	for (const [category, monthlyAmount] of Object.entries(doc.monthly ?? {})) {
		const vals = { category: mapCategory(category), monthlyAmount };
		await db
			.insert(cardSpendProfile)
			.values(vals)
			.onConflictDoUpdate({ target: cardSpendProfile.category, set: vals });
	}
}

async function importHealth(): Promise<void> {
	const path = join(INFO_DIR, "tracking/portfolio-health.yaml");
	try {
		const doc = parseYaml(readFileSync(path, "utf8")) as Record<
			string,
			unknown
		>;
		for (const key of ["cibil_score", "portfolio_score"]) {
			const v = doc[key];
			if (v != null) {
				await db
					.insert(settings)
					.values({ key, value: v })
					.onConflictDoUpdate({ target: settings.key, set: { value: v } });
			}
		}
	} catch {
		// portfolio-health is optional
	}
}

async function main(): Promise<void> {
	const dir = join(INFO_DIR, "portfolio/cards");
	const files = readdirSync(dir).filter(
		(f) => f.endsWith(".yaml") && !f.startsWith("_"),
	);
	let n = 0;
	for (const f of files) {
		const raw = parseYaml(readFileSync(join(dir, f), "utf8")) as RawCard;
		if (!raw?.name) continue;
		await importCard(raw);
		n++;
	}
	await importSpendProfile();
	await importHealth();
	console.log(`[cards:import] imported ${n} cards + spend profile + health`);
}

// only run the seed when executed directly (`bun run cards:import`), not when the test imports the helpers
if (import.meta.main) await main();
