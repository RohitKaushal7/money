import { type AppDb, categories } from "@money/db";
import { CATEGORY_BY_KEY } from "@money/shared";
import { ORPCError } from "@orpc/server";
import { inArray } from "drizzle-orm";

/**
 * Each category key's kind, from the owner's own categories (`app.db` — the built-ins are seeded there too,
 * so custom categories resolve to the kind the owner gave them), else from the built-in taxonomy for a
 * built-in key their table lacks. A key in neither is refused with BAD_REQUEST naming it, never given a
 * guessed kind: a wrong kind would misfile the money as income, expense or transfer at the next re-tag.
 * Returns a lookup that answers for exactly the keys asked about.
 */
export async function categoryKinds(
	appDb: AppDb,
	keys: string[],
): Promise<(key: string) => string> {
	const wanted = [...new Set(keys)];
	const rows = await appDb
		.select({ key: categories.key, kind: categories.kind })
		.from(categories)
		.where(inArray(categories.key, wanted));
	const kinds = new Map(rows.map((r) => [r.key, r.kind]));
	const unknown: string[] = [];
	for (const key of wanted) {
		if (kinds.has(key)) continue;
		const builtIn = CATEGORY_BY_KEY.get(key)?.kind;
		if (builtIn) kinds.set(key, builtIn);
		else unknown.push(key);
	}
	if (unknown.length > 0) {
		const names = unknown.map((k) => `"${k}"`).join(", ");
		throw new ORPCError("BAD_REQUEST", {
			message: `Unknown category key${unknown.length === 1 ? "" : "s"} ${names}. Use a key from the owner's category list; nothing was changed.`,
		});
	}
	return (key) => {
		const kind = kinds.get(key);
		if (kind === undefined)
			throw new Error(`category key "${key}" was not looked up`);
		return kind;
	};
}
