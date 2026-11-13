import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Spawns `scripts/ingest.ts` — the SOLE DuckDB read-write owner (ADR-0003) — so the API can trigger an
 * import / re-tag WITHOUT ever opening DuckDB read-write itself. Shells out to the sanctioned script (never
 * imports `@money/analytics/ingest`), keeping the API's read-only boundary intact. Uses `node:child_process`
 * (not the `Bun` global) so `@money/api` type-checks under every consumer's tsconfig (web included).
 *
 * A PER-USER mutex serialises a user's runs (DuckDB is single-writer per file); different users run
 * concurrently (separate files). The MCP `query` tool takes the same lock (see {@link withUserLock}): DuckDB
 * refuses a read-write open while any other process holds the file, even read-only.
 */

/** Repo root (trailing slash), resolved from this file at `packages/api/src/ingest-runner.ts`. */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const INGEST_SCRIPT = `${REPO_ROOT}scripts/ingest.ts`;
const MARKER = "[ingest:result] ";

export type IngestMode = "rebuild" | "retag" | "dryrun";

export interface IngestResult {
	/** subprocess exited 0 */
	ok: boolean;
	/** parsed `[ingest:result]` payload, or null if the run died before emitting it */
	result: Record<string, unknown> | null;
	stdout: string;
	stderr: string;
	exitCode: number;
}

/** Just the `ChildProcess` event surface we use — Bun's bundled node types omit these EventEmitter methods. */
interface ProcEvents {
	on(event: "error", cb: (err: Error) => void): void;
	on(event: "close", cb: (code: number | null) => void): void;
}

// Per-user serialisation: each user's run is chained after that user's previous run settles (success OR failure).
const tails = new Map<string, Promise<unknown>>();

/** {@link withUserLock} waited its `maxWaitMs` and the lock was still held. */
export class LockWaitTimeout extends Error {
	constructor(maxWaitMs: number) {
		super(`Waited ${maxWaitMs / 1000}s for this account's data to be free`);
		this.name = "LockWaitTimeout";
	}
}

export interface UserLockOptions {
	/** Give up with {@link LockWaitTimeout} if the lock isn't free by then. Unset (ingests): wait as long as it takes. */
	maxWaitMs?: number;
	/** Give up, with the signal's reason, if it aborts before the lock is free: the caller is gone. */
	signal?: AbortSignal;
}

const noop = () => undefined;

/**
 * Run `fn` once every earlier holder of `uid`'s lock has settled, success or failure. Everything that opens a
 * user's analytics file from a separate process takes it — ingests, re-tags and the MCP `query` sandbox — so a
 * query never makes an ingest fail with "Could not set lock on file", and vice versa.
 *
 * A caller that gives up waiting (`maxWaitMs`, `signal`) never runs `fn`, and holders queued after it still
 * wait for the ones before it. Once `fn` has started, neither option affects it.
 */
export function withUserLock<T>(
	uid: string,
	fn: () => Promise<T>,
	{ maxWaitMs, signal }: UserLockOptions = {},
): Promise<T> {
	const prev = (tails.get(uid) ?? Promise.resolve()).then(noop, noop);
	const run = new Promise<T>((resolve, reject) => {
		let waiting = true;
		const giveUp = (error: unknown) => {
			if (!waiting) return;
			waiting = false;
			stopWaiting();
			reject(error);
		};
		const onAbort = () => giveUp(signal?.reason);
		const timer =
			maxWaitMs === undefined
				? undefined
				: setTimeout(() => giveUp(new LockWaitTimeout(maxWaitMs)), maxWaitMs);
		const stopWaiting = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		};
		if (signal?.aborted) return onAbort();
		signal?.addEventListener("abort", onAbort, { once: true });
		prev.then(() => {
			if (!waiting) return;
			waiting = false;
			stopWaiting();
			try {
				fn().then(resolve, reject);
			} catch (e) {
				reject(e);
			}
		});
	});
	// The next holder waits for everything before this one, and for `fn` if it ran.
	tails.set(
		uid,
		prev.then(() => run.then(noop, noop)),
	);
	return run;
}

/** Runs `scripts/ingest.ts` for one user with the given flags. A parameter of the run functions so tests can stub it. */
export type IngestSpawner = (
	uid: string,
	args: string[],
) => Promise<IngestResult>;

const spawnIngest: IngestSpawner = async (uid, args) => {
	const proc = spawn("bun", [INGEST_SCRIPT, "--user", uid, ...args], {
		cwd: REPO_ROOT,
	});
	let stdout = "";
	let stderr = "";
	proc.stdout?.on("data", (d: unknown) => {
		stdout += String(d);
	});
	proc.stderr?.on("data", (d: unknown) => {
		stderr += String(d);
	});
	const events = proc as unknown as ProcEvents;
	const exitCode = await new Promise<number>((resolve) => {
		events.on("error", () => resolve(-1)); // e.g. `bun` not on PATH
		events.on("close", (code) => resolve(code ?? 0));
	});
	const line = stdout
		.split("\n")
		.reverse()
		.find((l) => l.startsWith(MARKER));
	let result: Record<string, unknown> | null = null;
	if (line) {
		try {
			result = JSON.parse(line.slice(MARKER.length)) as Record<string, unknown>;
		} catch {
			result = null;
		}
	}
	return { ok: exitCode === 0, result, stdout, stderr, exitCode };
};

/** Full rebuild from the user's `raw/*.csv` (idempotent). */
export function runRebuild(
	uid: string,
	spawner: IngestSpawner = spawnIngest,
): Promise<IngestResult> {
	return withUserLock(uid, () => spawner(uid, []));
}

/** Cheap re-tag: re-derive splits from the user's SQLite rules/overrides, no CSV re-import (~0.3s). */
export function runRetag(
	uid: string,
	spawner: IngestSpawner = spawnIngest,
): Promise<IngestResult> {
	return withUserLock(uid, () => spawner(uid, ["--retag"]));
}

/** Parse one CSV and report new/duplicate counts without writing (import preview). */
export function runDryRun(
	uid: string,
	csvPath: string,
	spawner: IngestSpawner = spawnIngest,
): Promise<IngestResult> {
	return withUserLock(uid, () => spawner(uid, ["--dry-run", csvPath]));
}

/** A short, user-facing error string distilled from a failed run (last non-empty stderr/stdout line). */
export function ingestErrorMessage(r: IngestResult): string {
	const lines = `${r.stderr}\n${r.stdout}`
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	return lines[lines.length - 1] ?? `ingest exited ${r.exitCode}`;
}
