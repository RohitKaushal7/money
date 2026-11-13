/** Test-only stand-in for `sandboxed-query-worker.ts`: exits cleanly having written no valid response. */
await Bun.write(Bun.stdout, "not json");

export {};
