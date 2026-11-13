import { type AppDb, changeLog } from "@money/db";
import { and, desc, eq, isNull, lt, type SQL, sql } from "drizzle-orm";
import { keyedLock } from "./keyed-lock";
import type { McpEntity } from "./mcp/meta";

/**
 * The change log: one row per write to a user's data, with the raw before/after row of the holding or
 * expense it touched so that write can be undone.
 *
 * Rows are kept raw — snake_case columns, booleans as 0/1, timestamps as ms — so an undo writes back
 * exactly what was there, `updated_at` included. That also makes undo stack: undoing the newest change
 * leaves the row equal to the previous change's `after`, so that one becomes undoable next.
 */

export type ChangeRow = typeof changeLog.$inferSelect;
export type NewChange = typeof changeLog.$inferInsert;
export type RawRow = Record<string, unknown>;

/** The tables an undoable write can touch. Table names come from here, never from logged data. */
const ENTITY_TABLES: Record<McpEntity, string> = {
	investments: "investments",
	recurring_expenses: "recurring_expenses",
};

/**
 * One lock per user around every write to a holding or recurring expense that the change log reads rows
 * for — logged entity writes (see `logWrites`) and undo — so a change's before/after rows are its own.
 * Separate from the ingest lock (`withUserLock`): it is held only for a few SQLite statements, and nothing
 * holding it ever waits on an ingest.
 */
export const withEntityLock = keyedLock();

export async function recordChange(
	appDb: AppDb,
	entry: NewChange,
): Promise<void> {
	await appDb.insert(changeLog).values(entry);
}

/** Newest first. `before` is an id cursor: only changes with a smaller id are returned. */
export async function listChanges(
	appDb: AppDb,
	opts: { limit: number; before?: number },
): Promise<ChangeRow[]> {
	return appDb
		.select()
		.from(changeLog)
		.where(
			opts.before === undefined ? undefined : lt(changeLog.id, opts.before),
		)
		.orderBy(desc(changeLog.id))
		.limit(opts.limit);
}

/** The entity's row exactly as stored, or null when no row has that id. */
export async function readEntityRow(
	appDb: AppDb,
	entity: McpEntity,
	id: number,
): Promise<RawRow | null> {
	const table = sql.identifier(ENTITY_TABLES[entity]);
	const rows = await appDb.all<RawRow>(
		sql`select * from ${table} where id = ${id}`,
	);
	return rows[0] ?? null;
}

function sameRow(a: RawRow, b: RawRow): boolean {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	for (const k of keys) {
		if (a[k] !== b[k]) return false;
	}
	return true;
}

type UndoResult = { ok: true } | { ok: false; reason: string };

/**
 * Reverse one logged write to a holding or expense, by its stored `operation`: an insert is deleted, an
 * update has its `before` row written back, a delete is re-inserted with its original id and columns.
 *
 * Refused when the row has moved on since the change (its `updated_at`, or any column, differs from the
 * logged `after`; for a delete, a row with that id exists again), when the change was already undone, when
 * the logged rows don't fit the operation (e.g. an update that matched no row), or when the write wasn't
 * logged as an undoable entity operation.
 *
 * The checks read first; the write is then one libSQL batch — one SQLite transaction on the client's own
 * connection, run synchronously, so nothing else can write in between its statements. The batch re-checks
 * what the reads saw, in case a write landed between the reads and the batch:
 *
 *   0. mark the change undone, only if it isn't already;
 *   1. the entity write, only if statement 0 marked it (`changes() = 1`) and the row is still as logged —
 *      same `updated_at` for an insert's or update's undo, and no row with that id for a delete's;
 *   2. a guard that fails unless statement 1 changed exactly one row, rolling the whole batch back.
 *
 * So the change is marked undone exactly when its row was written back, and a lost race refuses with the
 * same reason the reads would have given.
 */
export async function undoChange(
	appDb: AppDb,
	id: number,
): Promise<UndoResult> {
	const [change] = await appDb
		.select()
		.from(changeLog)
		.where(eq(changeLog.id, id));
	if (!change) return { ok: false, reason: `no change #${id}` };
	const alreadyUndone: UndoResult = {
		ok: false,
		reason: `change #${id} was already undone`,
	};
	if (change.undoneAt) return alreadyUndone;
	const { entity, operation, entityId } = change;
	if (!entity || !operation) {
		return { ok: false, reason: "not undoable in this version" };
	}
	const before = (change.before as RawRow | null) ?? null;
	const after = (change.after as RawRow | null) ?? null;
	const nothing: UndoResult = {
		ok: false,
		reason: `change #${id} wrote nothing to undo`,
	};
	if (entityId == null) return nothing;
	const label = `${entity} #${entityId}`;
	const stale: UndoResult = {
		ok: false,
		reason:
			operation === "delete"
				? `${label} has changed since change #${id} (a row with that id exists again); undo refused`
				: `${label} has changed since change #${id}; undo refused`,
	};
	const current = await readEntityRow(appDb, entity, entityId);
	const table = sql.identifier(ENTITY_TABLES[entity]);
	const matchesAfter = (row: RawRow | null, a: RawRow) =>
		row !== null && row.updated_at === a.updated_at && sameRow(row, a);

	let write: SQL;
	switch (operation) {
		case "insert": {
			if (!after) return nothing;
			if (!matchesAfter(current, after)) return stale;
			write = sql`delete from ${table} where id = ${entityId} and updated_at = ${after.updated_at} and changes() = 1`;
			break;
		}
		case "update": {
			if (!before || !after) return nothing;
			if (!matchesAfter(current, after)) return stale;
			const sets = Object.entries(before)
				.filter(([k]) => k !== "id")
				.map(([k, v]) => sql`${sql.identifier(k)} = ${v}`);
			write = sql`update ${table} set ${sql.join(sets, sql`, `)} where id = ${entityId} and updated_at = ${after.updated_at} and changes() = 1`;
			break;
		}
		case "delete": {
			if (!before || after) return nothing;
			if (current) return stale;
			const entries = Object.entries(before);
			const cols = sql.join(
				entries.map(([k]) => sql.identifier(k)),
				sql`, `,
			);
			const vals = sql.join(
				entries.map(([, v]) => sql`${v}`),
				sql`, `,
			);
			write = sql`insert into ${table} (${cols}) select ${vals} where changes() = 1 and not exists (select 1 from ${table} where id = ${entityId})`;
			break;
		}
	}

	try {
		await appDb.batch([
			appDb
				.update(changeLog)
				.set({ undoneAt: new Date() })
				.where(and(eq(changeLog.id, id), isNull(changeLog.undoneAt))),
			appDb.run(write),
			// SQL has no `raise` outside a trigger; malformed JSON is an error SQLite raises on demand. The
			// argument depends on changes(), so it is evaluated here, not folded into a constant when prepared.
			appDb.run(
				sql`select json(case when changes() = 1 then '0' else 'undo refused' end)`,
			),
		]);
	} catch (e) {
		if ((e as { statementIndex?: unknown }).statementIndex !== 2) throw e;
		// Rolled back: either the change was undone, or its row moved on, since the reads above.
		const [now] = await appDb
			.select({ undoneAt: changeLog.undoneAt })
			.from(changeLog)
			.where(eq(changeLog.id, id));
		return now?.undoneAt ? alreadyUndone : stale;
	}
	return { ok: true };
}

/** The numeric `id` field of a procedure's input or output, if it has one (ids arrive as strings too). */
export function idOf(value: unknown): number | undefined {
	const raw = (value as { id?: unknown } | null | undefined)?.id;
	const n = typeof raw === "string" && raw !== "" ? Number(raw) : raw;
	return typeof n === "number" && Number.isInteger(n) ? n : undefined;
}
