import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData } from "@/core/error";
import { REGRADE_WINDOW_DAYS } from "@/core/schemas";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedSubmissionFactory } from "@/fixtures/submission.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import type { QuestionOutcome } from "@/services/exam-result";
import type { ExamTiming, ExceptionTiming } from "@/services/exam-state";
import {
	type RegradeBlocker,
	type RegradeContext,
	regradeBlocker,
	regradeBlockerMessage,
	regradeDeadline,
} from "@/services/regrade";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/// Start of the scheduled window used across the cases.
const START = new Date("2026-03-10T10:00:00Z");

/// When an `EXAM`'s grades were released.
const RELEASED = new Date("2026-03-20T12:00:00Z");

/// The last moment a request on `RELEASED` grades is still on time.
const DEADLINE = new Date(RELEASED.getTime() + REGRADE_WINDOW_DAYS * DAY);

/// Three days after the release: inside the window.
const NOW = new Date(RELEASED.getTime() + 3 * DAY);

function plusMs(date: Date, ms: number): Date {
	return new Date(date.getTime() + ms);
}

/// A completed `EXAM` whose grades were released at `RELEASED`.
function exam(overrides: Partial<ExamTiming> = {}): ExamTiming {
	return {
		type: "EXAM",
		status: "COMPLETED",
		scheduledAt: START,
		duration: { minutes: 90 },
		extraTime: null,
		gradesReleasedAt: RELEASED,
		...overrides,
	};
}

/// A `QUIZ` held by `START` for 90 minutes: its grades come out at 11:30.
function quiz(overrides: Partial<ExamTiming> = {}): ExamTiming {
	return exam({
		type: "QUIZ",
		status: "SCHEDULED",
		gradesReleasedAt: null,
		...overrides,
	});
}

const QUIZ_RELEASE = plusMs(START, 90 * MINUTE);

function outcome(overrides: Partial<QuestionOutcome> = {}): QuestionOutcome {
	return {
		question: "q1",
		submission: "s1",
		status: "graded",
		score: 0.5,
		comments: [],
		...overrides,
	};
}

/// A request that nothing blocks: released exam, counting graded answer, no request yet, inside the window.
function context(overrides: Partial<RegradeContext> = {}): RegradeContext {
	return {
		exam: exam(),
		exceptions: [],
		exception: null,
		attempt: {
			createdAt: plusMs(START, 10 * MINUTE),
			acceptingSubmissions: false,
		},
		outcome: outcome(),
		submission: "s1",
		requested: false,
		...overrides,
	};
}

//
// regradeBlocker
//

test("regradeBlocker: nothing blocks a counting graded answer of released grades inside the window", () => {
	expect(regradeBlocker(context(), NOW)).toBeNull();
});

test("regradeBlocker: a not-graded counting answer may be contested", () => {
	const ctx = context({
		outcome: outcome({ status: "not-graded", score: null }),
	});
	expect(regradeBlocker(ctx, NOW)).toBeNull();
});

test("regradeBlocker: a practice exam has no grade to contest", () => {
	const ctx = context({ exam: exam({ type: "PRACTICE" }) });
	expect(regradeBlocker(ctx, NOW)).toBe("practice");
});

test("regradeBlocker: an EXAM whose grades are not released is not-released", () => {
	const ctx = context({ exam: exam({ gradesReleasedAt: null }) });
	expect(regradeBlocker(ctx, NOW)).toBe("not-released");
});

test("regradeBlocker: an EXAM whose release is scheduled for later is not-released", () => {
	const ctx = context({
		exam: exam({ gradesReleasedAt: plusMs(NOW, MINUTE) }),
	});
	expect(regradeBlocker(ctx, NOW)).toBe("not-released");
});

test("regradeBlocker: a QUIZ is not-released while a classmate's makeup is pending", () => {
	const makeup: ExceptionTiming = {
		extraTime: null,
		scheduledAt: plusMs(NOW, DAY),
	};
	const ctx = context({ exam: quiz(), exceptions: [makeup], exception: null });
	expect(regradeBlocker(ctx, NOW)).toBe("not-released");
});

test("regradeBlocker: a pending makeup of a student who dropped the course does not hold the QUIZ back", () => {
	const makeup: ExceptionTiming = {
		extraTime: null,
		scheduledAt: plusMs(NOW, DAY),
		dropped: true,
	};
	const ctx = context({ exam: quiz(), exceptions: [makeup] });
	expect(regradeBlocker(ctx, NOW)).toBeNull();
});

test("regradeBlocker: a QUIZ is not-released to the author while their own personal window is open", () => {
	const own: ExceptionTiming = {
		extraTime: null,
		scheduledAt: plusMs(NOW, -30 * MINUTE),
	};
	const ctx = context({
		exam: quiz(),
		exceptions: [own],
		exception: own,
		attempt: {
			createdAt: plusMs(NOW, -20 * MINUTE),
			acceptingSubmissions: false,
		},
	});
	expect(regradeBlocker(ctx, NOW)).toBe("not-released");
});

test("regradeBlocker: a QUIZ is released once every personal window has closed", () => {
	const own: ExceptionTiming = {
		extraTime: null,
		scheduledAt: plusMs(NOW, -DAY),
	};
	const ctx = context({ exam: quiz(), exceptions: [own], exception: own });
	expect(regradeBlocker(ctx, NOW)).toBeNull();
});

test("regradeBlocker: an older submission of the same question is not-counting", () => {
	const ctx = context({
		submission: "s1",
		outcome: outcome({ submission: "s2" }),
	});
	expect(regradeBlocker(ctx, NOW)).toBe("not-counting");
});

test("regradeBlocker: a pending counting answer is not-gradable", () => {
	const ctx = context({
		outcome: outcome({ status: "pending", score: null }),
	});
	expect(regradeBlocker(ctx, NOW)).toBe("not-gradable");
});

test("regradeBlocker: an unanswered question has no counting submission to contest", () => {
	const ctx = context({
		outcome: outcome({
			submission: undefined,
			status: "unanswered",
			score: 0,
		}),
	});
	expect(regradeBlocker(ctx, NOW)).toBe("not-counting");
});

test("regradeBlocker: an existing request, open or resolved, is exists", () => {
	expect(regradeBlocker(context({ requested: true }), NOW)).toBe("exists");
});

test("regradeBlocker: a request after the deadline is expired, at the deadline it is still on time", () => {
	expect(regradeBlocker(context(), DEADLINE)).toBeNull();
	expect(regradeBlocker(context(), plusMs(DEADLINE, 1))).toBe("expired");
});

test("regradeBlocker: a QUIZ with no known release moment never expires", () => {
	// Completed by hand, with no schedule: released, but since when is unknown.
	const handCompleted = quiz({
		status: "COMPLETED",
		scheduledAt: null,
		duration: null,
	});
	const years = new Date("2030-01-01T00:00:00Z");
	expect(regradeBlocker(context({ exam: handCompleted }), years)).toBeNull();
});

// Each row fails two checks; the earlier one in the documented order must win.
const PRECEDENCE: [string, Partial<RegradeContext>, RegradeBlocker][] = [
	[
		"practice over not-counting and exists",
		{
			exam: exam({ type: "PRACTICE" }),
			outcome: outcome({ submission: "s2" }),
			requested: true,
		},
		"practice",
	],
	[
		"not-released over not-counting",
		{
			exam: exam({ gradesReleasedAt: null }),
			outcome: outcome({ submission: "s2" }),
		},
		"not-released",
	],
	[
		"not-released over not-gradable",
		{
			exam: exam({ gradesReleasedAt: null }),
			outcome: outcome({ status: "pending", score: null }),
		},
		"not-released",
	],
	[
		"not-counting over not-gradable",
		{ outcome: outcome({ submission: "s2", status: "pending", score: null }) },
		"not-counting",
	],
	[
		"not-counting over exists",
		{ outcome: outcome({ submission: "s2" }), requested: true },
		"not-counting",
	],
	[
		"not-gradable over exists",
		{ outcome: outcome({ status: "pending", score: null }), requested: true },
		"not-gradable",
	],
];

for (const [title, overrides, expected] of PRECEDENCE) {
	test(`regradeBlocker precedence: ${title}`, () => {
		expect(regradeBlocker(context(overrides), NOW)).toBe(expected);
	});
}

test("regradeBlocker precedence: exists over expired", () => {
	const late = plusMs(DEADLINE, DAY);
	expect(regradeBlocker(context({ requested: true }), late)).toBe("exists");
});

test("regradeBlocker precedence: not-gradable over expired", () => {
	const late = plusMs(DEADLINE, DAY);
	const ctx = context({ outcome: outcome({ status: "pending", score: null }) });
	expect(regradeBlocker(ctx, late)).toBe("not-gradable");
});

//
// regradeDeadline
//

test("regradeDeadline: an EXAM's deadline is the release plus 14 days", () => {
	expect(regradeDeadline(exam(), NOW, [])?.toISOString()).toBe(
		"2026-04-03T12:00:00.000Z",
	);
});

test("regradeDeadline: a QUIZ's deadline counts from the end of the last makeup window", () => {
	const makeup: ExceptionTiming = {
		extraTime: null,
		scheduledAt: new Date("2026-03-12T10:00:00Z"),
	};
	const now = new Date("2026-03-13T00:00:00Z");
	expect(regradeDeadline(quiz(), now, [makeup])?.toISOString()).toBe(
		"2026-03-26T11:30:00.000Z",
	);
	expect(regradeDeadline(quiz(), now, [])?.getTime()).toBe(
		QUIZ_RELEASE.getTime() + REGRADE_WINDOW_DAYS * DAY,
	);
});

test("regradeDeadline: null when the release moment is unknown", () => {
	const handCompleted = quiz({
		status: "COMPLETED",
		scheduledAt: null,
		duration: null,
	});
	expect(regradeDeadline(handCompleted, NOW, [])).toBeNull();
	expect(regradeDeadline(exam({ type: "PRACTICE" }), NOW, [])).toBeNull();
});

test("regradeDeadline: null while the grades are not released", () => {
	expect(regradeDeadline(exam({ gradesReleasedAt: null }), NOW, [])).toBeNull();
});

//
// RegradeRequestService.create: the justification and the one-request-per-answer rule
//

// Random suffix, not an incrementing counter: slugs would otherwise collide
// with the ones sibling spec files draw from the shared test database.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureEdition(slug = "2095-1"): Promise<string> {
	if (!(await db.edition.findOne({ slug }, FULL_ACCESS))) {
		await db.edition.create(
			{
				slug,
				name: slug,
				startAt: new Date("2026-01-01"),
				endAt: new Date("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	return slug;
}

/// A student's graded answer to an `EXAM` released a moment ago, ready to be contested.
async function makeContestableAnswer() {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: await ensureEdition(),
	});
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: course.id as schema.CourseId, username: student.username },
		FULL_ACCESS,
	);
	const question = await persistedQuestionFactory.create({
		course: course.id,
		slug: tag("q-"),
	});
	const examRow = await persistedExamFactory.create({
		course: course.id,
		slug: tag("exam-"),
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: question.slug }],
	});
	const response = await persistedResponseFactory.create({
		course: course.id,
		exam: examRow.slug,
		author: student.username,
	});
	const submission = await persistedSubmissionFactory.create({
		response: { publicId: response.publicId },
		question: question.slug,
	});
	await db.feedback.create(
		{
			submission: { id: submission.id },
			ref: "pass-1",
			score: "1",
			grader: instructor.username,
		},
		FULL_ACCESS,
	);
	await prisma.exam.update({
		where: { id: examRow.id },
		data: {
			status: "COMPLETED",
			gradesReleasedAt: new Date(Date.now() - 60_000),
		},
	});
	return { course, student, submission };
}

function messageOf(length: number, padding = ""): string {
	return `${padding}${"x".repeat(length)}${padding}`;
}

const REFUSED_MESSAGES: [string, string][] = [
	["9 characters", messageOf(9)],
	["9 characters padded with blanks", messageOf(9, "   ")],
	["only blanks", " ".repeat(20)],
	["2001 characters", messageOf(2001)],
];

for (const [title, message] of REFUSED_MESSAGES) {
	test(`RegradeRequestService.create refuses a message of ${title}`, async () => {
		const { course, student, submission } = await makeContestableAnswer();
		const opts = { actor: student };

		const attempt = db.regradeRequest.create(
			{ course: course.id, submission: submission.publicId, message },
			opts,
		);

		await expect(attempt).rejects.toBeInstanceOf(InvalidData);
		await expect(attempt).rejects.toMatchObject({
			errors: { message: expect.anything() },
		});
		expect(
			await db.regradeRequest.findMany({ course: course.id }, opts),
		).toHaveLength(0);
	});
}

const ACCEPTED_MESSAGES: [string, string, string][] = [
	["exactly 10 characters", messageOf(10), messageOf(10)],
	["10 characters after trimming", messageOf(10, "   "), messageOf(10)],
	["exactly 2000 characters", messageOf(2000), messageOf(2000)],
];

for (const [title, message, stored] of ACCEPTED_MESSAGES) {
	test(`RegradeRequestService.create accepts a message of ${title}`, async () => {
		const { course, student, submission } = await makeContestableAnswer();

		const created = await db.regradeRequest.create(
			{ course: course.id, submission: submission.publicId, message },
			{ actor: student },
		);

		expect(created).toMatchObject({
			status: "OPEN",
			message: stored,
			submission: submission.publicId,
			author: student.username,
			reply: null,
		});
	});
}

test("RegradeRequestService.create refuses a second request for the same answer as not-unique on submission", async () => {
	const { course, student, submission } = await makeContestableAnswer();
	const opts = { actor: student };
	const input = {
		course: course.id,
		submission: submission.publicId,
		message: messageOf(20),
	};
	await db.regradeRequest.create(input, opts);

	const second = db.regradeRequest.create(input, opts);

	await expect(second).rejects.toBeInstanceOf(InvalidData);
	await expect(second).rejects.toMatchObject({
		errors: {
			submission: [
				{
					code: "not-unique",
					message: regradeBlockerMessage("exists"),
				},
			],
		},
	});
	expect(
		await db.regradeRequest.findMany({ course: course.id }, opts),
	).toHaveLength(1);
});
