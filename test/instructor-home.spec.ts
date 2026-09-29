import { expect, test } from "@playwright/test";
import type { Exam } from "@/db";
import type { ExamResult, QuestionOutcome } from "@/services/exam-result";
import { instructorHome, type TaughtExam } from "@/services/instructor-home";
import type { HomeCourse } from "@/services/student-home";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const NOW = new Date("2026-03-10T14:00:00Z");

function at(ms: number): Date {
	return new Date(NOW.getTime() + ms);
}

const algebra: HomeCourse = {
	href: "/mat101/ada_2026-1",
	code: "mat101",
	name: "Algebra",
};
const compilers: HomeCourse = {
	href: "/cs301/ada_2026-1",
	code: "cs301",
	name: "Compilers",
};

let nextId = 1;

function exam(overrides: Partial<Exam> = {}): Exam {
	const id = nextId++;
	return {
		id: id as Exam["id"],
		slug: `exam-${id}`,
		type: "EXAM",
		status: "SCHEDULED",
		title: `Exam ${id}`,
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
		questions: [],
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

/// Open now: scheduled 10 minutes ago, 60 minutes long, so it closes at `NOW + 50m`.
function openExam(overrides: Partial<Exam> = {}): Exam {
	return exam({
		scheduledAt: at(-10 * MINUTE),
		duration: { minutes: 60 },
		...overrides,
	});
}

/// Closed a while ago.
function closedExam(overrides: Partial<Exam> = {}): Exam {
	return exam({ status: "COMPLETED", ...overrides });
}

function outcome(status: QuestionOutcome["status"]): QuestionOutcome {
	return {
		question: "q",
		status,
		score: status === "graded" ? 1 : null,
		comments: [],
	};
}

/// A result with `pending` ungraded answers and `graded` graded ones.
function result(pending: number, graded = 1): ExamResult {
	return {
		questions: [
			...Array.from({ length: graded }, () => outcome("graded")),
			...Array.from({ length: pending }, () => outcome("pending")),
			outcome("unanswered"),
		],
		total: pending > 0 ? null : 1,
	};
}

/// An attempt still being answered.
function working(pending = 0): TaughtExam["attempts"][number] {
	return {
		attempt: { createdAt: at(-5 * MINUTE), acceptingSubmissions: true },
		result: result(pending),
	};
}

/// An attempt the student closed.
function done(pending = 0): TaughtExam["attempts"][number] {
	return {
		attempt: { createdAt: at(-30 * MINUTE), acceptingSubmissions: false },
		result: result(pending),
	};
}

function taught(
	e: Exam,
	attempts: TaughtExam["attempts"] = [],
	extra: Partial<Omit<TaughtExam, "exam" | "attempts">> = {},
): TaughtExam {
	return { course: algebra, exam: e, enrolled: 10, attempts, ...extra };
}

const titles = (items: { exam: Exam }[]) => items.map((i) => i.exam.title);

test("instructorHome: nothing at all yields four empty sections", () => {
	expect(instructorHome([], [], NOW)).toEqual({
		inProgress: [],
		toGrade: [],
		toRelease: [],
		problems: [],
	});
});

//
// inProgress
//

test("inProgress: an open exam counts attempts still being answered and attempts closed", () => {
	const midterm = openExam({ title: "Midterm" });

	const home = instructorHome(
		[
			taught(midterm, [working(), working(), done()], {
				enrolled: 5,
			}),
		],
		[],
		NOW,
	);

	expect(home.inProgress).toEqual([
		{
			course: algebra,
			exam: midterm,
			started: 2,
			submitted: 1,
			enrolled: 5,
			closesAt: at(50 * MINUTE),
		},
	]);
});

test("inProgress: closesAt includes extra time", () => {
	const midterm = openExam({ extraTime: { minutes: 15 } });

	const home = instructorHome([taught(midterm)], [], NOW);

	expect(home.inProgress[0]?.closesAt).toEqual(at(65 * MINUTE));
});

test("inProgress: an open exam nobody started is listed with zero counts", () => {
	const home = instructorHome(
		[taught(openExam(), [], { enrolled: 8 })],
		[],
		NOW,
	);

	expect(home.inProgress).toHaveLength(1);
	expect(home.inProgress[0]).toMatchObject({
		started: 0,
		submitted: 0,
		enrolled: 8,
	});
});

test("inProgress: an attempt past its own deadline counts as submitted", () => {
	const takeHome = exam({ status: "ONGOING", duration: { minutes: 30 } });
	const stale = {
		attempt: { createdAt: at(-40 * MINUTE), acceptingSubmissions: true },
		result: result(0),
	};

	const home = instructorHome([taught(takeHome, [stale, working()])], [], NOW);

	expect(home.inProgress[0]).toMatchObject({ started: 1, submitted: 1 });
});

test("inProgress: a closed attempt whose grades were released still counts as submitted", () => {
	const released = openExam({ gradesReleasedAt: at(-HOUR) });

	const home = instructorHome([taught(released, [done(), working()])], [], NOW);

	expect(home.inProgress[0]).toMatchObject({ started: 1, submitted: 1 });
});

test("inProgress: an exam without a window has a null closesAt and comes last", () => {
	const open = exam({ status: "ONGOING", title: "No limit" });
	const late = openExam({ title: "Late", duration: { minutes: 180 } });
	const soon = openExam({ title: "Soon", duration: { minutes: 30 } });

	const home = instructorHome(
		[taught(open), taught(late), taught(soon)],
		[],
		NOW,
	);

	expect(titles(home.inProgress)).toEqual(["Soon", "Late", "No limit"]);
	expect(home.inProgress[2]?.closesAt).toBeNull();
});

test("inProgress: exams of several courses mix and keep their course", () => {
	const a = openExam({ title: "A", duration: { minutes: 120 } });
	const b = openExam({ title: "B", duration: { minutes: 30 } });

	const home = instructorHome(
		[taught(a), taught(b, [], { course: compilers })],
		[],
		NOW,
	);

	expect(home.inProgress.map((i) => [i.exam.title, i.course.code])).toEqual([
		["B", "cs301"],
		["A", "mat101"],
	]);
});

test("inProgress: PRACTICE, closed and upcoming exams are left out", () => {
	const home = instructorHome(
		[
			taught(openExam({ type: "PRACTICE" })),
			taught(closedExam()),
			taught(exam({ scheduledAt: at(2 * DAY) })),
		],
		[],
		NOW,
	);

	expect(home.inProgress).toEqual([]);
});

//
// toGrade
//

test("toGrade: sums pending answers over the closed attempts of an exam", () => {
	const quiz = closedExam({ title: "Midterm" });

	const home = instructorHome(
		[taught(quiz, [done(2), done(1), done(0)])],
		[],
		NOW,
	);

	expect(home.toGrade).toEqual([{ course: algebra, exam: quiz, pending: 3 }]);
});

test("toGrade: only pending answers count, not unanswered ones", () => {
	const quiz = closedExam();
	const blank: TaughtExam["attempts"][number] = {
		attempt: { createdAt: at(-DAY), acceptingSubmissions: false },
		result: {
			questions: [outcome("unanswered"), outcome("unanswered")],
			total: 0,
		},
	};

	const home = instructorHome([taught(quiz, [blank])], [], NOW);

	expect(home.toGrade).toEqual([]);
});

test("toGrade: answers of attempts still in progress are not grading work", () => {
	const midterm = openExam({ title: "Midterm" });

	const home = instructorHome(
		[taught(midterm, [done(2), working(5)])],
		[],
		NOW,
	);

	expect(home.toGrade).toEqual([
		{ course: algebra, exam: midterm, pending: 2 },
	]);
});

test("toGrade: an exam whose only pending answers are in progress is not listed", () => {
	const home = instructorHome(
		[taught(openExam(), [working(4), done(0)])],
		[],
		NOW,
	);

	expect(home.toGrade).toEqual([]);
});

test("toGrade: an exam with closed attempts and nothing pending is not listed", () => {
	const home = instructorHome(
		[taught(closedExam(), [done(0), done(0)])],
		[],
		NOW,
	);

	expect(home.toGrade).toEqual([]);
});

test("toGrade: most pending first", () => {
	const few = closedExam({ title: "Few" });
	const many = closedExam({ title: "Many" });
	const some = closedExam({ title: "Some" });

	const home = instructorHome(
		[taught(few, [done(1)]), taught(many, [done(9)]), taught(some, [done(4)])],
		[],
		NOW,
	);

	expect(titles(home.toGrade)).toEqual(["Many", "Some", "Few"]);
});

//
// toRelease
//

test("toRelease: a closed EXAM with attempts and nothing pending is ready, with its attempt count", () => {
	const final = closedExam({ title: "Final" });

	const home = instructorHome([taught(final, [done(0), done(0)])], [], NOW);

	expect(home.toRelease).toEqual([
		{ course: algebra, exam: final, attempts: 2 },
	]);
});

test("toRelease: a window that has ended counts as closed", () => {
	const ended = exam({
		title: "Ended",
		scheduledAt: at(-5 * HOUR),
		duration: { hours: 1 },
	});

	const home = instructorHome([taught(ended, [done(0)])], [], NOW);

	expect(titles(home.toRelease)).toEqual(["Ended"]);
});

test("toRelease: an exam with a pending answer is not ready", () => {
	const home = instructorHome(
		[taught(closedExam(), [done(0), done(1)])],
		[],
		NOW,
	);

	expect(home.toRelease).toEqual([]);
});

test("toRelease: an exam already released is not listed", () => {
	const released = closedExam({ gradesReleasedAt: at(-DAY) });

	const home = instructorHome([taught(released, [done(0)])], [], NOW);

	expect(home.toRelease).toEqual([]);
});

test("toRelease: an exam with no attempts is not listed", () => {
	const home = instructorHome([taught(closedExam(), [])], [], NOW);

	expect(home.toRelease).toEqual([]);
});

test("toRelease: an exam still open or upcoming is not listed", () => {
	const home = instructorHome(
		[
			taught(openExam(), [done(0)]),
			taught(exam({ scheduledAt: at(DAY) }), [done(0)]),
		],
		[],
		NOW,
	);

	expect(home.toRelease).toEqual([]);
});

test("toRelease: QUIZ and PRACTICE exams release on their own", () => {
	const home = instructorHome(
		[
			taught(closedExam({ type: "QUIZ" }), [done(0)]),
			taught(closedExam({ type: "PRACTICE" }), [done(0)]),
		],
		[],
		NOW,
	);

	expect(home.toRelease).toEqual([]);
});

test("toRelease: keeps the input order", () => {
	const first = closedExam({ title: "First" });
	const second = closedExam({ title: "Second" });
	const third = closedExam({ title: "Third" });

	const home = instructorHome(
		[
			taught(first, [done(0)]),
			taught(second, [done(0), done(0)]),
			taught(third, [done(0)]),
		],
		[],
		NOW,
	);

	expect(titles(home.toRelease)).toEqual(["First", "Second", "Third"]);
});

//
// problems
//

test("problems: courses with question problems, in input order, with their counts", () => {
	const home = instructorHome(
		[],
		[
			{ course: compilers, questionsWithProblems: 3 },
			{ course: algebra, questionsWithProblems: 0 },
			{ course: { ...algebra, code: "phy201" }, questionsWithProblems: 1 },
		],
		NOW,
	);

	expect(home.problems).toEqual([
		{ course: compilers, questions: 3 },
		{ course: { ...algebra, code: "phy201" }, questions: 1 },
	]);
});

test("problems: a course with a clean question bank is not listed", () => {
	const home = instructorHome(
		[],
		[{ course: algebra, questionsWithProblems: 0 }],
		NOW,
	);

	expect(home.problems).toEqual([]);
});

//
// Draft and archived
//

test("draft and archived exams appear in no section", () => {
	const hidden = (["DRAFT", "ARCHIVED"] as const).flatMap((status) => [
		// Would be in progress
		taught(openExam({ status }), [working(), done()]),
		// Would need grading and releasing
		taught(closedExam({ status }), [done(2)]),
		taught(closedExam({ status }), [done(0)]),
	]);

	const home = instructorHome(hidden, [], NOW);

	expect(home.inProgress).toEqual([]);
	expect(home.toGrade).toEqual([]);
	expect(home.toRelease).toEqual([]);
});
