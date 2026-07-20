import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Spawns `scripts/ingest.ts` — the SOLE DuckDB read-write owner (ADR-0003) — so the API can trigger an
 * import / re-tag WITHOUT ever opening DuckDB read-write itself. Shells out to the sanctioned script (never
 * imports `@money/analytics/ingest`), keeping the API's read-only boundary intact. Uses `node:child_process`
 * (not the `Bun` global) so `@money/api` type-checks under every consumer's tsconfig (web included).
 *
 * A PER-USER mutex serialises a user's runs (DuckDB is single-writer per file); different users run
 * concurrently (separate files).
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

function withLock<T>(uid: string, fn: () => Promise<T>): Promise<T> {
	const prev = tails.get(uid) ?? Promise.resolve();
	const run = prev.then(fn, fn);
	tails.set(
		uid,
		run.then(
			() => undefined,
			() => undefined,
		),
	);
	return run;
}

async function spawnIngest(uid: string, args: string[]): Promise<IngestResult> {
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
}

/** Full rebuild from the user's `raw/*.csv` (idempotent). */
export function runRebuild(uid: string): Promise<IngestResult> {
	return withLock(uid, () => spawnIngest(uid, []));
}

/** Cheap re-tag: re-derive splits from the user's SQLite rules/overrides, no CSV re-import (~0.3s). */
export function runRetag(uid: string): Promise<IngestResult> {
	return withLock(uid, () => spawnIngest(uid, ["--retag"]));
}

/** Parse one CSV and report new/duplicate counts without writing (import preview). */
export function runDryRun(uid: string, csvPath: string): Promise<IngestResult> {
	return withLock(uid, () => spawnIngest(uid, ["--dry-run", csvPath]));
}

/** A short, user-facing error string distilled from a failed run (last non-empty stderr/stdout line). */
export function ingestErrorMessage(r: IngestResult): string {
	const lines = `${r.stderr}\n${r.stdout}`
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	return lines[lines.length - 1] ?? `ingest exited ${r.exitCode}`;
}
