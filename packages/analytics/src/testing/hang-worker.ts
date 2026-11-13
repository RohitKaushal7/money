/**
 * Test-only stand-in for `sandboxed-query-worker.ts`: a query that ignores its timeout. It never reads its
 * request, never answers and never exits, so only the parent's kill can stop it.
 */
setInterval(() => {}, 1_000);

export {};
