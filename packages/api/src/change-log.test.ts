import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "./context";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "money-changes-"));
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";

const { call, createRouterClient } = await import("@orpc/server");
const { provisionUserApp } = await import("@money/db/migrate");
const { changeLog, investments, recurringExpenses } = await import("@money/db");
const { eq } = await import("drizzle-orm");
const { appRouter } = await import("./routers/index");
const { appDbFor, controlDb } = await import("./db");
const { protectedProcedure } = await import("./index");
const { listChanges, undoChange } = await import("./change-log");

type Ctx = Context;

const tokenContext = {
	session: { user: { id: "u" } },
	controlDb: controlDb(),
	unlockToken: null,
	via: {
		kind: "token" as const,
		tokenId: 1,
		name: "test",
		scope: "read_write" as const,
	},
	batchId: undefined,
} as unknown as Ctx;

const appContext = {
	session: { user: { id: "u" } },
	controlDb: controlDb(),
	unlockToken: null,
	via: undefined,
	batchId: undefined,
} as unknown as Ctx;

const mcp = createRouterClient(appRouter, { context: tokenContext });
const app = createRouterClient(appRouter, { context: appContext });

const db = () => appDbFor("u");
const raw = (v: unknown) => (v ?? {}) as Record<string, unknown>;
const allChanges = () => db().select().from(changeLog);
const latest = async () => (await listChanges(db(), { limit: 1 }))[0];
const investmentRow = async (id: number) =>
	(await db().select().from(investments).where(eq(investments.id, id)))[0];

beforeAll(async () => {
	await provisionUserApp("u");
});

describe("change log", () => {
	test("an MCP update is logged with raw before/after rows, and undo restores it", async () => {
		const added = await app.plan.addInvestment({
			name: "Bond A",
			type: "bond",
			incomeClass: "income",
			annualRate: 0.1,
			currentValue: 1000,
		});
		const id = Number(added.id);
		const countBefore = (await allChanges()).length;

		await mcp.plan.updateInvestment({ id, annualRate: 0.12 });

		const rows = await allChanges();
		expect(rows).toHaveLength(countBefore + 1);
		const change = await latest();
		expect(change?.procedure).toBe("plan.updateInvestment");
		expect(change?.source).toBe("mcp");
		expect(change?.tokenName).toBe("test");
		expect(change?.entity).toBe("investments");
		expect(change?.entityId).toBe(id);
		expect(change?.batchId).toBeString();
		expect(raw(change?.before).annual_rate).toBe(0.1);
		expect(raw(change?.after).annual_rate).toBe(0.12);

		expect(await undoChange(db(), change?.id ?? 0)).toEqual({ ok: true });
		expect((await investmentRow(id))?.annualRate).toBe(0.1);
		const undone = (await listChanges(db(), { limit: 50 })).find(
			(c) => c.id === change?.id,
		);
		expect(undone?.undoneAt).toBeInstanceOf(Date);

		const again = await undoChange(db(), change?.id ?? 0);
		expect(again.ok).toBe(false);
	});

	test("app-side writes are logged with source app", async () => {
		await app.plan.addRecurring({ name: "Rent", amount: 100 });
		const change = await latest();
		expect(change?.source).toBe("app");
		expect(change?.tokenName).toBeNull();
		expect(change?.procedure).toBe("plan.addRecurring");
		expect(change?.entity).toBe("recurring_expenses");
		expect(change?.before).toBeNull();
		expect(raw(change?.after).name).toBe("Rent");
	});

	test("undo refuses when the row changed since the logged change", async () => {
		const added = await app.plan.addInvestment({
			name: "Bond B",
			type: "bond",
			incomeClass: "income",
			annualRate: 0.08,
		});
		const id = Number(added.id);
		await mcp.plan.updateInvestment({ id, annualRate: 0.09 });
		const first = await latest();
		await app.plan.updateInvestment({ id, annualRate: 0.095 });

		const r = await undoChange(db(), first?.id ?? 0);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toMatch(/changed since/);
		expect((await investmentRow(id))?.annualRate).toBe(0.095);
	});

	test("undo of an insert deletes it; undo of a delete re-inserts with the same id", async () => {
		const added = await mcp.plan.addInvestment({
			name: "FD C",
			type: "fd",
			incomeClass: "income",
			annualRate: 0.07,
			principal: 5000,
		});
		const id = Number(added.id);
		const insertChange = await latest();
		expect(insertChange?.entityId).toBe(id);
		expect(insertChange?.before).toBeNull();
		expect(await undoChange(db(), insertChange?.id ?? 0)).toEqual({
			ok: true,
		});
		expect(await investmentRow(id)).toBeUndefined();

		const again = await app.plan.addInvestment({
			name: "FD D",
			type: "fd",
			incomeClass: "income",
			annualRate: 0.065,
		});
		const id2 = Number(again.id);
		const original = await investmentRow(id2);
		await mcp.plan.deleteInvestment({ id: id2 });
		const deleteChange = await latest();
		expect(deleteChange?.entityId).toBe(id2);
		expect(deleteChange?.after).toBeNull();
		expect(await investmentRow(id2)).toBeUndefined();

		expect(await undoChange(db(), deleteChange?.id ?? 0)).toEqual({
			ok: true,
		});
		expect(await investmentRow(id2)).toEqual(original);
	});

	test("a stray id on an insert's input does not point the log at another row", async () => {
		const other = await app.plan.addRecurring({ name: "Other", amount: 9 });
		const added = await mcp.plan.addRecurring({
			id: Number(other.id),
			name: "New",
			amount: 10,
		} as never);
		const change = await latest();
		expect(change?.entityId).toBe(Number(added.id));
		expect(change?.before).toBeNull();
	});

	test("recurring expenses can be updated and undone", async () => {
		const added = await app.plan.addRecurring({ name: "Gym", amount: 50 });
		const id = Number(added.id);
		await mcp.plan.updateRecurring({ id, amount: 70 });
		const change = await latest();
		expect(await undoChange(db(), change?.id ?? 0)).toEqual({ ok: true });
		const [row] = await db()
			.select()
			.from(recurringExpenses)
			.where(eq(recurringExpenses.id, id));
		expect(row?.amount).toBe(50);
	});

	test("a read procedure logs nothing", async () => {
		const n = (await allChanges()).length;
		const read = protectedProcedure
			.meta({ mcp: { description: "a read", kind: "read" } })
			.handler(() => "ok");
		expect(await call(read, undefined, { context: tokenContext })).toBe("ok");
		await mcp.plan.investments();
		expect(await allChanges()).toHaveLength(n);
	});

	test("a write that throws logs nothing", async () => {
		const n = (await allChanges()).length;
		const failing = protectedProcedure
			.meta({ mcp: { description: "a failing write", kind: "write" } })
			.handler(() => {
				throw new Error("boom");
			});
		await expect(
			call(failing, undefined, { context: tokenContext }),
		).rejects.toThrow("boom");
		await expect(
			// Fails input validation inside the procedure.
			mcp.plan.addInvestment({ name: "" } as never),
		).rejects.toThrow();
		expect(await allChanges()).toHaveLength(n);
	});

	test("a context batchId is used as the batch", async () => {
		const added = await app.plan.addRecurring({ name: "Batch", amount: 1 });
		const batched = createRouterClient(appRouter, {
			context: { ...tokenContext, batchId: "batch-1" } as Ctx,
		});
		await batched.plan.updateRecurring({ id: Number(added.id), amount: 2 });
		expect((await latest())?.batchId).toBe("batch-1");
	});

	test("undo refuses rows without an entity", async () => {
		const unentity = protectedProcedure
			.meta({ mcp: { description: "a write w/o entity", kind: "write" } })
			.handler(() => "done");
		await call(unentity, { x: 1 }, { context: tokenContext });
		const change = await latest();
		expect(change?.entity).toBeNull();
		const r = await undoChange(db(), change?.id ?? 0);
		expect(r).toEqual({ ok: false, reason: "not undoable in this version" });
	});
});

describe("changes router", () => {
	test("list returns newest first and honours the limit", async () => {
		const list = await mcp.changes.list({ limit: 2 });
		expect(list).toHaveLength(2);
		expect((list[0]?.id ?? 0) > (list[1]?.id ?? 0)).toBe(true);
		expect((await mcp.changes.list()).length).toBeGreaterThan(2);
		await expect(mcp.changes.list({ limit: 201 })).rejects.toThrow();
	});

	test("undo goes through the router and is itself logged without an entity", async () => {
		const added = await app.plan.addInvestment({
			name: "Bond E",
			type: "bond",
			incomeClass: "income",
			annualRate: 0.1,
		});
		const id = Number(added.id);
		await mcp.plan.updateInvestment({ id, annualRate: 0.2 });
		const change = await latest();

		expect(await mcp.changes.undo({ id: change?.id ?? 0 })).toEqual({
			ok: true,
		});
		expect((await investmentRow(id))?.annualRate).toBe(0.1);
		const undoEntry = await latest();
		expect(undoEntry?.procedure).toBe("changes.undo");
		expect(undoEntry?.entity).toBeNull();
		expect(undoEntry?.input).toEqual({ id: change?.id });

		const r = await mcp.changes.undo({ id: change?.id ?? 0 });
		expect(r.ok).toBe(false);
	});
});
