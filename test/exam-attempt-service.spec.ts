import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData, NotFound } from "@/core/error";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";

// Random suffix, not an incrementing counter: slugs would otherwise collide
// with the ones sibling spec files draw from the shared test database.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

const MINUTE = 60_000;

/// `minutes` from the real clock, negative for the past.
function fromNow(minutes: number): Date {
	return new Date(Date.now() + minutes * MINUTE);
}

async function ensureEdition(slug = "2093-1"): Promise<string> {
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

async function makeCourse() {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: await ensureEdition(),
	});
	return { course, instructor };
}

async function enrollStudent(courseId: schema.CourseId) {
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: courseId, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

interface ExamOverrides {
	status?: "DRAFT" | "SCHEDULED" | "ONGOING" | "COMPLETED" | "ARCHIVED";
	type?: "PRACTICE" | "QUIZ" | "EXAM";
	scheduledAt?: Date | null;
	duration?: { hours?: number; minutes?: number } | null;
}

async function makeExam(
	courseId: schema.CourseId,
	questionSlug: string,
	overrides: ExamOverrides = {},
) {
	return persistedExamFactory.create({
		course: courseId,
		slug: tag("exam-"),
		status: overrides.status ?? "ONGOING",
		type: overrides.type ?? "EXAM",
		scheduledAt: overrides.scheduledAt ?? null,
		duration: overrides.duration ?? null,
		questions: [{ slug: questionSlug }],
	});
}

/// A course with one enrolled student and a question, ready for an exam.
async function setup() {
	const { course, instructor } = await makeCourse();
	const student = await enrollStudent(course.id);
	const question = await persistedQuestionFactory.create({
		course: course.id,
		slug: tag("q-"),
	});
	return { course, instructor, student, question };
}

/// How an exam is configured, and whether the clock lets a student answer it.
const clockCases: { label: string; exam: ExamOverrides; open: boolean }[] = [
	{
		label: "a SCHEDULED exam inside its window",
		exam: {
			status: "SCHEDULED",
			scheduledAt: fromNow(-10),
			duration: { minutes: 60 },
		},
		open: true,
	},
	{
		label: "an untimed SCHEDULED exam that has started",
		exam: { status: "SCHEDULED", scheduledAt: fromNow(-10) },
		open: true,
	},
	{
		label: "an ONGOING exam with no schedule",
		exam: { status: "ONGOING" },
		open: true,
	},
	{
		label: "a SCHEDULED exam in the future",
		exam: {
			status: "SCHEDULED",
			scheduledAt: fromNow(60),
			duration: { minutes: 60 },
		},
		open: false,
	},
	{
		label: "a SCHEDULED exam whose window has ended",
		exam: {
			status: "SCHEDULED",
			scheduledAt: fromNow(-180),
			duration: { minutes: 60 },
		},
		open: false,
	},
	{
		label: "an ONGOING exam whose window has ended",
		exam: {
			status: "ONGOING",
			scheduledAt: fromNow(-180),
			duration: { minutes: 60 },
		},
		open: false,
	},
	{
		label: "a COMPLETED exam",
		exam: { status: "COMPLETED" },
		open: false,
	},
];

//
// Starting and answering follow the clock, not the stored status.
//

for (const { label, exam: overrides, open } of clockCases) {
	test(`response.create() ${open ? "accepts" : "refuses"} ${label}`, async () => {
		const { course, student, question } = await setup();
		const exam = await makeExam(course.id, question.slug, overrides);

		const attempt = db.response.create(
			{ course: course.id, exam: exam.slug, author: student.username },
			{ actor: student },
		);

		if (open) {
			await expect(attempt).resolves.toMatchObject({
				exam: exam.slug,
				author: student.username,
				acceptingSubmissions: true,
			});
		} else {
			await expect(attempt).rejects.toBeInstanceOf(InvalidData);
			expect(await prisma.response.count({ where: { examId: exam.id } })).toBe(
				0,
			);
		}
	});

	test(`response.submit() ${open ? "accepts" : "refuses"} ${label}`, async () => {
		const { course, student, question } = await setup();
		const exam = await makeExam(course.id, question.slug, overrides);

		const attempt = db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: question.slug,
				payload: { answer: 1 },
			},
			{ actor: student },
		);

		if (open) {
			const response = await attempt;
			expect(response.submissions).toHaveLength(1);
		} else {
			await expect(attempt).rejects.toBeInstanceOf(InvalidData);
			expect(
				await prisma.submission.count({
					where: { response: { examId: exam.id } },
				}),
			).toBe(0);
		}
	});

	test(`submission.create() ${open ? "accepts" : "refuses"} ${label}`, async () => {
		const { course, student, question } = await setup();
		// The attempt is opened while the exam is open, then the exam moves to
		// the state under test, so the setup never depends on the rule itself.
		const exam = await makeExam(course.id, question.slug, {
			status: "ONGOING",
		});
		const response = await db.response.create(
			{ course: course.id, exam: exam.slug, author: student.username },
			{ actor: student },
		);
		await prisma.exam.update({
			where: { id: exam.id },
			data: {
				status: overrides.status,
				scheduledAt: overrides.scheduledAt ?? null,
				durationMs: overrides.duration
					? (overrides.duration.hours ?? 0) * 60 * MINUTE +
						(overrides.duration.minutes ?? 0) * MINUTE
					: null,
			},
		});

		const attempt = db.submission.create(
			{
				response: { publicId: response.publicId },
				question: question.slug,
				payload: { answer: 1 },
			},
			{ actor: student },
		);

		if (open) {
			await expect(attempt).resolves.toMatchObject({ responseId: response.id });
		} else {
			await expect(attempt).rejects.toBeInstanceOf(InvalidData);
			expect(
				await prisma.submission.count({ where: { responseId: response.id } }),
			).toBe(0);
		}
	});
}

test("response.create() refuses a DRAFT exam", async () => {
	const { course, student, question } = await setup();
	const exam = await makeExam(course.id, question.slug, { status: "DRAFT" });

	// FULL_ACCESS sidesteps the visibility rule that hides drafts from students.
	await expect(
		db.response.create(
			{ course: course.id, exam: exam.slug, author: student.username },
			FULL_ACCESS,
		),
	).rejects.toBeInstanceOf(InvalidData);
});

test("response.submit() refuses a DRAFT exam", async () => {
	const { course, student, question } = await setup();
	const exam = await makeExam(course.id, question.slug, { status: "DRAFT" });

	await expect(
		db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: question.slug,
				author: student.username,
				payload: { answer: 1 },
			},
			FULL_ACCESS,
		),
	).rejects.toBeInstanceOf(InvalidData);
});

//
// A submit past the attempt's own deadline is refused.
//

async function startedAgo(minutes: number, exam: ExamOverrides) {
	const { course, student, question } = await setup();
	const created = await makeExam(course.id, question.slug, exam);
	const response = await db.response.create(
		{ course: course.id, exam: created.slug, author: student.username },
		{ actor: student },
	);
	await prisma.response.update({
		where: { id: response.id },
		data: { createdAt: fromNow(-minutes) },
	});
	const submit = () =>
		db.response.submit(
			{
				course: course.id,
				exam: created.slug,
				question: question.slug,
				payload: { answer: 1 },
			},
			{ actor: student },
		);
	return { course, exam: created, response, submit };
}

test("response.submit() refuses an attempt started 31 minutes ago on an unscheduled 30 minute exam", async () => {
	const { submit, response } = await startedAgo(31, {
		status: "ONGOING",
		duration: { minutes: 30 },
	});

	await expect(submit()).rejects.toBeInstanceOf(InvalidData);
	expect(
		await prisma.submission.count({ where: { responseId: response.id } }),
	).toBe(0);
});

test("response.submit() accepts an attempt started 29 minutes ago on an unscheduled 30 minute exam", async () => {
	const { submit, response } = await startedAgo(29, {
		status: "ONGOING",
		duration: { minutes: 30 },
	});

	const updated = await submit();
	expect(updated.id).toBe(response.id);
	expect(updated.submissions).toHaveLength(1);
});

test("response.submit() counts extra time toward the attempt's deadline", async () => {
	const { submit, course, exam } = await startedAgo(35, {
		status: "ONGOING",
		duration: { minutes: 30 },
	});
	await db.exam.update(
		{ course: course.id, slug: exam.slug },
		{ extraTime: { minutes: 10 } },
		FULL_ACCESS,
	);

	await expect(submit()).resolves.toMatchObject({ acceptingSubmissions: true });
});

test("response.submit() has no deadline on an untimed exam, however old the attempt", async () => {
	const { submit } = await startedAgo(24 * 60, { status: "ONGOING" });

	await expect(submit()).resolves.toMatchObject({ acceptingSubmissions: true });
});

//
// finish() closes the author's graded attempt.
//

async function withAttempt() {
	const ctx = await setup();
	const exam = await makeExam(ctx.course.id, ctx.question.slug);
	const attempt = await db.response.submit(
		{
			course: ctx.course.id,
			exam: exam.slug,
			question: ctx.question.slug,
			payload: { answer: 1 },
		},
		{ actor: ctx.student },
	);
	return { ...ctx, exam, attempt };
}

test("response.finish() closes the student's own attempt and keeps its submissions", async () => {
	const { course, student, exam, attempt } = await withAttempt();

	const finished = await db.response.finish(
		{ course: course.id, exam: exam.slug },
		{ actor: student },
	);

	expect(finished.id).toBe(attempt.id);
	expect(finished.acceptingSubmissions).toBe(false);
	expect(finished.submissions).toHaveLength(1);
	expect(
		(await prisma.response.findUniqueOrThrow({ where: { id: attempt.id } }))
			.acceptingSubmissions,
	).toBe(false);
});

test("response.finish() accepts the author naming themselves", async () => {
	const { course, student, exam } = await withAttempt();

	const finished = await db.response.finish(
		{ course: course.id, exam: exam.slug, author: student.username },
		{ actor: student },
	);

	expect(finished.acceptingSubmissions).toBe(false);
});

test("response.submit() is refused after finish()", async () => {
	const { course, student, exam, question, attempt } = await withAttempt();
	await db.response.finish(
		{ course: course.id, exam: exam.slug },
		{ actor: student },
	);

	await expect(
		db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: question.slug,
				payload: { answer: 2 },
			},
			{ actor: student },
		),
	).rejects.toBeInstanceOf(InvalidData);
	expect(
		await prisma.submission.count({ where: { responseId: attempt.id } }),
	).toBe(1);
});

test("response.finish() called again returns the same closed response without error", async () => {
	const { course, student, exam } = await withAttempt();

	const first = await db.response.finish(
		{ course: course.id, exam: exam.slug },
		{ actor: student },
	);
	const second = await db.response.finish(
		{ course: course.id, exam: exam.slug },
		{ actor: student },
	);

	expect(second.acceptingSubmissions).toBe(false);
	expect(second).toEqual(first);
});

test("response.finish() is NotFound when the student has no attempt at the exam", async () => {
	const { course, student, question } = await setup();
	const exam = await makeExam(course.id, question.slug);

	await expect(
		db.response.finish(
			{ course: course.id, exam: exam.slug },
			{ actor: student },
		),
	).rejects.toBeInstanceOf(NotFound);
});

test("response.finish() is NotFound for an exam that does not exist", async () => {
	const { course, student } = await setup();

	await expect(
		db.response.finish(
			{ course: course.id, exam: "no-such-exam" },
			{ actor: student },
		),
	).rejects.toBeInstanceOf(NotFound);
});

//
// finish() and other people's attempts.
//

test("response.finish() is NotFound, not NotAllowed, when a student names another student", async () => {
	const { course, student, exam, attempt } = await withAttempt();
	const peer = await enrollStudent(course.id);

	await expect(
		db.response.finish(
			{ course: course.id, exam: exam.slug, author: student.username },
			{ actor: peer },
		),
	).rejects.toBeInstanceOf(NotFound);

	expect(
		(await prisma.response.findUniqueOrThrow({ where: { id: attempt.id } }))
			.acceptingSubmissions,
	).toBe(true);
});

test("response.finish() gives a peer the same NotFound whether or not the other student has an attempt", async () => {
	const { course, student, exam } = await withAttempt();
	const peer = await enrollStudent(course.id);
	const idle = await enrollStudent(course.id);

	const withOne = await db.response
		.finish(
			{ course: course.id, exam: exam.slug, author: student.username },
			{ actor: peer },
		)
		.catch((error) => error);
	const withNone = await db.response
		.finish(
			{ course: course.id, exam: exam.slug, author: idle.username },
			{ actor: peer },
		)
		.catch((error) => error);

	expect(withOne).toBeInstanceOf(NotFound);
	expect(withNone).toBeInstanceOf(NotFound);
	expect(withOne).toMatchObject({
		status: withNone.status,
		code: withNone.code,
	});
});

test("response.finish() lets the course's instructor close a student's attempt by naming them", async () => {
	const { course, instructor, student, exam, attempt } = await withAttempt();

	const finished = await db.response.finish(
		{ course: course.id, exam: exam.slug, author: student.username },
		{ actor: instructor },
	);

	expect(finished.id).toBe(attempt.id);
	expect(finished.author).toBe(student.username);
	expect(finished.acceptingSubmissions).toBe(false);
	expect(
		(await prisma.response.findUniqueOrThrow({ where: { id: attempt.id } }))
			.acceptingSubmissions,
	).toBe(false);
});

test("response.finish() by an instructor of another course is NotFound", async () => {
	const { course, student, exam, attempt } = await withAttempt();
	const { instructor: outsider } = await makeCourse();

	await expect(
		db.response.finish(
			{ course: course.id, exam: exam.slug, author: student.username },
			{ actor: outsider },
		),
	).rejects.toBeInstanceOf(NotFound);
	expect(
		(await prisma.response.findUniqueOrThrow({ where: { id: attempt.id } }))
			.acceptingSubmissions,
	).toBe(true);
});
