/** Suggestions for free-text fields: what the owner has written before, ranked and filtered. */

export interface Suggestion {
	value: string;
	/** a muted note beside it, e.g. "19 holdings" */
	hint?: string;
}

/** Up to `limit` suggestions for `text`: the ones it starts, then the ones it appears in. All on empty. */
export function matchSuggestions(
	suggestions: Suggestion[],
	text: string,
	limit = 8,
): Suggestion[] {
	const q = text.trim().toLowerCase();
	if (!q) return suggestions.slice(0, limit);
	const starts: Suggestion[] = [];
	const contains: Suggestion[] = [];
	for (const s of suggestions) {
		const v = s.value.toLowerCase();
		if (v === q) continue; // already typed in full — nothing left to complete
		if (v.startsWith(q)) starts.push(s);
		else if (v.includes(q)) contains.push(s);
	}
	return [...starts, ...contains].slice(0, limit);
}

/**
 * Distinct non-blank values, most used first (ties alphabetical), with "N uses" as the hint when there
 * are repeats. `noun` names what's counted ("holding" → "19 holdings").
 */
export function suggestionsFrom(
	values: (string | null | undefined)[],
	noun?: string,
): Suggestion[] {
	const counts = new Map<string, { value: string; n: number }>();
	for (const raw of values) {
		const v = raw?.trim();
		if (!v) continue;
		const key = v.toLowerCase();
		const hit = counts.get(key);
		if (hit) hit.n++;
		else counts.set(key, { value: v, n: 1 });
	}
	return [...counts.values()]
		.sort((a, b) => b.n - a.n || a.value.localeCompare(b.value))
		.map(({ value, n }) => ({
			value,
			hint: noun ? `${n} ${noun}${n === 1 ? "" : "s"}` : undefined,
		}));
}
