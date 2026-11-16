import { describe, expect, test } from "bun:test";
import { formatDate, isISODate, todayISODate, toISODate } from "./dates";

describe("toISODate", () => {
	test("passes the stored form through, and the date part of a timestamp", () => {
		expect(toISODate("2026-08-15")).toBe("2026-08-15");
		expect(toISODate("2026-08-15T10:00:00Z")).toBe("2026-08-15");
	});
	test("reads every day-first form people type", () => {
		expect(toISODate("16/09/2026")).toBe("2026-09-16");
		expect(toISODate("7/6/2027")).toBe("2027-06-07");
		expect(toISODate("25-02-2027")).toBe("2027-02-25");
		expect(toISODate("25.02.2027")).toBe("2027-02-25");
		expect(toISODate(" 15112026 ")).toBe("2026-11-15");
	});
	test("null for days the calendar doesn't have", () => {
		expect(toISODate("31-02-2027")).toBeNull();
		expect(toISODate("29-02-2027")).toBeNull();
		expect(toISODate("29-02-2028")).toBe("2028-02-29");
		expect(toISODate("2027-13-01")).toBeNull();
		expect(toISODate("00-01-2027")).toBeNull();
	});
	test("null for absent, garbage, and two-digit years", () => {
		expect(toISODate(undefined)).toBeNull();
		expect(toISODate("")).toBeNull();
		expect(toISODate("not a date")).toBeNull();
		expect(toISODate("27-11-27")).toBeNull();
	});
});

describe("isISODate", () => {
	test("only the exact stored form of a real day", () => {
		expect(isISODate("2027-11-27")).toBe(true);
		expect(isISODate("27-11-2027")).toBe(false);
		expect(isISODate("2027-02-30")).toBe(false);
		expect(isISODate("2027-11-27T00:00")).toBe(false);
	});
});

describe("formatDate", () => {
	test("a date shows day-first, as written, whatever the timezone", () => {
		expect(formatDate("2026-11-05")).toBe("05-11-2026");
		expect(formatDate("07/06/2027")).toBe("07-06-2027");
	});
	test("a timestamp shows as the local day", () => {
		const local = new Date(2026, 10, 5, 23, 30);
		expect(formatDate(local)).toBe("05-11-2026");
		expect(formatDate(local.getTime())).toBe("05-11-2026");
	});
	test("nothing is empty; an unreadable string stays visible", () => {
		expect(formatDate(undefined)).toBe("");
		expect(formatDate(null)).toBe("");
		expect(formatDate("27-11-27")).toBe("27-11-27");
	});
});

test("todayISODate is the local day", () => {
	expect(todayISODate(new Date(2026, 0, 2, 0, 5))).toBe("2026-01-02");
});
