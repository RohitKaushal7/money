import { createHash } from "node:crypto";

/**
 * Axio row identity. Lives here (not in `@money/shared`) because it needs `node:crypto` for md5, and shared
 * is imported by the browser bundle, which must stay free of node built-ins. The identity is a parse-time
 * concern anyway — the web never hashes a row.
 */

/** The fields that identify an Axio row. Excludes category and the flags, so re-curating keeps the id. */
export interface AxioIdParts {
	date: string;
	time: string;
	amount: number;
	drcr: string;
	account: string;
	place: string;
}

/**
 * Deterministic row id: `md5(date|time|amount|drcr|account|place)`, amount to 2 decimals. MUST stay
 * byte-identical to the SQL expression in `buildAxioSelect` — a parity test pins the two together.
 */
export function axioRowId(p: AxioIdParts): string {
	const key = [
		p.date,
		p.time,
		p.amount.toFixed(2),
		p.drcr,
		p.account,
		p.place,
	].join("|");
	return createHash("md5").update(key).digest("hex");
}
