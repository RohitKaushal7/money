#!/usr/bin/env bun
/**
 * Reset a Better-Auth account password from the box itself — the way back in when the owner forgets theirs.
 *
 * There is no email reset flow (single-owner, self-hosted, no mail dependency) and the admin UI needs a
 * session you no longer have, so shell access to the control DB *is* the recovery channel. Hashing goes
 * through `auth.$context` rather than a hand-rolled hash so the stored digest matches whatever scheme
 * Better-Auth verifies with today.
 *
 *   bun run reset-password --email a@b.com [--password <pw>] [--keep-sessions]
 *
 * Existing sessions are revoked by default: a forgotten password is exactly the case where you can't be
 * sure who else is still signed in. Pass --keep-sessions to leave them alone.
 */
import { auth } from "@money/auth";
import { account, createControlDb, session, user } from "@money/db";
import { and, eq } from "drizzle-orm";

function arg(flag: string): string | undefined {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

const email = arg("--email");
const keepSessions = process.argv.includes("--keep-sessions");
const password = arg("--password") ?? Math.random().toString(36).slice(2, 12);

if (!email) {
	console.error(
		"usage: bun run reset-password --email <e> [--password <p>] [--keep-sessions]",
	);
	process.exit(1);
}

async function main(email: string): Promise<void> {
	const db = createControlDb();

	const rows = await db
		.select({ id: user.id, name: user.name, role: user.role })
		.from(user)
		.where(eq(user.email, email));
	const target = rows[0];
	if (!target) {
		throw new Error(
			`no account with email ${email} (list them with: bun run db:studio)`,
		);
	}

	const credential = await db
		.select({ id: account.id })
		.from(account)
		.where(
			and(eq(account.userId, target.id), eq(account.providerId, "credential")),
		);
	if (!credential[0]) {
		throw new Error(
			`${email} has no email+password credential to reset (social/OAuth-only account)`,
		);
	}

	const ctx = await auth.$context;
	const hash = await ctx.password.hash(password);
	await db
		.update(account)
		.set({ password: hash })
		.where(eq(account.id, credential[0].id));

	console.log(
		`[reset-password] reset ${email} (${target.role ?? "user"}) id=${target.id}`,
	);

	if (keepSessions) {
		console.log(
			"[reset-password] --keep-sessions: existing sessions left live",
		);
	} else {
		await db.delete(session).where(eq(session.userId, target.id));
		console.log("[reset-password] revoked all existing sessions");
	}

	console.log(`[reset-password] new password: ${password}`);
}

main(email).catch((e: unknown) => {
	console.error(
		`[reset-password] failed: ${e instanceof Error ? e.message : String(e)}`,
	);
	process.exit(1);
});
