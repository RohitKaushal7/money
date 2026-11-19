import { describe, expect, test } from "bun:test";
import { dayLabel, groupByDay } from "./day-groups";

// a fixed "now": Thursday 19 November 2026, mid-afternoon local time
const NOW = new Date(2026, 10, 19, 15, 0);

describe("dayLabel", () => {
	test("today and yesterday by name", () => {
		expect(dayLabel("2026-11-19", NOW)).toBe("Today");
		expect(dayLabel("2026-11-18", NOW)).toBe("Yesterday");
	});

	test("weekday, day and month for this year", () => {
		expect(dayLabel("2026-07-25", NOW)).toBe("Sat 25 Jul");
	});

	test("the year only when it isn't this one", () => {
		expect(dayLabel("2025-07-26", NOW)).toBe("Sat 26 Jul 2025");
	});

	test("yesterday across a month boundary", () => {
		expect(dayLabel("2026-10-31", new Date(2026, 10, 1, 9))).toBe("Yesterday");
	});
});

describe("groupByDay", () => {
	test("consecutive rows of a day share a group, in the order given", () => {
		const rows = [
			{ id: 1, date: "2026-11-19" },
			{ id: 2, date: "2026-11-19" },
			{ id: 3, date: "2026-11-17" },
		];
		const groups = groupByDay(rows, NOW);
		expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
			["Today", [1, 2]],
			["Tue 17 Nov", [3]],
		]);
	});

	test("reads day-first dates too", () => {
		expect(groupByDay([{ date: "18-11-2026" }], NOW)[0]?.label).toBe(
			"Yesterday",
		);
	});
});
