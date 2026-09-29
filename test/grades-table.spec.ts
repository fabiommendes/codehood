import { expect, test } from "@playwright/test";
import fc from "fast-check";
import type { Exam } from "@/db";
import {
	type GradeCell,
	gradesTable,
	type TableAttempt,
} from "@/services/grades-table";
import type { GradedStudent, GradingFeedback } from "@/services/grading";

const MINUTE = 60_000;

const T0 = new Date("2026-03-10T10:00:00Z");

/// `T0` shifted by `minutes`, so "later" reads as a bigger number.
function at(minutes: number): Date {
	return new Date(T0.getTime() + minutes * MINUTE);
}

/// The clock every case reads.
const NOW = at(10_000);

let nextId = 1;

/// An exam of the given slug; closed (`COMPLETED`) unless overridden, with questions `q1` and `q2`.
function exam(slug: string, overrides: Partial<Exam> = {}): Exam {
	const id = nextId++;
	return {
		id: id as Exam["id"],
		slug,
		type: "EXAM",
		status: "COMPLETED",
		title: slug,
		description: null,
		preamble: null,
		format: "PLAINTEXT",
		scheduledAt: null,
		duration: null,
		extraTime: null,
		gradesReleasedAt: null,
		author: "instructor",
		rev: null,
		tags: [],
		questions: [
			{ id: 1 as never, slug: "q1", version: null },
			{ id: 2 as never, slug: "q2", version: null },
		],
		createdAt: at(-1000),
		updatedAt: at(-1000),
		...overrides,
	};
}

/// An exam with a single question `q1`.
function single(slug: string, overrides: Partial<Exam> = {}): Exam {
	return exam(slug, {
		questions: [{ id: 1 as never, slug: "q1", version: null }],
		...overrides,
	});
}

function student(username: string, name: string, dropped = false) {
	return { username, name, dropped } satisfies GradedStudent;
}

type SubmissionRow = TableAttempt["submissions"][number];

function submission(
	publicId: string,
	question: string,
	overrides: Partial<SubmissionRow> = {},
): SubmissionRow {
	return {
		id: 1 as SubmissionRow["id"],
		publicId,
		responseId: 1 as SubmissionRow["responseId"],
		questionId: 1 as SubmissionRow["questionId"],
		response: "response-1",
		question,
		status: "PENDING_GRADE",
		automaticallyTriggered: false,
		payload: {},
		startedAt: null,
		createdAt: at(5),
		...overrides,
	};
}

function pass(submissionId: string, score: string): GradingFeedback {
	return {
		submission: submissionId,
		score,
		feedback: null,
		grader: "teacher",
		bot: null,
		updatedAt: at(50),
	};
}

/// One student's answers to an exam: a score string, `null` for pending, or `"wng"` for will-not-grade.
type Answers = Record<string, string | null>;

/// The attempt and grading passes of `author`'s answers to exam `slug`.
function sat(
	slug: string,
	author: string,
	answers: Answers,
	options: { open?: boolean } = {},
): { attempt: TableAttempt; feedback: GradingFeedback[] } {
	const feedback: GradingFeedback[] = [];
	const submissions = Object.entries(answers).map(([question, score]) => {
		const publicId = `${slug}-${author}-${question}`;
		if (score === "wng") {
			return submission(publicId, question, { status: "WILL_NOT_GRADE" });
		}
		if (score !== null) feedback.push(pass(publicId, score));
		return submission(publicId, question);
	});
	return {
		attempt: {
			exam: slug,
			author,
			createdAt: at(-30),
			acceptingSubmissions: options.open ?? false,
			submissions,
		},
		feedback,
	};
}

/// Builds a table from exams, students and the sittings of the given attempts.
function tableOf(
	exams: Exam[],
	students: GradedStudent[],
	sittings: ReturnType<typeof sat>[] = [],
	now = NOW,
) {
	return gradesTable(
		exams,
		students,
		sittings.map((s) => s.attempt),
		sittings.flatMap((s) => s.feedback),
		now,
	);
}

const ana = student("ana", "Ana");

//
// Columns
//

test("gradesTable: the columns are the EXAM and QUIZ exams and no other", () => {
	const table = tableOf(
		[
			single("exam"),
			single("quiz", { type: "QUIZ" }),
			single("drill", { type: "PRACTICE", status: "ONGOING" }),
		],
		[ana],
	);

	expect(table.columns.map((c) => c.exam.slug).sort()).toEqual([
		"exam",
		"quiz",
	]);
});

test("gradesTable: draft and archived exams have no column", () => {
	const table = tableOf(
		[
			single("shown"),
			single("hidden-draft", { status: "DRAFT" }),
			single("hidden-archived", { status: "ARCHIVED" }),
		],
		[ana],
	);

	expect(table.columns.map((c) => c.exam.slug)).toEqual(["shown"]);
});

test("gradesTable: columns go by scheduled date, unscheduled last, ties by title", () => {
	const table = tableOf(
		[
			single("z", { title: "Zeta", scheduledAt: at(300) }),
			single("none-b", { title: "Beta", scheduledAt: null }),
			single("a", { title: "Alpha", scheduledAt: at(100) }),
			single("none-a", { title: "Alpha", scheduledAt: null }),
			single("tie-b", { title: "Bravo", scheduledAt: at(200) }),
			single("tie-a", { title: "Alfa", scheduledAt: at(200) }),
		],
		[ana],
	);

	expect(table.columns.map((c) => c.exam.slug)).toEqual([
		"a",
		"tie-a",
		"tie-b",
		"z",
		"none-a",
		"none-b",
	]);
});

test("gradesTable: the columns do not depend on the order the exams arrive in", () => {
	const exams = [
		single("z", { title: "Zeta", scheduledAt: at(300) }),
		single("none-b", { title: "Beta", scheduledAt: null }),
		single("a", { title: "Alpha", scheduledAt: at(100) }),
		single("none-a", { title: "Alpha", scheduledAt: null }),
		single("tie-b", { title: "Bravo", scheduledAt: at(200) }),
		single("tie-a", { title: "Alfa", scheduledAt: at(200) }),
	];
	const expected = tableOf(exams, [ana]).columns.map((c) => c.exam.slug);

	fc.assert(
		fc.property(
			fc.shuffledSubarray(exams, {
				minLength: exams.length,
				maxLength: exams.length,
			}),
			(shuffled) => {
				expect(
					tableOf(shuffled, [ana]).columns.map((c) => c.exam.slug),
				).toEqual(expected);
			},
		),
	);
});

//
// Rows
//

test("gradesTable: rows are the students who did not drop, by name without regard to case, ties by username", () => {
	const table = tableOf(
		[single("e1")],
		[
			student("u1", "carla"),
			student("u2", "Bruno"),
			student("u3", "adam"),
			student("u5", "Sam"),
			student("u4", "sam"),
			student("u6", "Dropped Dan", true),
		],
	);

	expect(table.rows.map((r) => r.username)).toEqual([
		"u3",
		"u2",
		"u1",
		"u4",
		"u5",
	]);
	expect(table.rows[0]?.name).toBe("adam");
});

test("gradesTable: a dropped student's attempt counts in no column's numbers", () => {
	const table = tableOf(
		[single("e1")],
		[student("a", "A"), student("x", "Dropped", true)],
		[sat("e1", "a", { q1: "0.5" }), sat("e1", "x", { q1: "1" })],
	);

	expect(table.rows.map((r) => r.username)).toEqual(["a"]);
	expect(table.columns[0]).toMatchObject({
		attempted: 1,
		students: 1,
	});
	expect(table.columns[0]?.mean).toBeCloseTo(0.5, 10);
});

test("gradesTable: an attempt of a student the table does not list counts nowhere", () => {
	const table = tableOf(
		[single("e1")],
		[student("a", "A")],
		[sat("e1", "stranger", { q1: "1" })],
	);

	expect(table.columns[0]).toMatchObject({
		attempted: 0,
		students: 1,
		mean: null,
	});
});

//
// Cells
//

function cellsOf(
	exams: Exam[],
	sittings: ReturnType<typeof sat>[],
	now = NOW,
): GradeCell[] {
	return tableOf(exams, [ana], sittings, now).rows[0]?.cells ?? [];
}

test("gradesTable: a closed attempt with every answer graded is a total cell", () => {
	const cells = cellsOf(
		[exam("e1")],
		[sat("e1", "ana", { q1: "1", q2: "1/2" })],
	);

	expect(cells).toHaveLength(1);
	expect(cells[0]?.kind).toBe("total");
	expect(cells[0]).toMatchObject({ kind: "total" });
	expect((cells[0] as { total: number }).total).toBeCloseTo(0.75, 10);
});

test("gradesTable: an unanswered question counts zero in the total", () => {
	const cells = cellsOf([exam("e1")], [sat("e1", "ana", { q1: "1" })]);

	expect(cells[0]?.kind).toBe("total");
	expect((cells[0] as { total: number }).total).toBeCloseTo(0.5, 10);
});

test("gradesTable: a will-not-grade answer counts zero in the total", () => {
	const cells = cellsOf(
		[exam("e1")],
		[sat("e1", "ana", { q1: "1", q2: "wng" })],
	);

	expect(cells[0]?.kind).toBe("total");
	expect((cells[0] as { total: number }).total).toBeCloseTo(0.5, 10);
});

test("gradesTable: a closed attempt with a pending answer is a pending cell", () => {
	const cells = cellsOf(
		[exam("e1")],
		[sat("e1", "ana", { q1: "1", q2: null })],
	);

	expect(cells).toEqual([{ kind: "pending" }]);
});

test("gradesTable: an attempt that still accepts answers on an open exam is an in-progress cell", () => {
	const cells = cellsOf(
		[exam("e1", { status: "ONGOING" })],
		[sat("e1", "ana", { q1: "1" }, { open: true })],
	);

	expect(cells).toEqual([{ kind: "in-progress" }]);
});

test("gradesTable: an attempt of a completed exam is closed even if it still accepts answers", () => {
	const cells = cellsOf(
		[exam("e1")],
		[sat("e1", "ana", { q1: "1", q2: "1" }, { open: true })],
	);

	expect(cells[0]?.kind).toBe("total");
});

test("gradesTable: no attempt at a closed exam is a missed cell", () => {
	expect(cellsOf([exam("e1")], [])).toEqual([{ kind: "missed" }]);
});

test("gradesTable: no attempt at an open or an upcoming exam is an empty cell", () => {
	const cells = cellsOf(
		[
			exam("open", { status: "ONGOING", scheduledAt: at(1) }),
			exam("upcoming", { status: "SCHEDULED", scheduledAt: at(20_000) }),
		],
		[],
	);

	expect(cells).toEqual([{ kind: "empty" }, { kind: "empty" }]);
});

test("gradesTable: every row has one cell per column, in column order", () => {
	const exams = [
		exam("late", { scheduledAt: at(500) }),
		exam("early", { scheduledAt: at(100) }),
		exam("open", { status: "ONGOING", scheduledAt: at(900) }),
	];

	const table = tableOf(
		exams,
		[ana, student("bia", "Bia")],
		[
			sat("early", "ana", { q1: "1", q2: "1" }),
			sat("late", "bia", { q1: null }),
		],
	);

	expect(table.columns.map((c) => c.exam.slug)).toEqual([
		"early",
		"late",
		"open",
	]);
	for (const row of table.rows) expect(row.cells).toHaveLength(3);
	expect(table.rows[0]?.cells.map((c) => c.kind)).toEqual([
		"total",
		"missed",
		"empty",
	]);
	expect(table.rows[1]?.cells.map((c) => c.kind)).toEqual([
		"missed",
		"pending",
		"empty",
	]);
});

//
// Column numbers
//

test("gradesTable: a column's mean is over the total cells, with attempted and students counted separately", () => {
	const table = tableOf(
		[single("e1")],
		[
			student("a", "A"),
			student("b", "B"),
			student("c", "C"),
			student("d", "D"),
		],
		[
			sat("e1", "a", { q1: "0.8" }),
			sat("e1", "b", { q1: "0.6" }),
			sat("e1", "d", { q1: null }),
		],
	);

	expect(table.columns[0]?.mean).toBeCloseTo(0.7, 9);
	expect(table.columns[0]?.attempted).toBe(3);
	expect(table.columns[0]?.students).toBe(4);
	expect(table.rows.map((r) => r.cells[0]?.kind)).toEqual([
		"total",
		"total",
		"missed",
		"pending",
	]);
});

test("gradesTable: an in-progress attempt is counted as attempted but left out of the mean", () => {
	const table = tableOf(
		[single("e1", { status: "ONGOING" })],
		[student("a", "A"), student("b", "B")],
		[sat("e1", "a", { q1: "1" }, { open: true }), sat("e1", "b", { q1: "1" })],
		NOW,
	);

	// A is still answering; B's attempt was closed by its owner.
	expect(table.columns[0]?.attempted).toBe(2);
	expect(table.rows.map((r) => r.cells[0]?.kind)).toEqual([
		"in-progress",
		"total",
	]);
	expect(table.columns[0]?.mean).toBeCloseTo(1, 10);
});

test("gradesTable: a column with only missed, pending and in-progress cells has a null mean", () => {
	const table = tableOf(
		[single("e1")],
		[student("a", "A"), student("b", "B")],
		[sat("e1", "a", { q1: null })],
	);

	expect(table.columns[0]).toMatchObject({
		mean: null,
		attempted: 1,
		students: 2,
	});
});

test("gradesTable: an exam nobody attempted, still upcoming, has attempted zero and no mean", () => {
	const table = tableOf(
		[single("e1", { status: "SCHEDULED", scheduledAt: at(20_000) })],
		[student("a", "A"), student("b", "B")],
	);

	expect(table.columns[0]).toMatchObject({
		mean: null,
		attempted: 0,
		students: 2,
	});
});

//
// Release
//

test("gradesTable: totals are the same whether the exam's grades are released or not", () => {
	const sittings = [sat("e1", "ana", { q1: "3/4", q2: "1/4" })];

	const held = tableOf(
		[exam("e1", { gradesReleasedAt: null })],
		[ana],
		sittings,
	);
	const released = tableOf(
		[exam("e1", { gradesReleasedAt: at(-5) })],
		[ana],
		sittings,
	);

	expect(held.rows[0]?.cells[0]?.kind).toBe("total");
	expect(released.rows).toEqual(held.rows);
	expect(released.columns[0]?.mean).toBe(held.columns[0]?.mean);
});

//
// Empty tables
//

test("gradesTable: no exams leaves no columns, with the students still listed and their cells empty", () => {
	const table = tableOf([], [ana, student("bia", "Bia")]);

	expect(table.columns).toEqual([]);
	expect(table.rows).toEqual([
		{ username: "ana", name: "Ana", cells: [] },
		{ username: "bia", name: "Bia", cells: [] },
	]);
});

test("gradesTable: no students leaves no rows, with every column at zero", () => {
	const table = tableOf([single("e1"), single("e2", { title: "Second" })], []);

	expect(table.rows).toEqual([]);
	expect(table.columns).toHaveLength(2);
	for (const column of table.columns) {
		expect(column).toMatchObject({ students: 0, attempted: 0, mean: null });
	}
});
