import { expect, test } from "@playwright/test";
import * as core from "zod/v4/core";
import {
	examSanctionCreateForm,
	examSanctionUpdateForm,
} from "@/core/schemas/exam-sanction";
import { formToInput } from "@/forms/form-to-input";

/// The sanction forms as the dialogs submit them: `FormData` read the way an Astro action reads it, then parsed.

function form(entries: [string, string][]): FormData {
	const data = new FormData();
	for (const [key, value] of entries) data.append(key, value);
	return data;
}

const UPDATE_BASE: [string, string][] = [
	["discipline", "cs"],
	["course", "2026-1"],
	["exam", "midterm"],
	["sanction", "abc123def456"],
	["updatedAt", "2026-01-01T00:00:00.000Z"],
];

function parseUpdate(extra: [string, string][]) {
	return core.safeParse(
		examSanctionUpdateForm,
		formToInput(examSanctionUpdateForm, form([...UPDATE_BASE, ...extra])),
	);
}

function parseCreate(extra: [string, string][]) {
	return core.safeParse(
		examSanctionCreateForm,
		formToInput(
			examSanctionCreateForm,
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
		["factor", "0"],
		["reason", ""],
		["notes", "  "],
	]);

	expect(parsed.success).toBe(true);
	expect(parsed.data).toMatchObject({ reason: null, notes: null });
});

test("update form: a filled reason and notes are kept, trimmed", () => {
	const parsed = parseUpdate([
		["factor", "0"],
		["reason", " copied "],
		["notes", "saw it"],
	]);

	expect(parsed.data).toMatchObject({ reason: "copied", notes: "saw it" });
});

test("update form: a decimal comma is a decimal point", () => {
	const parsed = parseUpdate([
		["factor", "0,5"],
		["reason", ""],
		["notes", ""],
	]);

	expect(parsed.success).toBe(true);
	expect(parsed.data).toMatchObject({ factor: "0.5" });
});

test("create form: a decimal comma is a decimal point", () => {
	expect(parseCreate([["factor", "0,25"]]).data).toMatchObject({
		factor: "0.25",
	});
});

test("create form: a factor of 1 or more is still refused", () => {
	expect(parseCreate([["factor", "1,5"]]).success).toBe(false);
	expect(parseCreate([["factor", "1"]]).success).toBe(false);
});
