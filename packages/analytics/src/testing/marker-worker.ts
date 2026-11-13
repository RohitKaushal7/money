/**
 * Test-only stand-in for `sandboxed-query-worker.ts`: records that it started, by creating an empty file
 * named for its pid in the directory passed as the request's `dbPath`, then never answers and never exits.
 * Lets a test see which children are running without timing them.
 */
import { writeFileSync } from "node:fs";

const req = JSON.parse(await Bun.stdin.text()) as { dbPath: string };
writeFileSync(`${req.dbPath}/${process.pid}`, "");
setInterval(() => {}, 1_000);
