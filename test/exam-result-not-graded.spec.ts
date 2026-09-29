import { expect, test } from "@playwright/test";
import type { Exam } from "@/db";
import type { Submission } from "@/db/services/submission.service";
import {
	type ExamResult,
	examResult,
	formatScore,
	type QuestionOutcome,
} from "@/services/exam-result";
import { gradeReleaseBlocker } from "@/services/exam-state";
import { instructorHome, type TaughtExam } from "@/services/instructor-home";
import type { HomeCourse } from "@/services/student-home";

const MINUTE = 60_000;

const T0 = new Date("2026-03-10T10:00:00Z");

/// `T0` shifted by `minutes`, so "later" reads as a bigger number.
function at(minutes: number): Date {
	return new Date(T0.getTime() + minutes * MINUTE);
}

/// Long after everything in the fixtures.
const NOW = at(10_000);

function submission(
	publicId: string,
	question: string,
	minutes: number,
	status?: Submission["status"],
) {
	return {
		publicId,
		question,
		createdAt: at(minutes),
		...(status ? { status } : {}),
	};
}

function feedback(
	submissionId: string,
	score: string,
	minutes: number,
	text: string | null = null,
) {
	return {
		submission: submissionId,
		score,
		feedback: text,
		updatedAt: at(minutes),
	};
}

//
// examResult: a will-not-grade answer
//

test("examResult: a will-not-grade submission with no pass is not-graded with a null score", () => {
	const result = examResult(
		["q1"],
		[submission("s1", "q1", 0, "WILL_NOT_GRADE")],
		[],
	);

	expect(result.questions).toEqual([
		{ question: "q1", status: "not-graded", score: null, comments: [] },
	]);
});

test("examResult: a will-not-grade submission stays not-graded with passes on it, and keeps their comments newest first", () => {
	const result = examResult(
		["q1"],
		[submission("s1", "q1", 0, "WILL_NOT_GRADE")],
		[
			feedback("s1", "1", 5, "First look"),
			feedback("s1", "0", 30, "Submitted empty"),
			feedback("s1", "0.5", 10, null),
			feedback("s1", "0.5", 15, ""),
		],
	);

	expect(result.questions).toEqual([
		{
			question: "q1",
			status: "not-graded",
			score: null,
			comments: ["Submitted empty", "First look"],
		},
	]);
});

test("examResult: a not-graded answer is never pending and never zero", () => {
	const result = examResult(
		["q1"],
		[submission("s1", "q1", 0, "WILL_NOT_GRADE")],
		[feedback("s1", "0", 5)],
	);

	expect(result.questions[0]?.status).not.toBe("pending");
	expect(result.questions[0]?.status).not.toBe("graded");
	expect(result.questions[0]?.score).toBeNull();
});

//
// examResult: the total
//

test("examResult: two answers graded 100% and a third will-not-grade total 2/3, not null", () => {
	const result = examResult(
		["q1", "q2", "q3"],
		[
			submission("s1", "q1", 0),
			submission("s2", "q2", 1),
			submission("s3", "q3", 2, "WILL_NOT_GRADE"),
		],
		[feedback("s1", "1", 10), feedback("s2", "1", 11)],
	);

	expect(result.total).not.toBeNull();
	expect(result.total).toBeCloseTo(2 / 3, 10);
	expect(formatScore(result.total ?? 0)).toBe("67%");
});

test("examResult: a will-not-grade answer alone totals zero, not null", () => {
	const result = examResult(
		["q1"],
		[submission("s1", "q1", 0, "WILL_NOT_GRADE")],
		[],
	);

	expect(result.total).toBe(0);
});

test("examResult: a pending answer next to a will-not-grade one still makes the total null", () => {
	const result = examResult(
		["q1", "q2"],
		[submission("s1", "q1", 0, "WILL_NOT_GRADE"), submission("s2", "q2", 1)],
		[],
	);

	expect(result.total).toBeNull();
});

//
// examResult: only the counting submission's status matters
//

test("examResult: an older will-not-grade submission followed by a newer ungraded one is pending", () => {
	const result = examResult(
		["q1"],
		[
			submission("old", "q1", 0, "WILL_NOT_GRADE"),
			submission("new", "q1", 10, "PENDING_GRADE"),
		],
		[],
	);

	expect(result.questions[0]).toMatchObject({
		status: "pending",
		score: null,
	});
});

test("examResult: an older ungraded submission followed by a newer will-not-grade one is not-graded", () => {
	const result = examResult(
		["q1"],
		[
			submission("old", "q1", 0, "PENDING_GRADE"),
			submission("new", "q1", 10, "WILL_NOT_GRADE"),
		],
		[feedback("old", "1", 20)],
	);

	expect(result.questions[0]).toMatchObject({
		status: "not-graded",
		score: null,
	});
});

test("examResult: the newest submission counts whatever order they arrive in, for the status too", () => {
	const result = examResult(
		["q1"],
		[
			submission("new", "q1", 10, "WILL_NOT_GRADE"),
			submission("old", "q1", 0, "PENDING_GRADE"),
		],
		[],
	);

	expect(result.questions[0]?.status).toBe("not-graded");
});

//
// examResult: other statuses behave as before
//

const otherStatuses: Array<Submission["status"] | undefined> = [
	undefined,
	"PENDING_GRADE",
	"GRADED_MANUALLY",
	"GRADED_AUTOMATICALLY",
];

for (const status of otherStatuses) {
	test(`examResult: a submission with status ${status ?? "missing"} and no pass is pending`, () => {
		const result = examResult(["q1"], [submission("s1", "q1", 0, status)], []);

		expect(result.questions).toEqual([
			{ question: "q1", status: "pending", score: null, comments: [] },
		]);
	});

	test(`examResult: a submission with status ${status ?? "missing"} and a pass is graded with its score`, () => {
		const result = examResult(
			["q1"],
			[submission("s1", "q1", 0, status)],
			[feedback("s1", "3/4", 5, "Good")],
		);

		expect(result.questions).toEqual([
			{ question: "q1", status: "graded", score: 0.75, comments: ["Good"] },
		]);
	});
}

//
// gradeReleaseBlocker
//

function closedExam(overrides: Partial<Exam> = {}): Exam {
	return {
		id: 1 as Exam["id"],
		slug: "final",
		type: "EXAM",
		status: "COMPLETED",
		title: "Final",
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
		createdAt: at(-1000),
		updatedAt: at(-1000),
		...overrides,
	};
}

function outcome(status: QuestionOutcome["status"]): QuestionOutcome {
	return {
		question: "q",
		status,
		score: status === "graded" ? 1 : null,
		comments: [],
	};
}

function resultOf(...statuses: QuestionOutcome["status"][]): ExamResult {
	return { questions: statuses.map(outcome), total: null };
}

test("gradeReleaseBlocker: a closed, unreleased EXAM whose only unresolved answers are not-graded may be released", () => {
	const blocker = gradeReleaseBlocker(
		closedExam(),
		[resultOf("graded", "not-graded"), resultOf("not-graded", "graded")],
		NOW,
	);

	expect(blocker).toBeNull();
});

test("gradeReleaseBlocker: a pending answer still blocks, next to not-graded ones", () => {
	const blocker = gradeReleaseBlocker(
		closedExam(),
		[resultOf("not-graded", "graded"), resultOf("not-graded", "pending")],
		NOW,
	);

	expect(blocker).toBe("pending");
});

//
// instructorHome
//

const algebra: HomeCourse = {
	href: "/mat101/ada_2026-1",
	code: "mat101",
	name: "Algebra",
};

function taughtWith(...results: ExamResult[]): TaughtExam {
	return {
		course: algebra,
		exam: closedExam(),
		enrolled: 10,
		attempts: results.map((result) => ({
			attempt: { createdAt: at(-30), acceptingSubmissions: false },
			result,
		})),
	};
}

test("instructorHome: a closed attempt with one pending and one not-graded answer counts 1 in toGrade", () => {
	const item = taughtWith(resultOf("pending", "not-graded"));

	const home = instructorHome([item], [], NOW);

	expect(home.toGrade).toEqual([
		{ course: algebra, exam: item.exam, pending: 1 },
	]);
});

test("instructorHome: an exam with only graded and not-graded answers is not in toGrade", () => {
	const home = instructorHome(
		[taughtWith(resultOf("graded", "not-graded"), resultOf("not-graded"))],
		[],
		NOW,
	);

	expect(home.toGrade).toEqual([]);
});

test("instructorHome: an exam whose only unresolved answers are not-graded is ready to release", () => {
	const item = taughtWith(resultOf("graded", "not-graded"));

	const home = instructorHome([item], [], NOW);

	expect(home.toRelease).toEqual([
		{ course: algebra, exam: item.exam, attempts: 1 },
	]);
});
