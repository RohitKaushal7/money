#!/usr/bin/env bun
/**
 * Create a Better-Auth account (invite-only: public signup is disabled) and provision its per-user storage.
 * First admin is bootstrapped by calling auth.api.createUser with NO headers (skips the permission check).
 *
 *   bun run create-user --email a@b.com --name "Asha" [--admin] [--password <pw>] [--adopt owner]
 *
 * --adopt <existingDir>: instead of provisioning a fresh app.db, rename data/users/<existingDir> to the new
 * user's id (used ONCE for the owner, whose 1a data lives in users/owner/). After adopting the owner, remove
 * OWNER_USER_ID from apps/server/.env so the API routes by session.user.id.
 */
import { existsSync, renameSync, rmSync } from "node:fs";
import { userDir } from "@money/analytics";
import { auth } from "@money/auth";
import { env } from "@money/env/server";

function arg(flag: string): string | undefined {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

const email = arg("--email");
const name = arg("--name");
const isAdmin = process.argv.includes("--admin");
const adopt = arg("--adopt");
const password = arg("--password") ?? Math.random().toString(36).slice(2, 12);

if (!email || !name) {
	console.error(
		"usage: bun run create-user --email <e> --name <n> [--admin] [--password <p>] [--adopt <dir>]",
	);
	process.exit(1);
}

async function main(email: string, name: string): Promise<void> {
	const res = await auth.api.createUser({
		body: { email, name, password, role: isAdmin ? "admin" : "user" },
	});
	const uid = res.user.id;
	// The Better-Auth create hook has already provisioned data/users/<uid>/.
	console.log(
		`[create-user] created ${email} (${isAdmin ? "admin" : "user"}) id=${uid}`,
	);

	if (adopt) {
		const from = userDir(env.DATA_DIR, adopt);
		const to = userDir(env.DATA_DIR, uid);
		if (existsSync(from)) {
			rmSync(to, { recursive: true, force: true }); // drop the fresh hook dir before adopting
			renameSync(from, to);
			console.log(`[create-user] adopted ${from} -> ${to}`);
			console.log(
				"[create-user] NOW remove OWNER_USER_ID from apps/server/.env, then restart the server.",
			);
		} else {
			console.log(
				`[create-user] --adopt ${adopt}: ${from} absent, kept the freshly provisioned dir`,
			);
		}
	} else {
		console.log(`[create-user] provisioned data/users/${uid}/ (via hook)`);
	}
	console.log(
		`[create-user] temp password: ${password}  (share on the onboarding call; they can change it)`,
	);
}

main(email, name).catch((e: unknown) => {
	console.error(
		`[create-user] failed: ${e instanceof Error ? e.message : String(e)}`,
	);
	process.exit(1);
});
