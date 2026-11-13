import { createHash, randomUUID } from "node:crypto";
import { investments } from "@money/db";
import { createRouterClient, ORPCError } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { z } from "zod";

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
			.describe(
				"What the holding is worth today, in its own currency — not the amount invested.",
			)
			.optional(),
		expectedMonthlyInterest: z
			.number()
			.nullable()
			.describe(
				"Interest expected per month; overrides currentValue × annualRate ÷ 12. null clears it.",
			)
			.optional(),
		maturityDate: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
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
			const actual = round2(
				matched.reduce((sum, r, i) => {
					const after = plan.rows[i]?.after.currentValue;
					return sum + (after ?? r.currentValue ?? 0);
				}, 0),
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
	/** Each matched holding's `updated_at` (ms) when previewed. */
	stamps: Map<number, number>;
}
const previews = new Map<string, Preview>();

function sweep(now: number) {
	for (const [id, p] of previews) if (p.expiresAt <= now) previews.delete(id);
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

async function run(ctx: McpCallContext, args: unknown) {
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

	const current = await appDbFor(ctx.uid).select().from(investments);
	const plan = planHoldingUpdates(current, input);
	const summary = summarise(plan);
	const hash = payloadHash(input);
	const rowById = new Map(current.map((r) => [r.id, r]));

	if (!input.apply) {
		if (!isClean(plan)) {
			return {
				previewId: null,
				summary: `${summary}. Nothing can be applied until this is fixed — correct the changes and preview again.`,
				...plan,
			};
		}
		const previewId = randomUUID();
		previews.set(previewId, {
			uid: ctx.uid,
			hash,
			expiresAt: now + PREVIEW_TTL_MS,
			stamps: new Map(
				plan.rows.map((r) => [
					r.id,
					rowById.get(r.id)?.updatedAt.getTime() ?? 0,
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
	const preview = input.previewId ? previews.get(input.previewId) : undefined;
	if (input.previewId) previews.delete(input.previewId);
	if (!preview || preview.uid !== ctx.uid) {
		throw refuse(
			"No live preview for this previewId. Call update_holdings without `apply` first, check its result, then apply with the previewId it returns (previews last 15 minutes and are single-use).",
		);
	}
	if (preview.hash !== hash) {
		throw refuse(
			"These changes differ from the previewed ones. Preview this exact payload, then apply it with the new previewId.",
		);
	}
	if (!isClean(plan)) {
		throw refuse(
			`The holdings no longer match the preview: ${summary}. Preview again.`,
			plan,
		);
	}
	const moved = plan.rows.filter(
		(r) =>
			!preview.stamps.has(r.id) ||
			rowById.get(r.id)?.updatedAt.getTime() !== preview.stamps.get(r.id),
	);
	if (moved.length > 0 || plan.rows.length !== preview.stamps.size) {
		const names = moved.map((r) => `"${r.name}" (id ${r.id})`).join(", ");
		throw refuse(
			`Changed since the preview: ${names || "the set of matched holdings"}. Nothing was applied; preview again.`,
		);
	}

	const batchId = randomUUID();
	const client = createRouterClient(appRouter, {
		context: { ...contextFor(ctx), batchId },
	});
	const toWrite = plan.rows.filter(changed);
	for (const r of toWrite) {
		await client.plan.updateInvestment({
			id: r.id,
			...(r.after as HoldingSet),
		});
	}
	return {
		applied: true,
		batchId,
		updated: toWrite.length,
		summary: `${summary}; ${toWrite.length} updated. Undo with the change log batch ${batchId}.`,
		rows: plan.rows,
		total: plan.total,
	};
}

const DESCRIPTION = [
	"Change several holdings (investments) at once, safely — e.g. to correct them from a portfolio screenshot. Two calls:",
	"1) Preview: send `changes` (and ideally `expectedTotalValue`) without `apply`. Nothing is written. The result shows each matched holding's `before`/`after`, any `unmatched` or `ambiguous` entries, `errors`, the `total` check, a one-line `summary`, and a `previewId` (null when something must be fixed first).",
	"2) Apply: send the identical `changes` and `expectedTotalValue` again with `apply: true` and that `previewId`. It is refused if the payload differs, the preview expired (15 minutes) or was already used, or any of the holdings was edited since the preview (it names which). A refused apply writes nothing and uses up the preview: preview again, then apply with the new previewId. All writes share one change-log batch, returned as `batchId`.",
	"Each change finds its holding by `id`, or by `match.name` (case-insensitive, exact, active holdings only) narrowed by `match.platform`; a name two holdings share is ambiguous — use the `id` from plan_investments. `set` may hold `annualRate` (pre-tax fraction: 0.1175 = 11.75%; a value of 1 or more is refused as a percent), `currentValue` (worth today in the holding's own currency, not the amount invested), `expectedMonthlyInterest` (overrides currentValue × annualRate ÷ 12; null clears it so the return falls back to that), `maturityDate` (YYYY-MM-DD) and `active`.",
	"When using `expectedTotalValue`, send EVERY holding the screenshot shows, unchanged ones included (with an empty `set`): the total is the sum of today's value across the holdings sent, after the changes, and must be within ±1 per holding sent. All those holdings must share one currency.",
].join(" ");

const [, json] = new ZodToJsonSchemaConverter().convert(inputSchema, {
	strategy: "input",
});

registerExtraTool({
	name: UPDATE_HOLDINGS,
	description: DESCRIPTION,
	inputSchema: json as JSONSchema,
	kind: "write",
	run,
});
