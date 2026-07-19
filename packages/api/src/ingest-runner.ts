import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Spawns `scripts/ingest.ts` — the SOLE DuckDB read-write owner (ADR-0003) — so the API can trigger an
 * import / re-tag WITHOUT ever opening DuckDB read-write itself. This module deliberately does **not**
 * import `@money/analytics/ingest`; it shells out to the sanctioned script, keeping the API's read-only
 * boundary intact (the ADR-0003 grep guard still passes). Uses `node:child_process` (not the `Bun` global)
 * so `@money/api` type-checks cleanly under every consumer's tsconfig (web included).
 *
 * A module-level mutex serialises every spawn: DuckDB permits a single writer, so two runs (e.g. an import
 * arriving while a re-tag is mid-flight) must never overlap. Dry-runs are read-only but go through the same
 * queue so they observe a consistent, non-mid-rebuild view.
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

// Serialisation queue: each run is chained after the previous one settles (success OR failure).
let tail: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
	const run = tail.then(fn, fn);
	tail = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

async function spawnIngest(args: string[]): Promise<IngestResult> {
	const proc = spawn("bun", [INGEST_SCRIPT, ...args], { cwd: REPO_ROOT });
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

/** Full rebuild from `data/raw/*.csv` (idempotent). */
export function runRebuild(): Promise<IngestResult> {
	return withLock(() => spawnIngest([]));
}

/** Cheap re-tag: re-derive splits from the current SQLite rules/overrides, no CSV re-import (~0.3s). */
export function runRetag(): Promise<IngestResult> {
	return withLock(() => spawnIngest(["--retag"]));
}

/** Parse one CSV and report new/duplicate counts without writing (import preview). */
export function runDryRun(csvPath: string): Promise<IngestResult> {
	return withLock(() => spawnIngest(["--dry-run", csvPath]));
}

/** A short, user-facing error string distilled from a failed run (last non-empty stderr/stdout line). */
export function ingestErrorMessage(r: IngestResult): string {
	const lines = `${r.stderr}\n${r.stdout}`
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	return lines[lines.length - 1] ?? `ingest exited ${r.exitCode}`;
}
