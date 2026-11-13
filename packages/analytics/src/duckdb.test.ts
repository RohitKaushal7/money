import { describe, expect, test } from "bun:test";
import { normalizeRow, openConnection } from "./duckdb";

describe("normalizeRow", () => {
	test("a bigint within the safe-integer range becomes a number", () => {
		expect(
			normalizeRow({
				n: 42n,
				neg: -7n,
				max: BigInt(Number.MAX_SAFE_INTEGER),
				min: BigInt(Number.MIN_SAFE_INTEGER),
			}),
		).toEqual({
			n: 42,
			neg: -7,
			max: Number.MAX_SAFE_INTEGER,
			min: Number.MIN_SAFE_INTEGER,
		});
	});

	test("a bigint outside it becomes its exact decimal string, not a rounded number", () => {
		expect(
			normalizeRow({
				over: BigInt(Number.MAX_SAFE_INTEGER) + 2n,
				under: BigInt(Number.MIN_SAFE_INTEGER) - 2n,
			}),
		).toEqual({ over: "9007199254740993", under: "-9007199254740993" });
	});

	test("dates become ISO strings; everything else is untouched", () => {
		expect(
			normalizeRow({
				d: new Date("2026-04-01T00:00:00.000Z"),
				s: "x",
				f: 1.5,
				z: null,
			}),
		).toEqual({ d: "2026-04-01T00:00:00.000Z", s: "x", f: 1.5, z: null });
	});
});

describe("openConnection().query", () => {
	test("BIGINT, UBIGINT and HUGEINT past 2^53 keep every digit", async () => {
		const db = await openConnection(":memory:", "read_write");
		try {
			const [row] = await db.query(
				"SELECT 3::BIGINT AS small, 9007199254740993::BIGINT AS big, 18446744073709551615::UBIGINT AS ubig, 170141183460469231731687303715884105727::HUGEINT AS huge",
			);
			expect(row).toEqual({
				small: 3,
				big: "9007199254740993",
				ubig: "18446744073709551615",
				huge: "170141183460469231731687303715884105727",
			});
		} finally {
			await db.close();
		}
	});
});
