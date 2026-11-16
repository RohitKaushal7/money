/**
 * Where holdings are held, for a row's subtitle. A platform that only repeats the row's own name ("SustVest"
 * under the SustVest group, "PPF" on the PPF holding) says nothing, so it is left out.
 */

/** The distinct platforms of some holdings, in first-seen order, blanks dropped. */
export function platformsOf(members: { platform?: string }[]): string[] {
	const seen = new Map<string, string>();
	for (const m of members) {
		const p = m.platform?.trim();
		if (p && !seen.has(p.toLowerCase())) seen.set(p.toLowerCase(), p);
	}
	return [...seen.values()];
}

/** `Wint Wealth`, `Wint Wealth, Stable Money`, `SBI, Slice +2` — or null when it would only echo `name`. */
export function platformLabel(
	platforms: string[],
	name?: string,
): string | null {
	if (platforms.length === 0) return null;
	if (
		platforms.length === 1 &&
		name != null &&
		platforms[0]?.toLowerCase() === name.trim().toLowerCase()
	)
		return null;
	const shown = platforms.slice(0, 2).join(", ");
	return platforms.length > 2 ? `${shown} +${platforms.length - 2}` : shown;
}
