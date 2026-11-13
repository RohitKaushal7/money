import { describe, expect, test } from "bun:test";

import { keyedLock } from "./keyed-lock";

/** A promise plus the function that resolves it, so a test decides when a holder finishes. */
function gate() {
	let open = () => {};
	const opened = new Promise<void>((r) => {
		open = r;
	});
	return { opened, open };
}

describe("keyedLock", () => {
	test("calls for one key run one at a time, in order", async () => {
		const run = keyedLock();
		const events: string[] = [];
		const first = gate();
		const a = run("k", async () => {
			events.push("a start");
			await first.opened;
			events.push("a end");
			return "a";
		});
		const b = run("k", async () => {
			events.push("b start");
			return "b";
		});
		await Bun.sleep(5);
		expect(events).toEqual(["a start"]);
		first.open();
		expect(await Promise.all([a, b])).toEqual(["a", "b"]);
		expect(events).toEqual(["a start", "a end", "b start"]);
	});

	test("different keys don't wait for each other", async () => {
		const run = keyedLock();
		const held = gate();
		const a = run("k1", () => held.opened);
		expect(await run("k2", async () => "k2 ran")).toBe("k2 ran");
		held.open();
		await a;
	});

	test("a holder that rejects passes its error on and still releases the lock", async () => {
		const run = keyedLock();
		const failing = run("k", async () => {
			throw new Error("boom");
		});
		const next = run("k", async () => "next ran");
		await expect(failing).rejects.toThrow("boom");
		expect(await next).toBe("next ran");
	});

	test("a holder that throws synchronously also releases the lock", async () => {
		const run = keyedLock();
		const failing = run("k", (() => {
			throw new Error("sync boom");
		}) as () => Promise<never>);
		await expect(failing).rejects.toThrow("sync boom");
		expect(await run("k", async () => "after")).toBe("after");
	});
});
