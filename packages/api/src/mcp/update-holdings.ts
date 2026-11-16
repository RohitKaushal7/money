import { createHash, randomUUID } from "node:crypto";
import { investments } from "@money/db";
import { isISODate } from "@money/shared";
import { createRouterClient, ORPCError, type RouterClient } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { z } from "zod";

import { withEntityLock } from "../change-log";
import { appDbFor } from "../db";
import { appRouter } from "../routers/index";
import {
	contextFor,
	type JSONSchema,
	type McpCallContext,
	registerExtraTool,
} from "./tools";

export const UPDATE_HOLDINGS = "update_holdings";

export type InvestmentRow = typeof investments.$inferSelect;

const setSchema = z
	.object({
		annualRate: z
			.number()
			.describe(
				"Expected annual return as a pre-tax fraction (0.1175 = 11.75%).",
			)
			.optional(),
		currentValue: z
			.number()
			.nonnegative()
			.describe(
				"What the holding is worth today, in its own currency — not the amount invested.",
			)
			.optional(),
		expectedMonthlyInterest: z
			.number()
			.nonnegative()
			.nullable()
			.describe(
				"Interest expected per month, overriding the rate-based figure; null clears it. When it is null the app falls back: coverage and wealth use annualRate × (currentValue, or principal if there is no currentValue) ÷ 12; the Reconcile view's expected interest uses principal × annualRate ÷ 12.",
			)
			.optional(),
		maturityDate: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
			.refine(isISODate, "use a real date as YYYY-MM-DD")
			.optional(),
		active: z.boolean().optional(),
	})
	.strict();

const inputSchema = z.object({
	changes: z
		.array(
			z.object({
				id: z
					.number()
					.int()
					.positive()
					.describe("The holding's id. Use it when a name is shared.")
					.optional(),
				match: z
					.object({
						name: z.string().min(1),
						platform: z.string().min(1).optional(),
					})
					.describe(
						"Find the active holding by name (case-insensitive, exact), narrowed by platform when given.",
					)
					.optional(),
				set: setSchema.describe(
					"The new values. Leave empty for a holding that is unchanged but counts towards the total.",
				),
			}),
		)
		.min(1),
	expectedTotalValue: z
		.number()
		.describe(
			"The total today's value of every holding sent should come to (e.g. a portfolio screenshot's total).",
		)
		.optional(),
	apply: z.boolean().optional(),
	previewId: z.string().optional(),
});

export type UpdateHoldingsInput = z.input<typeof inputSchema>;
type HoldingSet = z.infer<typeof setSchema>;
type Field = keyof HoldingSet;

export interface HoldingPlan {
	rows: Array<{
		id: number;
		name: string;
		before: Partial<InvestmentRow>;
		after: Partial<InvestmentRow>;
	}>;
	unmatched: string[];
	ambiguous: Array<{ match: string; ids: number[] }>;
	total?: {
		expected: number;
		actual: number;
		tolerance: number;
		ok: boolean;
		currency: string;
	};
	errors: string[];
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

const describeMatch = (m: { name: string; platform?: string }) =>
	m.platform ? `${m.name} on ${m.platform}` : m.name;

/**
 * Work out what a bulk holdings change would do, without doing it. Pure: `current` is every holding the
 * owner has. Each change finds its holding by `id`, else by exact name (and platform) among active
 * holdings; a name shared by two holdings is ambiguous until an id is given.
 */
export function planHoldingUpdates(
	current: InvestmentRow[],
	input: UpdateHoldingsInput,
): HoldingPlan {
	const plan: HoldingPlan = {
		rows: [],
		unmatched: [],
		ambiguous: [],
		errors: [],
	};
	const matched: InvestmentRow[] = [];
	const targetedBy = new Map<number, number>();

	input.changes.forEach((change, i) => {
		let hit: InvestmentRow | undefined;
		if (change.id !== undefined) {
			hit = current.find((r) => r.id === change.id);
			if (!hit) {
				plan.unmatched.push(`id ${change.id}`);
				return;
			}
		} else if (change.match) {
			const { name, platform } = change.match;
			const hits = current.filter(
				(r) =>
					r.active &&
					norm(r.name) === norm(name) &&
					(platform === undefined || norm(r.platform) === norm(platform)),
			);
			if (hits.length === 0) {
				plan.unmatched.push(describeMatch(change.match));
				return;
			}
			if (hits.length > 1) {
				plan.ambiguous.push({
					match: describeMatch(change.match),
					ids: hits.map((r) => r.id),
				});
				return;
			}
			hit = hits[0];
		} else {
			plan.errors.push(`changes[${i}] has neither an id nor a match.`);
			return;
		}
		if (!hit) return;

		const earlier = targetedBy.get(hit.id);
		if (earlier !== undefined) {
			plan.errors.push(
				`"${hit.name}" (id ${hit.id}) is targeted twice, by changes[${earlier}] and changes[${i}].`,
			);
			return;
		}
		targetedBy.set(hit.id, i);

		const set = change.set ?? {};
		if (set.annualRate !== undefined && Math.abs(set.annualRate) >= 1) {
			plan.errors.push(
				`"${hit.name}": annualRate ${set.annualRate} looks like a percent; send a fraction (${set.annualRate}% = ${set.annualRate / 100}).`,
			);
		}
		const before: Partial<InvestmentRow> = {};
		const after: Partial<InvestmentRow> = {};
		for (const field of Object.keys(set) as Field[]) {
			const value = set[field];
			if (value === undefined) continue;
			Object.assign(before, { [field]: hit[field] });
			Object.assign(after, { [field]: value });
		}
		plan.rows.push({ id: hit.id, name: hit.name, before, after });
		matched.push(hit);
	});

	if (input.expectedTotalValue !== undefined && matched.length > 0) {
		const currencies = [...new Set(matched.map((r) => r.currency))];
		if (currencies.length > 1) {
			plan.errors.push(
				`The holdings are in more than one currency (${currencies.join(", ")}), so they can't be checked against one expectedTotalValue. Send one currency's holdings per call.`,
			);
		} else {
			// Today's value of each matched holding after the changes; a holding without one can't be summed.
			const values = matched.map(
				(r, i) => plan.rows[i]?.after.currentValue ?? r.currentValue,
			);
			const unvalued = matched.filter((_, i) => values[i] == null);
			for (const r of unvalued) {
				plan.errors.push(
					`"${r.name}" (id ${r.id}) has no currentValue, so it can't count towards expectedTotalValue. Set its currentValue in this change.`,
				);
			}
			if (unvalued.length === 0) {
				const actual = round2(
					values.reduce<number>((sum, v) => sum + (v ?? 0), 0),
				);
				const tolerance = input.changes.length;
				plan.total = {
					expected: input.expectedTotalValue,
					actual,
					tolerance,
					ok: Math.abs(actual - input.expectedTotalValue) <= tolerance,
					currency: currencies[0] ?? "INR",
				};
			}
		}
	}
	return plan;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const changed = (row: HoldingPlan["rows"][number]) =>
	(Object.keys(row.after) as Field[]).some(
		(f) => row.after[f] !== row.before[f],
	);

const isClean = (plan: HoldingPlan) =>
	plan.errors.length === 0 &&
	plan.unmatched.length === 0 &&
	plan.ambiguous.length === 0 &&
	(plan.total === undefined || plan.total.ok);

function money(n: number, currency: string): string {
	const s = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
		maximumFractionDigits: 2,
	}).format(n);
	return currency === "INR" ? `₹${s}` : `${currency} ${s}`;
}

function summarise(plan: HoldingPlan): string {
	const n = plan.rows.length;
	const parts = [
		`${n} holding${n === 1 ? "" : "s"}`,
		`${plan.rows.filter(changed).length} changed`,
	];
	const t = plan.total;
	if (t) {
		parts.push(
			t.ok
				? `total ${money(t.actual, t.currency)} matches`
				: `total ${money(t.actual, t.currency)} does NOT match the expected ${money(t.expected, t.currency)} (off by ${money(round2(t.actual - t.expected), t.currency)}, tolerance ±${t.tolerance})`,
		);
	}
	if (plan.unmatched.length) parts.push(`${plan.unmatched.length} unmatched`);
	if (plan.ambiguous.length) parts.push(`${plan.ambiguous.length} ambiguous`);
	if (plan.errors.length) parts.push(`${plan.errors.length} errors`);
	return parts.join(", ");
}

// ── preview store ──────────────────────────────────────────────────────────────────────────────────
const PREVIEW_TTL_MS = 15 * 60 * 1000;

interface Preview {
	uid: string;
	hash: string;
	expiresAt: number;
	/** Each matched holding's name and `updated_at` (ms) when previewed. */
	stamps: Map<number, { name: string; at: number }>;
}
/** Kept in memory only: a server restart drops every preview. Insertion order is age order. */
const previews = new Map<string, Preview>();
/** Live previews one user may hold; a newer one evicts their oldest, so a loop can't grow the map. */
const MAX_PREVIEWS_PER_USER = 20;

function sweep(now: number) {
	for (const [id, p] of previews) if (p.expiresAt <= now) previews.delete(id);
}

function storePreview(id: string, preview: Preview) {
	const mine = [...previews].filter(([, p]) => p.uid === preview.uid);
	const excess = mine.length - (MAX_PREVIEWS_PER_USER - 1);
	for (const [oldId] of mine.slice(0, Math.max(0, excess))) {
		previews.delete(oldId);
	}
	previews.set(id, preview);
}

/**
 * The caller's live preview with this id, used up. Another user's preview is not theirs to see or spend:
 * it is left in place and reads as absent.
 */
function takePreview(id: string | undefined, uid: string): Preview | undefined {
	if (!id) return undefined;
	const preview = previews.get(id);
	if (!preview || preview.uid !== uid) return undefined;
	previews.delete(id);
	return preview;
}

/** JSON with object keys sorted, so the same payload always hashes the same. */
function stableJson(value: unknown): string {
	return JSON.stringify(value, (_key, v) =>
		v && typeof v === "object" && !Array.isArray(v)
			? Object.fromEntries(
					Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
				)
			: v,
	);
}

const payloadHash = (input: z.infer<typeof inputSchema>) =>
	createHash("sha256")
		.update(
			stableJson({
				changes: input.changes,
				expectedTotalValue: input.expectedTotalValue,
			}),
		)
		.digest("hex");

const refuse = (message: string, data?: unknown) =>
	new ORPCError("CONFLICT", { message, data });

/** One holding write. A seam for tests, which need a write to fail partway through a batch. */
export type HoldingWriter = (
	client: RouterClient<typeof appRouter>,
	input: { id: number } & HoldingSet,
) => Promise<unknown>;

const writeHolding: HoldingWriter = (client, input) =>
	client.plan.updateInvestment(input);

/** What Claude is told about a write that failed: an oRPC error's message, never an internal one. */
function failureMessage(e: unknown): string {
	if (e instanceof ORPCError) return `${e.code}: ${e.message}`;
	console.error("[mcp] update_holdings write failed:", e);
	return "Internal server error";
}

export async function updateHoldings(
	ctx: McpCallContext,
	args: unknown,
	write: HoldingWriter = writeHolding,
) {
	const parsed = inputSchema.safeParse(args ?? {});
	if (!parsed.success) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Input validation failed",
			data: { issues: parsed.error.issues },
		});
	}
	const input = parsed.data;
	const now = Date.now();
	sweep(now);
	const hash = payloadHash(input);

	if (!input.apply) {
		const current = await appDbFor(ctx.uid).select().from(investments);
		const plan = planHoldingUpdates(current, input);
		const summary = summarise(plan);
		if (!isClean(plan)) {
			return {
				previewId: null,
				summary: `${summary}. Nothing can be applied until this is fixed — correct the changes and preview again.`,
				...plan,
			};
		}
		const rowById = new Map(current.map((r) => [r.id, r]));
		const previewId = randomUUID();
		storePreview(previewId, {
			uid: ctx.uid,
			hash,
			expiresAt: now + PREVIEW_TTL_MS,
			stamps: new Map(
				plan.rows.map((r) => [
					r.id,
					{ name: r.name, at: rowById.get(r.id)?.updatedAt.getTime() ?? 0 },
				]),
			),
		});
		return {
			previewId,
			expiresAt: new Date(now + PREVIEW_TTL_MS).toISOString(),
			summary,
			...plan,
		};
	}

	// Apply: only what was previewed, exactly as previewed, and only if nothing moved since.
	const preview = takePreview(input.previewId, ctx.uid);
	if (!preview) {
		throw refuse(
			"No live preview for this previewId. Call update_holdings without `apply` first, check its result, then apply with the previewId it returns (previews last 15 minutes, are single-use, and don't survive a server restart).",
		);
	}
	if (preview.hash !== hash) {
		throw refuse(
			"These changes differ from the previewed ones. Preview this exact payload, then apply it with the new previewId.",
		);
	}
	// The user's entity lock is held from reading the rows for the stale check through the last write, so no
	// other holding write (the app, another tool call, an undo) can land between the check and the writes.
	return withEntityLock(ctx.uid, () =>
		applyPreview(ctx, input, preview, write),
	);
}

async function applyPreview(
	ctx: McpCallContext,
	input: z.infer<typeof inputSchema>,
	preview: Preview,
	write: HoldingWriter,
) {
	const current = await appDbFor(ctx.uid).select().from(investments);
	const plan = planHoldingUpdates(current, input);
	const summary = summarise(plan);
	const rowById = new Map(current.map((r) => [r.id, r]));

	// Edits since the preview come first, so the refusal names them even when they also break the total.
	const moved = [...preview.stamps]
		.filter(([id, { at }]) => rowById.get(id)?.updatedAt.getTime() !== at)
		.map(([id, { name }]) =>
			rowById.has(id)
				? `"${name}" (id ${id})`
				: `"${name}" (id ${id}, deleted)`,
		);
	if (moved.length > 0) {
		throw refuse(
			`Changed in the app since the preview: ${moved.join(", ")}. Nothing was written; preview again.`,
		);
	}
	if (!isClean(plan)) {
		throw refuse(
			`The holdings no longer match the preview: ${summary}. Nothing was written; preview again.`,
			plan,
		);
	}
	if (
		plan.rows.length !== preview.stamps.size ||
		plan.rows.some((r) => !preview.stamps.has(r.id))
	) {
		throw refuse(
			"The changes now match different holdings than the preview did. Nothing was written; preview again.",
		);
	}

	const batchId = randomUUID();
	// This call holds the entity lock already, so the writes must not take it again (see Context).
	const client = createRouterClient(appRouter, {
		context: { ...contextFor(ctx), batchId, entityLockHeld: true },
	});
	const toWrite = plan.rows.filter(changed);
	const written: Array<{ id: number; name: string }> = [];
	const missing: Array<{ id: number; name: string }> = [];
	for (const [i, r] of toWrite.entries()) {
		let result: unknown;
		try {
			result = await write(client, { id: r.id, ...(r.after as HoldingSet) });
		} catch (e) {
			const error = failureMessage(e);
			const notAttempted = toWrite
				.slice(i + 1)
				.map(({ id, name }) => ({ id, name }));
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: `Applied partway: ${written.length} of ${toWrite.length} holdings were written before "${r.name}" (id ${r.id}) failed (${error}). The written ones stay written; undo each change in batch ${batchId} with changes_undo (changes_list shows each change's batchId and id), or preview the rest again.`,
				data: {
					batchId,
					written,
					failedAt: { id: r.id, name: r.name },
					error,
					notAttempted,
					missing,
				},
			});
		}
		if (result == null) missing.push({ id: r.id, name: r.name });
		else written.push({ id: r.id, name: r.name });
	}
	const gone = missing.length
		? ` ${missing.length} not written because the holding no longer exists: ${missing.map((m) => `"${m.name}" (id ${m.id})`).join(", ")}.`
		: "";
	return {
		applied: true,
		batchId,
		updated: written.length,
		written,
		missing,
		summary: `${summary}; ${written.length} written.${gone} To undo, undo each change in batch ${batchId} with changes_undo (changes_list shows each change's batchId and id).`,
		rows: plan.rows,
		total: plan.total,
	};
}

const DESCRIPTION = [
	"Change several holdings (investments) at once, safely — e.g. to correct them from a portfolio screenshot. Two calls:",
	"1) Preview: send `changes` (and ideally `expectedTotalValue`) without `apply`. Nothing is written. The result shows each matched holding's `before`/`after`, any `unmatched` or `ambiguous` entries, `errors`, the `total` check, a one-line `summary`, and a `previewId` (null when something must be fixed first).",
	"2) Apply: send the identical `changes` and `expectedTotalValue` again with `apply: true` and that `previewId`. It is refused if the payload differs, the preview expired (15 minutes) or was already used, or any of the holdings was edited since the preview (it names which). A refused apply writes nothing and uses up the preview: preview again, then apply with the new previewId. Previews are kept in the server's memory only, so a server restart drops them all; each owner keeps at most their 20 newest previews, a newer one dropping the oldest. All writes share one change-log batch, returned as `batchId` with the `written` holdings (and `missing`: any holding that no longer existed when its turn to be written came, so was not written). There is no batch undo: to undo an apply, call changes_list, take the `id` of every change whose `batchId` matches, and undo each with changes_undo. If a write fails partway, the error says which holdings were already written (they stay written; undo them the same way) and which failed or were not attempted.",
	"Each change finds its holding by `id`, or by `match.name` (case-insensitive, exact, active holdings only) narrowed by `match.platform`; a name two holdings share is ambiguous — use the `id` from plan_investments. `set` may hold `annualRate` (pre-tax fraction: 0.1175 = 11.75%; a value of 1 or more, or -1 or less, is refused as a percent), `currentValue` (worth today in the holding's own currency, not the amount invested), `expectedMonthlyInterest` (interest per month, overriding the rate-based figure; null clears it. When it is null the app falls back: coverage and wealth use annualRate × (currentValue, or principal if there is no currentValue) ÷ 12; the Reconcile view's expected interest uses principal × annualRate ÷ 12.), `maturityDate` (YYYY-MM-DD) and `active`.",
	"When using `expectedTotalValue`, send EVERY holding the screenshot shows, unchanged ones included (with an empty `set`): the total is the sum of today's value across the holdings sent, after the changes, and must be within ±1 per holding sent. All those holdings must share one currency, and each must have a `currentValue` after the change — one without is an error naming it, so set it in that holding's change.",
].join(" ");

const [, json] = new ZodToJsonSchemaConverter().convert(inputSchema, {
	strategy: "input",
});

registerExtraTool({
	name: UPDATE_HOLDINGS,
	description: DESCRIPTION,
	inputSchema: json as JSONSchema,
	kind: "write",
	run: (ctx, args) => updateHoldings(ctx, args),
});
