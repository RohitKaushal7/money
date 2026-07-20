import {
	type ControlDb,
	cardAssignments,
	cardExtras,
	cardRewardRules,
	cardSpendProfile,
	cards,
	settings,
} from "@money/db";
import {
	bestCardForCategory,
	type CardInfo,
	type RewardRule,
} from "@money/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../index";

/**
 * The **cards** router (issue 005). Read the portfolio + run the "best card for X" picker; light human
 * writes (spend profile, wallet/status toggles, purpose assignments). Reward TERMS are advisor-maintained
 * via direct DB writes — no CRUD here.
 */

async function loadRules(controlDb: ControlDb): Promise<RewardRule[]> {
	const rows = await controlDb.select().from(cardRewardRules);
	return rows.map((r) => ({
		cardId: r.cardId,
		category: r.category,
		isBase: r.isBase,
		rate: r.rate,
		rateText: r.rateText,
		cap: r.cap,
		capText: r.capText,
		condition: r.condition,
		rewardType: r.rewardType,
		isExclusion: r.isExclusion,
	}));
}

async function gotchasByCard(
	controlDb: ControlDb,
): Promise<Record<number, string[]>> {
	const rows = await controlDb.select().from(cardExtras);
	const out: Record<number, string[]> = {};
	for (const r of rows) {
		const g = r.gotchas;
		if (Array.isArray(g)) out[r.cardId] = g.map((x) => String(x));
	}
	return out;
}

export const cardsRouter = {
	/** The full portfolio: cards + their rules + extras (dashboard table). */
	list: protectedProcedure.handler(async ({ context }) => {
		const [cardRows, ruleRows, extraRows] = await Promise.all([
			context.controlDb.select().from(cards),
			context.controlDb.select().from(cardRewardRules),
			context.controlDb.select().from(cardExtras),
		]);
		const rulesByCard = new Map<number, typeof ruleRows>();
		for (const r of ruleRows) {
			const arr = rulesByCard.get(r.cardId) ?? [];
			arr.push(r);
			rulesByCard.set(r.cardId, arr);
		}
		const extraByCard = new Map(extraRows.map((e) => [e.cardId, e]));
		return cardRows.map((c) => ({
			...c,
			rules: rulesByCard.get(c.id) ?? [],
			extras: extraByCard.get(c.id) ?? null,
		}));
	}),

	/** Best card for a category — ranked, with caveats. */
	pick: protectedProcedure
		.input(z.object({ category: z.string() }))
		.handler(async ({ context, input }) => {
			const [cardRows, rules, gotchas] = await Promise.all([
				context.controlDb.select().from(cards),
				loadRules(context.controlDb),
				gotchasByCard(context.controlDb),
			]);
			const infos: CardInfo[] = cardRows
				.filter((c) => c.active)
				.map((c) => ({
					id: c.id,
					name: c.name,
					isLtf: c.isLtf,
					network: c.network,
					status: c.status,
				}));
			return bestCardForCategory(input.category, infos, rules, gotchas);
		}),

	/** CIBIL / portfolio score from settings. */
	health: protectedProcedure.handler(async ({ context }) => {
		const rows = await context.appDb.select().from(settings);
		const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
		return {
			cibil: get("cibil_score"),
			portfolioScore: get("portfolio_score"),
		};
	}),

	spendProfile: protectedProcedure.handler(({ context }) =>
		context.controlDb.select().from(cardSpendProfile),
	),
	setSpend: protectedProcedure
		.input(
			z.object({
				category: z.string(),
				monthlyAmount: z.number().nonnegative(),
			}),
		)
		.handler(async ({ context, input }) => {
			await context.controlDb
				.insert(cardSpendProfile)
				.values(input)
				.onConflictDoUpdate({
					target: cardSpendProfile.category,
					set: { monthlyAmount: input.monthlyAmount },
				});
			return context.controlDb.select().from(cardSpendProfile);
		}),

	assignments: protectedProcedure.handler(({ context }) =>
		context.controlDb.select().from(cardAssignments),
	),
	setAssignment: protectedProcedure
		.input(
			z.object({
				purpose: z.string(),
				cardId: z.number().int(),
				note: z.string().optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			await context.controlDb
				.insert(cardAssignments)
				.values({
					purpose: input.purpose,
					cardId: input.cardId,
					note: input.note ?? null,
				})
				.onConflictDoUpdate({
					target: cardAssignments.purpose,
					set: { cardId: input.cardId, note: input.note ?? null },
				});
			return context.controlDb.select().from(cardAssignments);
		}),

	/** Light per-card human toggles. */
	setCardFlags: protectedProcedure
		.input(
			z.object({
				id: z.number().int(),
				inWallet: z.boolean().optional(),
				status: z.string().optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			const set: Record<string, unknown> = {};
			if (input.inWallet != null) set.inWallet = input.inWallet;
			if (input.status != null) {
				set.status = input.status;
				set.active = input.status === "active";
			}
			if (Object.keys(set).length) {
				await context.controlDb
					.update(cards)
					.set(set)
					.where(eq(cards.id, input.id));
			}
			const [row] = await context.controlDb
				.select()
				.from(cards)
				.where(eq(cards.id, input.id));
			return row ?? null;
		}),
};
