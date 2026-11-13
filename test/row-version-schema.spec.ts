import { expect, test } from "@playwright/test";
import {
	answerGradeRubric,
	disciplineEdit,
	gradingRubricEdit,
	questionStatusUpdate,
	rowVersion,
} from "@/core/schemas";
import type { Rubric, RubricItem } from "@/db";
import type { CountingAnswer } from "@/services/grading";
import { graderState, toGraderItem } from "@/utils/grader-state";

/// The version an edit form carries (ADR 0013): ISO text in, `Date` out, absent stays absent.

const ISO = "2026-03-10T10:00:00.123Z";

test("rowVersion reads the ISO text of a row's updatedAt as that instant", () => {
	expect(rowVersion.parse(ISO)?.getTime()).toBe(new Date(ISO).getTime());
	expect(rowVersion.parse(new Date(ISO))?.toISOString()).toBe(ISO);
});

test("rowVersion lets a write without one stay unconditional, and refuses what is not an instant", () => {
	expect(rowVersion.parse(undefined)).toBeUndefined();
	for (const bad of ["", "yesterday", "2026-03-10", 12, null]) {
		expect(rowVersion.safeParse(bad).success, String(bad)).toBe(false);
	}
});

test("the action inputs take the version as optional text", () => {
	const status = {
		discipline: "cs",
		course: "ada_2026-1",
		slug: "q",
		status: "PUBLISHED",
	};
	expect(questionStatusUpdate.parse(status).updatedAt).toBeUndefined();
	expect(
		questionStatusUpdate.parse({ ...status, updatedAt: ISO }).updatedAt,
	).toEqual(new Date(ISO));
	expect(
		disciplineEdit.parse({ slug: "cs", name: "CS", updatedAt: ISO }).updatedAt,
	).toEqual(new Date(ISO));
	const edit = gradingRubricEdit.parse({
		discipline: "cs",
		course: "ada_2026-1",
		exam: "e",
		question: "q",
		updatedAt: ISO,
		items: [{ key: "a", value: "0.5", updatedAt: ISO }],
		deleted: [{ key: "b", updatedAt: ISO }, { key: "c" }],
	});
	expect(edit.updatedAt).toEqual(new Date(ISO));
	expect(edit.items[0]?.updatedAt).toEqual(new Date(ISO));
	expect(edit.deleted.map((entry) => entry.updatedAt)).toEqual([
		new Date(ISO),
		undefined,
	]);
	expect(
		answerGradeRubric.parse({
			discipline: "cs",
			course: "ada_2026-1",
			exam: "e",
			submission: "s",
			rubric: [],
			ref: "web-1",
			updatedAt: ISO,
		}).updatedAt,
	).toEqual(new Date(ISO));
});

const item = (updatedAt: Date | null): RubricItem =>
	({
		key: "a",
		group: null,
		text: "A",
		value: "0.5",
		comment: null,
		feedback: null,
		position: 0,
		retiredAt: null,
		uses: 0,
		updatedAt,
	}) as RubricItem;

test("the grading view carries the version of the rubric, of each item, and of the pass it can revise", () => {
	const rubricAt = new Date(ISO);
	const itemAt = new Date("2026-03-10T10:00:01.000Z");
	const passAt = new Date("2026-03-10T10:00:02.000Z");
	const rubric = {
		base: "0",
		updatedAt: rubricAt,
		items: [item(itemAt)],
	} as Rubric;
	const answer = (grader: string): CountingAnswer =>
		({
			submission: `s-${grader}`,
			state: "graded",
			passes: [
				{
					grader,
					willNotGrade: false,
					ref: "web-1",
					updatedAt: passAt,
				},
			],
		}) as CountingAnswer;

	const state = graderState([answer("ada"), answer("bob")], rubric, "ada");

	expect(state.updatedAt).toBe(ISO);
	expect(state.items[0]?.updatedAt).toBe(itemAt.toISOString());
	const mine = state.answers.find((entry) => entry.submission === "s-ada");
	const theirs = state.answers.find((entry) => entry.submission === "s-bob");
	expect(mine?.ref).toBe("web-1");
	expect(mine?.updatedAt).toBe(passAt.toISOString());
	expect(theirs?.ref).toBeNull();
	expect(theirs?.updatedAt).toBeNull();
});

test("an initial rubric and its items have no version yet", () => {
	const rubric = { base: "0", updatedAt: null, items: [item(null)] } as Rubric;
	expect(graderState([], rubric, "ada").updatedAt).toBeNull();
	expect(toGraderItem(item(null)).updatedAt).toBeNull();
});
