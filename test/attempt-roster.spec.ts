import { expect, test } from "@playwright/test";
import type { QuestionOutcome } from "@/services/exam-result";
import {
	type AttemptRow,
	attemptRoster,
	type GradedStudent,
	type QuestionMark,
	questionMark,
} from "@/services/grading";

type Student = GradedStudent & { schoolId: string | null };

/// A student of the course, active and with a registration unless `overrides` say otherwise.
function student(username: string, overrides: Partial<Student> = {}): Student {
	return {
		username,
		name: username,
		dropped: false,
		schoolId: `reg-${username}`,
		...overrides,
	};
}

/// An attempt row that may carry who created the attempt, which only an instructor's empty attempt has.
type RowWithCreator = AttemptRow & { createdBy?: string | null };

/// The attempt of `author`: closed, nothing pending, graded 80%, unless `overrides` say otherwise.
function row(
	author: string,
	overrides: Partial<RowWithCreator> = {},
): RowWithCreator {
	return {
		author,
		name: author,
		dropped: false,
		state: "submitted",
		answered: 4,
		questions: 4,
		pending: 0,
		total: 0.8,
		startedAt: new Date("2026-03-10T10:00:00Z"),
		...overrides,
	};
}

const NOBODY: ReadonlySet<string> = new Set();

test.describe("attemptRoster", () => {
	test("a student without an attempt is `none`, with no total", () => {
		expect(attemptRoster([student("ana")], [], NOBODY)).toEqual([
			{
				username: "ana",
				name: "ana",
				schoolId: "reg-ana",
				total: null,
				status: "none",
			},
		]);
	});

	test("an open attempt is `in-progress` with no total", () => {
		const rows = [row("ana", { state: "in-progress", total: null })];

		const [ana] = attemptRoster([student("ana")], rows, NOBODY);

		expect(ana).toMatchObject({ status: "in-progress", total: null });
	});

	test("a closed attempt with an answer waiting for a grade is `pending`", () => {
		const rows = [row("ana", { pending: 2, total: null })];

		const [ana] = attemptRoster([student("ana")], rows, NOBODY);

		expect(ana).toMatchObject({ status: "pending", total: null });
	});

	test("a closed attempt with nothing special is `submitted` and carries its total", () => {
		const [ana] = attemptRoster([student("ana")], [row("ana")], NOBODY);

		expect(ana).toMatchObject({ status: "submitted", total: 0.8 });
	});

	test("a student in the adjusted set is `adjusted` and keeps the total of the row", () => {
		const rows = [row("ana", { total: 0.6 })];

		const [ana] = attemptRoster([student("ana")], rows, new Set(["ana"]));

		expect(ana).toMatchObject({ status: "adjusted", total: 0.6 });
	});

	test("only the students in the adjusted set are `adjusted`", () => {
		const students = [student("ana"), student("bia")];
		const rows = [row("ana"), row("bia")];

		const result = attemptRoster(students, rows, new Set(["bia"]));

		expect(result.map((r) => [r.username, r.status])).toEqual([
			["ana", "submitted"],
			["bia", "adjusted"],
		]);
	});

	test("a pending answer outranks an adjustment, and an open attempt outranks both", () => {
		const students = [student("ana"), student("bia")];
		const rows = [
			row("ana", { pending: 1, total: null }),
			row("bia", { state: "in-progress", total: null, pending: 0 }),
		];

		const result = attemptRoster(students, rows, new Set(["ana", "bia"]));

		expect(result.map((r) => [r.username, r.status])).toEqual([
			["ana", "pending"],
			["bia", "in-progress"],
		]);
	});

	test("the five situations side by side", () => {
		const students = [
			student("a-none"),
			student("b-open"),
			student("c-pending"),
			student("d-adjusted"),
			student("e-done"),
		];
		const rows = [
			row("b-open", { state: "in-progress", total: null }),
			row("c-pending", { pending: 1, total: null }),
			row("d-adjusted"),
			row("e-done"),
		];

		const result = attemptRoster(students, rows, new Set(["d-adjusted"]));

		expect(result.map((r) => r.status)).toEqual([
			"none",
			"in-progress",
			"pending",
			"adjusted",
			"submitted",
		]);
	});

	test("rows come sorted by name, without regard to case, ties by username", () => {
		const students = [
			student("u3", { name: "bruno" }),
			student("u2", { name: "Ana" }),
			student("u1", { name: "ana" }),
			student("u4", { name: "Caio" }),
		];

		const result = attemptRoster(students, [], NOBODY);

		expect(result.map((r) => r.username)).toEqual(["u1", "u2", "u3", "u4"]);
	});

	test("the schoolId is carried, and a student without one gets null", () => {
		const students = [
			student("ana", { schoolId: "20260042" }),
			student("bia", { schoolId: null }),
		];

		const result = attemptRoster(students, [], NOBODY);

		expect(result.map((r) => r.schoolId)).toEqual(["20260042", null]);
	});

	test("the name comes from the student, not from the attempt row", () => {
		const students = [student("ana", { name: "Ana Prado" })];
		const rows = [row("ana", { name: "someone else" })];

		const [ana] = attemptRoster(students, rows, NOBODY);

		expect(ana?.name).toBe("Ana Prado");
	});

	test("a student who dropped the course is not listed", () => {
		const students = [student("ana"), student("bia", { dropped: true })];
		const rows = [row("ana"), row("bia")];

		const result = attemptRoster(students, rows, NOBODY);

		expect(result.map((r) => r.username)).toEqual(["ana"]);
	});

	test("an empty attempt the instructor created, with no active adjustment, is `none`", () => {
		const rows = [
			row("ana", { createdBy: "prof", answered: 0, total: 0, pending: 0 }),
		];

		const [ana] = attemptRoster([student("ana")], rows, NOBODY);

		expect(ana?.status).toBe("none");
	});

	test("an empty attempt the instructor created, with an active adjustment, is `adjusted`", () => {
		const rows = [
			row("ana", { createdBy: "prof", answered: 0, total: 0.7, pending: 0 }),
		];

		const [ana] = attemptRoster([student("ana")], rows, new Set(["ana"]));

		expect(ana).toMatchObject({ status: "adjusted", total: 0.7 });
	});

	test("an attempt the student made, with no answer and no adjustment, is still `submitted`", () => {
		const rows = [row("ana", { createdBy: null, answered: 0, total: 0 })];

		const [ana] = attemptRoster([student("ana")], rows, NOBODY);

		expect(ana?.status).toBe("submitted");
	});

	test("an empty class has an empty roster", () => {
		expect(attemptRoster([], [], NOBODY)).toEqual([]);
	});
});

/// An outcome of the question `q1`, graded with `score` unless `overrides` say otherwise.
function outcome(overrides: Partial<QuestionOutcome> = {}): QuestionOutcome {
	return {
		question: "q1",
		submission: "sub-1",
		status: "graded",
		score: 1,
		comments: [],
		...overrides,
	};
}

test.describe("questionMark", () => {
	const cases: [string, QuestionOutcome, unknown, boolean, QuestionMark][] = [
		["full score is correct", outcome({ score: 1 }), "a", false, "correct"],
		[
			"a score between 0 and 1 is partial",
			outcome({ score: 0.5 }),
			"a",
			false,
			"partial",
		],
		[
			"the smallest positive score is partial",
			outcome({ score: 0.01 }),
			"a",
			false,
			"partial",
		],
		["zero is wrong", outcome({ score: 0 }), "a", false, "wrong"],
		[
			"a negative score is wrong",
			outcome({ score: -0.5 }),
			"a",
			false,
			"wrong",
		],
		[
			"no counting submission is blank",
			outcome({ status: "unanswered", score: 0, submission: undefined }),
			undefined,
			false,
			"blank",
		],
		[
			"a null payload is blank, even graded",
			outcome({ score: 1 }),
			null,
			false,
			"blank",
		],
		["a changed grade is changed", outcome({ score: 1 }), "a", true, "changed"],
		[
			"changed wins over blank",
			outcome({ status: "graded", score: 1 }),
			null,
			true,
			"changed",
		],
		[
			"changed wins over a failing score",
			outcome({ score: 0 }),
			"a",
			true,
			"changed",
		],
		[
			"an answer waiting for a grade is pending",
			outcome({ status: "pending", score: null }),
			"a",
			false,
			"pending",
		],
		[
			"an answer marked will-not-grade is not-graded",
			outcome({ status: "not-graded", score: null }),
			"a",
			false,
			"not-graded",
		],
		[
			"a sanctioned question reads by its reduced score: partial",
			outcome({ status: "sanctioned", score: 0.5 }),
			"a",
			false,
			"partial",
		],
		[
			"a sanctioned question zeroed is wrong",
			outcome({ status: "sanctioned", score: 0 }),
			"a",
			false,
			"wrong",
		],
	];

	for (const [title, result, payload, changed, expected] of cases) {
		test(title, () => {
			expect(questionMark(result, payload, changed)).toBe(expected);
		});
	}

	test("all seven states are reachable", () => {
		const reached = new Set(cases.map((c) => c[4]));
		expect([...reached].sort()).toEqual(
			[
				"blank",
				"changed",
				"correct",
				"not-graded",
				"partial",
				"pending",
				"wrong",
			].sort(),
		);
	});
});
