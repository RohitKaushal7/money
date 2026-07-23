/**
 * CSV serialisation — the one place the app turns rows into CSV text (RFC 4180). Pure and framework-free:
 * @money/shared is imported by the browser, so no node:* here (string ops only).
 */

/** One output column: which row key to read, the header text, and an optional per-cell formatter. */
export interface CsvColumn<Row> {
	key: keyof Row & string;
	header: string;
	/** Map the raw cell value to a string before escaping. Defaults to the shared cell renderer. */
	format?: (value: Row[keyof Row & string], row: Row) => string;
}

const NEEDS_QUOTING = /[",\r\n]/;

/** Render one cell: null/undefined → "", everything else via String(). */
function defaultCell(value: unknown): string {
	if (value === null || value === undefined) return "";
	return String(value);
}

/** Escape one already-rendered cell per RFC 4180. */
function escapeCell(text: string): string {
	if (!NEEDS_QUOTING.test(text)) return text;
	return `"${text.replace(/"/g, '""')}"`;
}

/** Serialise `rows` to CSV using `columns` (order preserved). Header row + one line per row, CRLF-joined. */
export function toCsv<Row>(rows: Row[], columns: CsvColumn<Row>[]): string {
	const header = columns.map((c) => escapeCell(c.header)).join(",");
	const body = rows.map((row) =>
		columns
			.map((c) => {
				const raw = row[c.key];
				const rendered = c.format ? c.format(raw, row) : defaultCell(raw);
				return escapeCell(rendered);
			})
			.join(","),
	);
	return [header, ...body].join("\r\n");
}

/** Money cell: plain decimal, 2 dp, no separators or symbol. Blank for null/undefined/empty. */
export function csvAmount(value: unknown): string {
	if (value === null || value === undefined || value === "") return "";
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n.toFixed(2) : "";
}
