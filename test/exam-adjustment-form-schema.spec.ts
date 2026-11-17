import { expect, test } from "@playwright/test";
import * as core from "zod/v4/core";
import {
	examAdjustmentCreateForm,
	examAdjustmentUpdateForm,
} from "@/core/schemas/exam-adjustment";
import { formToInput } from "@/forms/form-to-input";

/// The adjustment forms as the dialogs submit them: `FormData` read the way an Astro action reads it, then parsed.

function form(entries: [string, string][]): FormData {
	const data = new FormData();
	for (const [key, value] of entries) data.append(key, value);
	return data;
}

const UPDATE_BASE: [string, string][] = [
	["discipline", "cs"],
	["course", "2026-1"],
	["exam", "midterm"],
	["adjustment", "abc123def456"],
	["updatedAt", "2026-01-01T00:00:00.000Z"],
];

function parseUpdate(extra: [string, string][]) {
	return core.safeParse(
		examAdjustmentUpdateForm,
		formToInput(examAdjustmentUpdateForm, form([...UPDATE_BASE, ...extra])),
	);
}

function parseCreate(extra: [string, string][]) {
	return core.safeParse(
		examAdjustmentCreateForm,
		formToInput(
			examAdjustmentCreateForm,
			form([
				["discipline", "cs"],
				["course", "2026-1"],
				["exam", "midterm"],
				["usernames", "ana"],
				...extra,
			]),
		),
	);
}

test("update form: an empty reason and notes become null so the edit clears them", () => {
	const parsed = parseUpdate([
		["value", "0"],
		["reason", ""],
		["notes", "  "],
	]);

	expect(parsed.success).toBe(true);
	expect(parsed.data).toMatchObject({ reason: null, notes: null });
});

test("update form: a filled reason and notes are kept, trimmed", () => {
	const parsed = parseUpdate([
		["value", "0"],
		["reason", " copied "],
		["notes", "saw it"],
	]);

	expect(parsed.data).toMatchObject({ reason: "copied", notes: "saw it" });
});

test("update form: the value is a percentage, with a decimal comma as a point", () => {
	const parsed = parseUpdate([
		["value", "12,5"],
		["reason", ""],
		["notes", ""],
	]);

	expect(parsed.success).toBe(true);
	expect(parsed.data).toMatchObject({ value: "0.125" });
});

/// `[op, typed percentage, stored fraction]`: the conversion each operation reads the field with.
const conversions: Array<[string, string, string]> = [
	["FACTOR", "50", "0.5"],
	["FACTOR", "110", "1.1"],
	["FACTOR", "0", "0"],
	["FACTOR", "100", "1"],
	["FACTOR", "200", "2"],
	["SET", "80", "0.8"],
	["SET", "100", "1"],
	["SET", "0", "0"],
	["OFFSET", "10", "0.1"],
	["OFFSET", "-10", "-0.1"],
	["OFFSET", "5", "0.05"],
	["FACTOR", "33.33", "0.3333"],
	["OFFSET", "0,5", "0.005"],
	["OFFSET", "100", "1"],
	["OFFSET", "-100", "-1"],
];

for (const [op, typed, stored] of conversions) {
	test(`create form: ${op} ${typed} is stored as ${stored}`, () => {
		const parsed = parseCreate([
			["op", op],
			["value", typed],
		]);

		expect(parsed.success).toBe(true);
		expect(parsed.data).toMatchObject({ op, value: stored });
	});
}

/// `[op, typed percentage]` the ranges of the operation refuse once converted.
const refused: Array<[string, string]> = [
	["FACTOR", "201"],
	["FACTOR", "-1"],
	["SET", "101"],
	["SET", "-5"],
	["OFFSET", "0"],
	["OFFSET", "101"],
	["OFFSET", "-101"],
	["OFFSET", "abc"],
	["FACTOR", ""],
];

for (const [op, typed] of refused) {
	test(`create form: ${op} ${JSON.stringify(typed)} is refused on value`, () => {
		const parsed = parseCreate([
			["op", op],
			["value", typed],
		]);

		expect(parsed.success).toBe(false);
		expect(parsed.error?.issues.map((issue) => issue.path[0])).toContain(
			"value",
		);
	});
}

test("create form: a question only takes a FACTOR below 100%", () => {
	const reduce = parseCreate([
		["op", "FACTOR"],
		["value", "50"],
		["question", "q1"],
	]);
	const bonus = parseCreate([
		["op", "FACTOR"],
		["value", "100"],
		["question", "q1"],
	]);
	const set = parseCreate([
		["op", "SET"],
		["value", "50"],
		["question", "q1"],
	]);

	expect(reduce.success).toBe(true);
	expect(bonus.success).toBe(false);
	expect(set.success).toBe(false);
});

test("create form: an unknown operation is refused", () => {
	expect(
		parseCreate([
			["op", "ADD"],
			["value", "10"],
		]).success,
	).toBe(false);
});

test("create form: a question and a value of 0 parse as a zeroed question", () => {
	const parsed = parseCreate([
		["op", "FACTOR"],
		["value", "0"],
		["question", "q1"],
	]);

	expect(parsed.success).toBe(true);
	expect(parsed.data).toMatchObject({
		op: "FACTOR",
		value: "0",
		question: "q1",
	});
});

test("create form: a question without a value is refused on value", () => {
	const parsed = parseCreate([
		["op", "FACTOR"],
		["question", "q1"],
	]);

	expect(parsed.success).toBe(false);
	expect(parsed.error?.issues.map((issue) => issue.path[0])).toContain("value");
});
