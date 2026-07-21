import { CATEGORIES } from "./categories";

/**
 * Which colour a category wears, everywhere it appears.
 *
 * The rule that matters: **colour follows the category, never its rank.** Assigning by stack position —
 * biggest total gets slot 1 — repaints every survivor the moment a filter or a recategorisation reorders
 * the list, which makes the colour useless for recognising a category at a glance.
 *
 * Slots, not colours. A slot is an index into the validated `--cat-*` palette, so it resolves per theme
 * and can't be set to something that fails the colour-blindness checks. There are exactly five: the
 * palette is validated ALL-PAIRS (any two pinned categories can end up touching in a stack), and no sixth
 * hue survives that constraint. See the `--cat-*` block in `apps/web/src/index.css`.
 */
export const COLOR_SLOTS = [1, 2, 3, 4, 5] as const;
export type ColorSlot = (typeof COLOR_SLOTS)[number];

export const isColorSlot = (v: unknown): v is ColorSlot =>
	typeof v === "number" && COLOR_SLOTS.includes(v as ColorSlot);

/** CSS custom property for a slot. Themed, so light/dark each get their own validated step. */
export const slotVar = (slot: ColorSlot): string => `var(--cat-${slot})`;

/** Anything past the palette, and anything deliberately unpinned, is deliberately recessive. */
export const OTHER_COLOR = "var(--muted-foreground)";

/**
 * Default pins for the categories that actually dominate spend.
 *
 * Chosen from the data rather than by taste: over 24 months these are the only expense categories that
 * ever entered a month's top five. They seed the `categories.color_slot` column; a user re-pin overrides
 * this and is never overwritten.
 */
export const DEFAULT_COLOR_SLOTS: Record<string, ColorSlot> = {
	card_bill: 1,
	upi_merchant: 2,
	rent: 3,
	tax_paid: 4,
};

/** Position in the seed taxonomy — a category's fixed identity, independent of how big it is. */
const TAXONOMY_ORDER = new Map(CATEGORIES.map((c, i) => [c.key, i]));
const orderOf = (key: string) =>
	TAXONOMY_ORDER.get(key) ?? Number.MAX_SAFE_INTEGER;

/**
 * Resolve the colour for every category being shown at once.
 *
 * Pinned categories take their slot. Whatever is left claims the lowest slot still free, in taxonomy
 * order — deliberately not by size, so a category growing or shrinking never moves its colour. Anything
 * that finds no free slot falls back to {@link OTHER_COLOR}.
 *
 * Two *pinned* categories may share a slot; that is the user's call to make and only shows when both
 * appear together, so the picker surfaces who else holds a slot rather than forbidding it.
 *
 * @param keys category keys about to be drawn
 * @param pinned slot per key, from `categories.color_slot`
 * @returns key → CSS colour, for every key given
 */
export function resolveCategoryColors(
	keys: readonly string[],
	pinned: Readonly<Record<string, ColorSlot | null | undefined>> = {},
): Map<string, string> {
	const out = new Map<string, string>();
	const taken = new Set<ColorSlot>();

	const unpinned: string[] = [];
	for (const key of keys) {
		const slot = pinned[key] ?? DEFAULT_COLOR_SLOTS[key];
		if (isColorSlot(slot)) {
			out.set(key, slotVar(slot));
			taken.add(slot);
		} else {
			unpinned.push(key);
		}
	}

	// Taxonomy order, so which colour a leftover gets depends only on which categories are present —
	// never on how much was spent in them.
	unpinned.sort((a, b) => orderOf(a) - orderOf(b));
	for (const key of unpinned) {
		const free = COLOR_SLOTS.find((s) => !taken.has(s));
		if (free === undefined) {
			out.set(key, OTHER_COLOR);
			continue;
		}
		taken.add(free);
		out.set(key, slotVar(free));
	}

	return out;
}
