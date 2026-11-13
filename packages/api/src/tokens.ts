import { createHash, randomBytes } from "node:crypto";
import { apiTokens, type ControlDb, user } from "@money/db";
import { and, desc, eq, isNull } from "drizzle-orm";

import type { TokenVia } from "./mcp/meta";

export type ApiTokenRow = typeof apiTokens.$inferSelect;
export type VerifiedUser = {
	id: string;
	email: string;
	name: string;
	role: string | null;
};

const TOKEN_PREFIX = "money_pat_";

const hashToken = (raw: string) =>
	createHash("sha256").update(raw).digest("hex");

/** Mint a token. The plaintext is returned once; only its SHA-256 is stored. */
export async function createToken(
	db: ControlDb,
	uid: string,
	input: { name: string; scope: "read" | "read_write"; expiresAt?: Date },
): Promise<{ token: string; row: ApiTokenRow }> {
	const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
	const [row] = await db
		.insert(apiTokens)
		.values({
			userId: uid,
			name: input.name,
			tokenHash: hashToken(token),
			prefix: token.slice(0, 14),
			scope: input.scope,
			expiresAt: input.expiresAt ?? null,
		})
		.returning();
	if (!row) throw new Error("token insert returned no row");
	return { token, row };
}

/** Resolve a presented token to its user, or null if unknown, revoked, expired, or the user is gone/banned. */
export async function verifyToken(
	db: ControlDb,
	raw: string,
	now: Date = new Date(),
): Promise<{ user: VerifiedUser; via: TokenVia } | null> {
	if (!raw.startsWith(TOKEN_PREFIX)) return null;
	const [hit] = await db
		.select({ token: apiTokens, user })
		.from(apiTokens)
		.innerJoin(user, eq(user.id, apiTokens.userId))
		.where(eq(apiTokens.tokenHash, hashToken(raw)))
		.limit(1);
	if (!hit) return null;
	const { token, user: u } = hit;
	if (token.revokedAt) return null;
	if (token.expiresAt && token.expiresAt.getTime() <= now.getTime()) {
		return null;
	}
	if (u.banned && (!u.banExpires || u.banExpires.getTime() > now.getTime())) {
		return null;
	}
	await db
		.update(apiTokens)
		.set({ lastUsedAt: now })
		.where(eq(apiTokens.id, token.id));
	return {
		user: { id: u.id, email: u.email, name: u.name, role: u.role },
		via: {
			kind: "token",
			tokenId: token.id,
			name: token.name,
			scope: token.scope,
		},
	};
}

export function listTokens(db: ControlDb, uid: string): Promise<ApiTokenRow[]> {
	return db
		.select()
		.from(apiTokens)
		.where(eq(apiTokens.userId, uid))
		.orderBy(desc(apiTokens.createdAt), desc(apiTokens.id));
}

/** Revoke one of the caller's own tokens. False if it isn't theirs, doesn't exist, or is already revoked. */
export async function revokeToken(
	db: ControlDb,
	uid: string,
	id: number,
): Promise<boolean> {
	const rows = await db
		.update(apiTokens)
		.set({ revokedAt: new Date() })
		.where(
			and(
				eq(apiTokens.id, id),
				eq(apiTokens.userId, uid),
				isNull(apiTokens.revokedAt),
			),
		)
		.returning({ id: apiTokens.id });
	return rows.length > 0;
}
