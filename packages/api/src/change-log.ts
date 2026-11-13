import { type AppDb, changeLog } from "@money/db";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
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
 */
export async function undoChange(
	appDb: AppDb,
	id: number,
): Promise<UndoResult> {
	return appDb.transaction(async (tx): Promise<UndoResult> => {
		const db = tx as unknown as AppDb;
		const [change] = await db
			.select()
			.from(changeLog)
			.where(eq(changeLog.id, id));
		if (!change) return { ok: false, reason: `no change #${id}` };
		if (change.undoneAt) {
			return { ok: false, reason: `change #${id} was already undone` };
		}
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
			reason: `${label} has changed since change #${id}; undo refused`,
		};
		const current = await readEntityRow(db, entity, entityId);
		const table = sql.identifier(ENTITY_TABLES[entity]);
		const matchesAfter = (row: RawRow | null, a: RawRow) =>
			row !== null && row.updated_at === a.updated_at && sameRow(row, a);

		switch (operation) {
			case "insert": {
				if (!after) return nothing;
				if (!matchesAfter(current, after)) return stale;
				await db.run(sql`delete from ${table} where id = ${entityId}`);
				break;
			}
			case "update": {
				if (!before || !after) return nothing;
				if (!matchesAfter(current, after)) return stale;
				const sets = Object.entries(before)
					.filter(([k]) => k !== "id")
					.map(([k, v]) => sql`${sql.identifier(k)} = ${v}`);
				await db.run(
					sql`update ${table} set ${sql.join(sets, sql`, `)} where id = ${entityId}`,
				);
				break;
			}
			case "delete": {
				if (!before || after) return nothing;
				if (current) {
					return {
						ok: false,
						reason: `${label} has changed since change #${id} (a row with that id exists again); undo refused`,
					};
				}
				const entries = Object.entries(before);
				const cols = sql.join(
					entries.map(([k]) => sql.identifier(k)),
					sql`, `,
				);
				const vals = sql.join(
					entries.map(([, v]) => sql`${v}`),
					sql`, `,
				);
				await db.run(sql`insert into ${table} (${cols}) values (${vals})`);
				break;
			}
		}

		await db
			.update(changeLog)
			.set({ undoneAt: new Date() })
			.where(and(eq(changeLog.id, id), isNull(changeLog.undoneAt)));
		return { ok: true };
	});
}

/** The numeric `id` field of a procedure's input or output, if it has one (ids arrive as strings too). */
export function idOf(value: unknown): number | undefined {
	const raw = (value as { id?: unknown } | null | undefined)?.id;
	const n = typeof raw === "string" && raw !== "" ? Number(raw) : raw;
	return typeof n === "number" && Number.isInteger(n) ? n : undefined;
}
