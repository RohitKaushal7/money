/**
 * A per-key async mutex: `run(key, fn)` starts `fn` once every earlier `fn` for that key has settled,
 * success or failure; different keys don't wait on each other. Not re-entrant — an `fn` that runs the same
 * key again waits on itself forever.
 */
export function keyedLock() {
	const tails = new Map<string, Promise<void>>();
	return function run<T>(key: string, fn: () => Promise<T>): Promise<T> {
		const prev = tails.get(key) ?? Promise.resolve();
		const result = prev.then(fn);
		const tail = result.then(
			() => undefined,
			() => undefined,
		);
		tails.set(key, tail);
		// Forget a key once its last holder is done, so the map holds only keys in use.
		void tail.then(() => {
			if (tails.get(key) === tail) tails.delete(key);
		});
		return result;
	};
}
