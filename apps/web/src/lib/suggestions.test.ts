import { describe, expect, test } from "bun:test";
import { matchSuggestions, suggestionsFrom } from "./suggestions";

describe("suggestionsFrom", () => {
	test("distinct ignoring case and blanks, most used first, with counts", () => {
		expect(
			suggestionsFrom(
				["Bonds", "bonds ", "FDs", null, "", "Bonds", "Axe"],
				"holding",
			),
		).toEqual([
			{ value: "Bonds", hint: "3 holdings" },
			{ value: "Axe", hint: "1 holding" },
			{ value: "FDs", hint: "1 holding" },
		]);
	});
});

describe("matchSuggestions", () => {
	const all = ["Wint Wealth", "SBI", "Stable Money", "Slice"].map((value) => ({
		value,
	}));
	test("everything on empty, prefix matches before substring ones", () => {
		expect(matchSuggestions(all, "").length).toBe(4);
		expect(matchSuggestions(all, "s").map((s) => s.value)).toEqual([
			"SBI",
			"Stable Money",
			"Slice",
		]);
		expect(matchSuggestions(all, "money").map((s) => s.value)).toEqual([
			"Stable Money",
		]);
	});
	test("an exact match has nothing left to complete", () => {
		expect(matchSuggestions(all, "sbi")).toEqual([]);
	});
});
