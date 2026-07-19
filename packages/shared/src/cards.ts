/**
 * Credit-card reward picker (issue 005 / cards) — pure, no I/O. "Best card for category X": resolve each
 * card's most-specific matching rule, drop exclusions, and rank by effective rate with the owner's
 * priorities as tie-breakers, always carrying the condition/cap/gotcha so a conditional rate is never
 * presented as a flat one.
 */

export interface CardInfo {
	id: number;
	name: string;
	isLtf: boolean;
	network?: string | null;
	status?: string | null;
}

export interface RewardRule {
	cardId: number;
	/** a card-category key, or "base" for the default rate */
	category: string;
	isBase: boolean;
	/** cashback-equivalent fraction (0.05 = 5%); null when unknown */
	rate: number | null;
	rateText?: string | null;
	cap?: number | null;
	capText?: string | null;
	condition?: string | null;
	/** cashback | points | voucher */
	rewardType?: string | null;
	isExclusion: boolean;
}

export interface CardReward {
	cardId: number;
	cardName: string;
	isLtf: boolean;
	/** effective rate used for ranking (0 when excluded or unknown) */
	rate: number;
	rewardType: string | null;
	excluded: boolean;
	rule: RewardRule | null;
	/** condition + cap + card gotchas, deduped and non-empty */
	caveats: string[];
}

/** cashback ranks ahead of points/voucher (the owner's cashback-first priority). */
function rewardTypeRank(t: string | null | undefined): number {
	return t === "cashback" ? 0 : 1;
}

/** The most-specific rule for `category`: an exact-category rule (exclusion or not) beats the base rule. */
function resolveRule(
	cardId: number,
	category: string,
	rules: RewardRule[],
): RewardRule | null {
	const forCard = rules.filter((r) => r.cardId === cardId);
	const exact = forCard.find((r) => r.category === category);
	if (exact) return exact;
	return forCard.find((r) => r.isBase) ?? null;
}

export function bestCardForCategory(
	category: string,
	cards: CardInfo[],
	rules: RewardRule[],
	gotchas: Record<number, string[]> = {},
): CardReward[] {
	const rows: CardReward[] = cards.map((card) => {
		const rule = resolveRule(card.id, category, rules);
		const excluded = rule?.isExclusion ?? false;
		const rate = excluded ? 0 : (rule?.rate ?? 0);
		const caveats = [
			rule?.condition ?? "",
			rule?.capText ?? "",
			...(gotchas[card.id] ?? []),
		].filter((s) => s.length > 0);
		return {
			cardId: card.id,
			cardName: card.name,
			isLtf: card.isLtf,
			rate,
			rewardType: rule?.rewardType ?? null,
			excluded,
			rule,
			caveats: [...new Set(caveats)],
		};
	});

	return rows.sort((a, b) => {
		if (a.excluded !== b.excluded) return a.excluded ? 1 : -1; // excluded last
		if (b.rate !== a.rate) return b.rate - a.rate; // rate desc
		const rt = rewardTypeRank(a.rewardType) - rewardTypeRank(b.rewardType);
		if (rt !== 0) return rt; // cashback before points
		if (a.isLtf !== b.isLtf) return a.isLtf ? -1 : 1; // LTF before non-LTF
		return a.cardName.localeCompare(b.cardName);
	});
}
