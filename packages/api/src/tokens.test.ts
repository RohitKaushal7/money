import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SKIP_ENV_VALIDATION = "1";
const dir = mkdtempSync(join(tmpdir(), "money-tokens-"));
process.env.DATA_DIR = dir;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";

const { createControlDb, user, apiTokens } = await import("@money/db");
const { runControlMigrations } = await import("@money/db/migrate");
const { eq } = await import("drizzle-orm");
const { createToken, verifyToken, revokeToken, listTokens } = await import(
	"./tokens"
);

const url = `file:${dir}/control.db`;
let db: ReturnType<typeof createControlDb>;

beforeAll(async () => {
	await runControlMigrations(url);
	db = createControlDb(url);
	for (const id of ["u1", "u2", "banned"]) {
		await db.insert(user).values({
			id,
			name: id,
			email: `${id}@x.test`,
			banned: id === "banned",
		});
	}
});

const lastUsed = async (id: number) =>
	(await db.select().from(apiTokens).where(eq(apiTokens.id, id)))[0]
		?.lastUsedAt ?? null;

describe("personal access tokens", () => {
	test("creates a well-formed token and stores only its hash", async () => {
		const { token, row } = await createToken(db, "u1", {
			name: "laptop",
			scope: "read",
		});
		expect(token).toMatch(/^money_pat_[A-Za-z0-9_-]{43}$/);
		expect(row.prefix).toBe(token.slice(0, 14));
		expect(row.tokenHash).toBe(
			new Bun.CryptoHasher("sha256").update(token).digest("hex"),
		);
		expect(row.tokenHash).not.toContain(token);
		expect(await listTokens(db, "u1")).toHaveLength(1);
	});

	test("verifies, returns scope, stamps last_used_at", async () => {
		const { token, row } = await createToken(db, "u1", {
			name: "rw",
			scope: "read_write",
		});
		expect(await lastUsed(row.id)).toBeNull();
		const now = new Date(Date.now() + 1000);
		const r = await verifyToken(db, token, now);
		expect(r?.user.id).toBe("u1");
		expect(r?.via).toEqual({
			kind: "token",
			tokenId: row.id,
			name: "rw",
			scope: "read_write",
		});
		expect(await lastUsed(row.id)).toEqual(now);
	});

	test("rejects a wrong token", async () => {
		expect(await verifyToken(db, `money_pat_${"A".repeat(43)}`)).toBeNull();
		expect(await verifyToken(db, "garbage")).toBeNull();
	});

	test("rejects revoked tokens and leaves last_used_at alone", async () => {
		const { token, row } = await createToken(db, "u1", {
			name: "r",
			scope: "read",
		});
		const t1 = new Date(Date.now() + 1000);
		expect(await verifyToken(db, token, t1)).not.toBeNull();
		expect(await lastUsed(row.id)).toEqual(t1);
		expect(await revokeToken(db, "u1", row.id)).toBe(true);
		expect(
			await verifyToken(db, token, new Date(t1.getTime() + 1000)),
		).toBeNull();
		expect(await lastUsed(row.id)).toEqual(t1);
	});

	test("rejects expired tokens and leaves last_used_at alone", async () => {
		const t1 = new Date(Date.now() + 1000);
		const { token, row } = await createToken(db, "u1", {
			name: "e",
			scope: "read",
			expiresAt: new Date(t1.getTime() + 1000),
		});
		expect(await verifyToken(db, token, t1)).not.toBeNull();
		expect(await lastUsed(row.id)).toEqual(t1);
		expect(
			await verifyToken(db, token, new Date(t1.getTime() + 5000)),
		).toBeNull();
		expect(await lastUsed(row.id)).toEqual(t1);
	});

	test("rejects banned users and leaves last_used_at alone", async () => {
		await db.insert(user).values({ id: "later", name: "l", email: "l@x.test" });
		const { token, row } = await createToken(db, "later", {
			name: "b",
			scope: "read",
		});
		const t1 = new Date(Date.now() + 1000);
		expect(await verifyToken(db, token, t1)).not.toBeNull();
		await db.update(user).set({ banned: true }).where(eq(user.id, "later"));
		expect(
			await verifyToken(db, token, new Date(t1.getTime() + 1000)),
		).toBeNull();
		expect(await lastUsed(row.id)).toEqual(t1);
	});

	test("rejects tokens of a deleted user (FK cascade removes the token row)", async () => {
		await db.insert(user).values({ id: "gone", name: "g", email: "g@x.test" });
		const { token } = await createToken(db, "gone", {
			name: "g",
			scope: "read",
		});
		expect(await verifyToken(db, token)).not.toBeNull();
		await db.delete(user).where(eq(user.id, "gone"));
		expect(await verifyToken(db, token)).toBeNull();
	});

	test("a ban that has expired no longer blocks", async () => {
		await db.insert(user).values({
			id: "temp",
			name: "temp",
			email: "temp@x.test",
			banned: true,
			banExpires: new Date(Date.now() - 1000),
		});
		const { token } = await createToken(db, "temp", {
			name: "t",
			scope: "read",
		});
		expect((await verifyToken(db, token))?.user.id).toBe("temp");
	});

	test("another user cannot revoke your token", async () => {
		const { token, row } = await createToken(db, "u1", {
			name: "mine",
			scope: "read",
		});
		expect(await revokeToken(db, "u2", row.id)).toBe(false);
		expect(await verifyToken(db, token)).not.toBeNull();
	});
});
