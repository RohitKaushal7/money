import { describe, expect, test } from "bun:test";
import { LockWaitTimeout, withUserLock } from "./ingest-runner";

/** A promise and the function that settles it, so a test decides when a lock holder finishes. */
function gate() {
	let open!: () => void;
	const opened = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { opened, open };
}

/** Lets every already-queued promise callback run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("withUserLock", () => {
	test("with no wait limit (an ingest), a holder waits as long as it takes", async () => {
		const first = gate();
		const events: string[] = [];
		const a = withUserLock("w-ingest", async () => {
			events.push("a");
			await first.opened;
		});
		const b = withUserLock("w-ingest", async () => {
			events.push("b");
		});
		await flush();
		expect(events).toEqual(["a"]);
		first.open();
		await Promise.all([a, b]);
		expect(events).toEqual(["a", "b"]);
	});

	test("a waiter with maxWaitMs gives up with LockWaitTimeout and never runs; the next holder still waits for the first", async () => {
		const first = gate();
		const events: string[] = [];
		const a = withUserLock("w-timeout", async () => {
			events.push("a:start");
			await first.opened;
			events.push("a:end");
		});
		const late = withUserLock(
			"w-timeout",
			async () => {
				events.push("late");
			},
			{ maxWaitMs: 20 },
		);
		const c = withUserLock("w-timeout", async () => {
			events.push("c");
		});
		const e = await late.then(
			() => undefined,
			(err: unknown) => err,
		);
		expect(e).toBeInstanceOf(LockWaitTimeout);
		await flush();
		expect(events).toEqual(["a:start"]);
		first.open();
		await Promise.all([a, c]);
		expect(events).toEqual(["a:start", "a:end", "c"]);
	});

	test("a waiter that gets the lock in time runs normally", async () => {
		const first = gate();
		const a = withUserLock("w-intime", () => first.opened);
		const b = withUserLock("w-intime", async () => "ran", {
			maxWaitMs: 10_000,
		});
		first.open();
		await a;
		expect(await b).toBe("ran");
	});

	test("a waiter whose signal aborts gives up at once and never runs", async () => {
		const first = gate();
		const controller = new AbortController();
		let ran = false;
		const a = withUserLock("w-abort", () => first.opened);
		const b = withUserLock(
			"w-abort",
			async () => {
				ran = true;
			},
			{ signal: controller.signal },
		);
		controller.abort(new Error("caller went away"));
		await expect(b).rejects.toThrow("caller went away");
		first.open();
		await a;
		await flush();
		expect(ran).toBe(false);
	});

	test("an already-aborted signal never runs, even with the lock free", async () => {
		let ran = false;
		const signal = AbortSignal.abort(new Error("gone"));
		await expect(
			withUserLock(
				"w-preaborted",
				async () => {
					ran = true;
				},
				{ signal },
			),
		).rejects.toThrow("gone");
		expect(ran).toBe(false);
		expect(await withUserLock("w-preaborted", async () => 1)).toBe(1);
	});

	test("a signal that aborts after the holder started doesn't affect it", async () => {
		const controller = new AbortController();
		const result = withUserLock(
			"w-late-abort",
			async () => {
				controller.abort();
				return "done";
			},
			{ signal: controller.signal, maxWaitMs: 10 },
		);
		expect(await result).toBe("done");
	});

	test("a holder that throws before returning a promise still releases the lock", async () => {
		const boom = withUserLock("w-sync-throw", (() => {
			throw new Error("sync boom");
		}) as () => Promise<void>);
		await expect(boom).rejects.toThrow("sync boom");
		expect(await withUserLock("w-sync-throw", async () => "next")).toBe("next");
	});
});
