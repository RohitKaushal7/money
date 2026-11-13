import {
	type AppDb,
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
 *
 * Every read and write is scoped to `context.appDb`, i.e. the signed-in user's own store. Cards used to
 * live in the shared control.db behind `adminProcedure`, which meant one card portfolio for the whole
 * install: co-users saw each other's wallet and monthly spend profile, and non-admins got a 403 on the
 * whole tab. Both are gone — a card portfolio is personal, like the plan and the ledger.
 */

async function loadRules(appDb: AppDb): Promise<RewardRule[]> {
	const rows = await appDb.select().from(cardRewardRules);
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

async function gotchasByCard(appDb: AppDb): Promise<Record<number, string[]>> {
	const rows = await appDb.select().from(cardExtras);
	const out: Record<number, string[]> = {};
	for (const r of rows) {
		const g = r.gotchas;
		if (Array.isArray(g)) out[r.cardId] = g.map((x) => String(x));
	}
	return out;
}

export const cardsRouter = {
	/** The full portfolio: cards + their rules + extras (dashboard table). */
	list: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"The owner's credit-card portfolio: every card with its reward rules and extras (annual fee details, gotchas and similar notes). Takes no input. Each card has its stored fields (`id`, `name`, `network`, `status`, `active`, `inWallet`, whether it is lifetime-free, etc.), `rules` (per-category reward rate, cap, condition and reward type) and `extras` (or null). Reward terms are maintained outside the app and are read-only here.",
			},
		})
		.handler(async ({ context }) => {
			const [cardRows, ruleRows, extraRows] = await Promise.all([
				context.appDb.select().from(cards),
				context.appDb.select().from(cardRewardRules),
				context.appDb.select().from(cardExtras),
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
		.meta({
			mcp: {
				kind: "read",
				description:
					"Rank the owner's active cards for spending in one category, best reward first, with caveats. Input: `category` (a spending category name such as dining, fuel or groceries). Returns the ranked cards with the matched reward rule and any gotchas. Read-only.",
			},
		})
		.input(z.object({ category: z.string() }))
		.handler(async ({ context, input }) => {
			const [cardRows, rules, gotchas] = await Promise.all([
				context.appDb.select().from(cards),
				loadRules(context.appDb),
				gotchasByCard(context.appDb),
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
	health: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"The owner's credit health numbers kept in settings. Takes no input. Returns `{ cibil, portfolioScore }` (the CIBIL credit score and the card-portfolio score; each null if never set).",
			},
		})
		.handler(async ({ context }) => {
			const rows = await context.appDb.select().from(settings);
			const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
			return {
				cibil: get("cibil_score"),
				portfolioScore: get("portfolio_score"),
			};
		}),

	spendProfile: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"The owner's typical monthly card spend per category, used when planning which card to use. Takes no input. Returns rows of `{ category, monthlyAmount }` with `monthlyAmount` in INR per month.",
			},
		})
		.handler(({ context }) => context.appDb.select().from(cardSpendProfile)),
	setSpend: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Set the owner's typical monthly card spend for one category, replacing the previous figure for it. Input: `category` (spending category name) and `monthlyAmount` (INR per month, not negative). Returns the full spend profile after the change.",
			},
		})
		.input(
			z.object({
				category: z.string(),
				monthlyAmount: z.number().nonnegative(),
			}),
		)
		.handler(async ({ context, input }) => {
			await context.appDb
				.insert(cardSpendProfile)
				.values(input)
				.onConflictDoUpdate({
					target: cardSpendProfile.category,
					set: { monthlyAmount: input.monthlyAmount },
				});
			return context.appDb.select().from(cardSpendProfile);
		}),

	assignments: protectedProcedure
		.meta({
			mcp: {
				kind: "read",
				description:
					"Which card the owner has assigned to each purpose (e.g. a bill or a spending habit). Takes no input. Returns rows of `{ purpose, cardId, note }`; `cardId` matches `id` in the card list.",
			},
		})
		.handler(({ context }) => context.appDb.select().from(cardAssignments)),
	setAssignment: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					'Assign a card to a purpose, replacing any existing assignment for that purpose. Input: `purpose` (free text, e.g. "fuel"), `cardId` (whole number, a card\'s `id` from the card list), optional `note` (omitting it clears any previous note). Returns all assignments after the change.',
			},
		})
		.input(
			z.object({
				purpose: z.string(),
				cardId: z.number().int(),
				note: z.string().optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			await context.appDb
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
			return context.appDb.select().from(cardAssignments);
		}),

	/** Light per-card human toggles. */
	setCardFlags: protectedProcedure
		.meta({
			mcp: {
				kind: "write",
				description:
					"Change a card's wallet or status flag. Input: `id` (whole number, the card's id), optional `inWallet` (true if the owner physically holds the card), optional `status` (text; \"active\" makes the card active and any other value makes it inactive, excluding it from best-card picks). Omitted fields are unchanged. Returns the updated card, or null if no card has that id.",
			},
		})
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
				await context.appDb
					.update(cards)
					.set(set)
					.where(eq(cards.id, input.id));
			}
			const [row] = await context.appDb
				.select()
				.from(cards)
				.where(eq(cards.id, input.id));
			return row ?? null;
		}),
};
