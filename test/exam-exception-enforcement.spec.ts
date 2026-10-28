import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData } from "@/core/error";
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

async function enroll(courseId: schema.CourseId) {
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: courseId, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

/// A course with its instructor, a student, a classmate and a question.
async function setup() {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: await ensureEdition(),
	});
	const student = await enroll(course.id);
	const classmate = await enroll(course.id);
	const question = await persistedQuestionFactory.create({
		course: course.id,
		slug: tag("q-"),
	});
	return { course, instructor, student, classmate, question };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

/// An open exam with no schedule, so an attempt can be started before the clock is arranged.
function makeOpenExam(ctx: Ctx) {
	return persistedExamFactory.create({
		course: ctx.course.id,
		slug: tag("exam-"),
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: ctx.question.slug }],
	});
}

/// Moves `exam` to a window of `durationMinutes` that started `startedMinutesAgo` ago, with the stored `status`.
async function schedule(
	exam: { id: schema.ExamId },
	opts: {
		startedMinutesAgo: number;
		durationMinutes: number;
		status?: "SCHEDULED" | "COMPLETED";
	},
) {
	await prisma.exam.update({
		where: { id: exam.id },
		data: {
			status: opts.status ?? "SCHEDULED",
			scheduledAt: fromNow(-opts.startedMinutesAgo),
			durationMs: opts.durationMinutes * MINUTE,
		},
	});
}

function grantException(
	ctx: Ctx,
	exam: { slug: string },
	username: string,
	fields: { extraMinutes?: number; scheduledAt?: Date },
) {
	return db.examException.create(
		{
			course: ctx.course.id,
			exam: exam.slug,
			username,
			extraTime: fields.extraMinutes ? { minutes: fields.extraMinutes } : null,
			scheduledAt: fields.scheduledAt,
		},
		FULL_ACCESS,
	);
}

function submitAnswer(
	ctx: Ctx,
	exam: { slug: string },
	actor: { username: string },
) {
	return db.response.submit(
		{
			course: ctx.course.id,
			exam: exam.slug,
			question: ctx.question.slug,
			payload: null,
		},
		{ actor: actor as typeof ctx.student },
	);
}

function startAttempt(
	ctx: Ctx,
	exam: { slug: string },
	actor: typeof ctx.student,
) {
	return db.response.create(
		{ course: ctx.course.id, exam: exam.slug, author: actor.username },
		{ actor },
	);
}

function addSubmission(
	ctx: Ctx,
	response: { publicId: string },
	actor: typeof ctx.student,
) {
	return db.submission.create(
		{
			response: { publicId: response.publicId },
			question: ctx.question.slug,
			payload: null,
		},
		{ actor },
	);
}

const countSubmissions = (examId: schema.ExamId) =>
	prisma.submission.count({ where: { response: { examId } } });

// ---------------------------------------------------------------------------
// Extra time
// ---------------------------------------------------------------------------

test("a student with extra time answers after the general deadline and before their own", async () => {
	const ctx = await setup();
	const exam = await makeOpenExam(ctx);
	// General window ended 30 minutes ago; the student's runs 15 minutes more.
	await schedule(exam, { startedMinutesAgo: 90, durationMinutes: 60 });
	await grantException(ctx, exam, ctx.student.username, { extraMinutes: 45 });

	const response = await startAttempt(ctx, exam, ctx.student);
	await expect(
		addSubmission(ctx, response, ctx.student),
	).resolves.toMatchObject({ responseId: response.id });
	const answered = await submitAnswer(ctx, exam, ctx.student);
	expect(answered.acceptingSubmissions).toBe(true);
	expect(await countSubmissions(exam.id)).toBe(2);
});

test("a student with extra time is refused after their own deadline", async () => {
	const ctx = await setup();
	const exam = await makeOpenExam(ctx);
	const response = await startAttempt(ctx, exam, ctx.student);
	// The attempt started just now, but the window is what bounds it: the
	// general end was 30 minutes ago and the personal one 10 minutes ago.
	await schedule(exam, { startedMinutesAgo: 90, durationMinutes: 60 });
	await grantException(ctx, exam, ctx.student.username, { extraMinutes: 20 });

	await expect(submitAnswer(ctx, exam, ctx.student)).rejects.toBeInstanceOf(
		InvalidData,
	);
	await expect(
		addSubmission(ctx, response, ctx.student),
	).rejects.toBeInstanceOf(InvalidData);
	expect(await countSubmissions(exam.id)).toBe(0);
});

test("a student with extra time cannot start an attempt after their own deadline", async () => {
	const ctx = await setup();
	const exam = await makeOpenExam(ctx);
	await schedule(exam, { startedMinutesAgo: 90, durationMinutes: 60 });
	await grantException(ctx, exam, ctx.student.username, { extraMinutes: 20 });

	await expect(startAttempt(ctx, exam, ctx.student)).rejects.toBeInstanceOf(
		InvalidData,
	);
	expect(await prisma.response.count({ where: { examId: exam.id } })).toBe(0);
});

test("a classmate without an exception is refused while the student with extra time still answers", async () => {
	const ctx = await setup();
	const exam = await makeOpenExam(ctx);
	await schedule(exam, { startedMinutesAgo: 90, durationMinutes: 60 });
	await grantException(ctx, exam, ctx.student.username, { extraMinutes: 45 });

	await expect(submitAnswer(ctx, exam, ctx.student)).resolves.toBeDefined();
	await expect(submitAnswer(ctx, exam, ctx.classmate)).rejects.toBeInstanceOf(
		InvalidData,
	);
	await expect(startAttempt(ctx, exam, ctx.classmate)).rejects.toBeInstanceOf(
		InvalidData,
	);
});

// ---------------------------------------------------------------------------
// Makeup
// ---------------------------------------------------------------------------

/// An exam completed by hand whose window ended two days ago.
async function completedExam(ctx: Ctx) {
	const exam = await makeOpenExam(ctx);
	await schedule(exam, {
		startedMinutesAgo: 60 * 48,
		durationMinutes: 60,
		status: "COMPLETED",
	});
	return exam;
}

test("a makeup student starts and answers an exam that was completed, and a classmate cannot", async () => {
	const ctx = await setup();
	const exam = await completedExam(ctx);
	await grantException(ctx, exam, ctx.student.username, {
		scheduledAt: fromNow(-10),
	});

	const response = await startAttempt(ctx, exam, ctx.student);
	await expect(
		addSubmission(ctx, response, ctx.student),
	).resolves.toMatchObject({ responseId: response.id });
	await expect(submitAnswer(ctx, exam, ctx.student)).resolves.toMatchObject({
		acceptingSubmissions: true,
	});

	await expect(startAttempt(ctx, exam, ctx.classmate)).rejects.toBeInstanceOf(
		InvalidData,
	);
	await expect(submitAnswer(ctx, exam, ctx.classmate)).rejects.toBeInstanceOf(
		InvalidData,
	);
	expect(await prisma.response.count({ where: { examId: exam.id } })).toBe(1);
});

test("a makeup that has not started yet is refused", async () => {
	const ctx = await setup();
	const exam = await completedExam(ctx);
	await grantException(ctx, exam, ctx.student.username, {
		scheduledAt: fromNow(60),
	});

	await expect(startAttempt(ctx, exam, ctx.student)).rejects.toBeInstanceOf(
		InvalidData,
	);
	await expect(submitAnswer(ctx, exam, ctx.student)).rejects.toBeInstanceOf(
		InvalidData,
	);
});

test("a makeup whose window has ended is refused", async () => {
	const ctx = await setup();
	const exam = await completedExam(ctx);
	await grantException(ctx, exam, ctx.student.username, {
		scheduledAt: fromNow(-120),
	});

	await expect(submitAnswer(ctx, exam, ctx.student)).rejects.toBeInstanceOf(
		InvalidData,
	);
});

test("extra time alone does not reopen an exam completed by hand", async () => {
	const ctx = await setup();
	const exam = await completedExam(ctx);
	await grantException(ctx, exam, ctx.student.username, {
		extraMinutes: 24 * 60,
	});

	await expect(submitAnswer(ctx, exam, ctx.student)).rejects.toBeInstanceOf(
		InvalidData,
	);
});

// ---------------------------------------------------------------------------
// Reopening an attempt
// ---------------------------------------------------------------------------

/// A student who answered and finished an open exam, then the window ended 30 minutes ago.
async function finishedAttempt(ctx: Ctx) {
	const exam = await makeOpenExam(ctx);
	const answered = await submitAnswer(ctx, exam, ctx.student);
	await db.response.finish(
		{ course: ctx.course.id, exam: exam.slug },
		{ actor: ctx.student },
	);
	await schedule(exam, { startedMinutesAgo: 90, durationMinutes: 60 });
	return { exam, answered };
}

test("reopening a closed attempt inside the student's personal window lets them answer again and keeps what they sent", async () => {
	const ctx = await setup();
	const { exam, answered } = await finishedAttempt(ctx);
	await grantException(ctx, exam, ctx.student.username, { extraMinutes: 45 });
	await expect(submitAnswer(ctx, exam, ctx.student)).rejects.toBeInstanceOf(
		InvalidData,
	);

	await db.response.update(
		{ publicId: answered.publicId },
		{ acceptingSubmissions: true },
		{ actor: ctx.instructor },
	);
	const again = await submitAnswer(ctx, exam, ctx.student);

	expect(again.id).toBe(answered.id);
	expect(again.acceptingSubmissions).toBe(true);
	expect(again.submissions).toHaveLength(2);
	expect(again.submissions.map((s) => s.publicId)).toContain(
		answered.submissions[0]?.publicId,
	);
});

test("reopening an attempt whose personal window has closed is refused, with or without an exception", async () => {
	const ctx = await setup();
	const { exam, answered } = await finishedAttempt(ctx);
	const reopen = () =>
		db.response.update(
			{ publicId: answered.publicId },
			{ acceptingSubmissions: true },
			{ actor: ctx.instructor },
		);

	// No exception: the exam's own window ended 30 minutes ago.
	const plain = await reopen().then(
		() => null,
		(e: unknown) => e,
	);
	expect(plain).toBeInstanceOf(InvalidData);
	expect((plain as InvalidData).errors).toHaveProperty("response");

	// 20 minutes of extra time end 10 minutes ago, still too late.
	await grantException(ctx, exam, ctx.student.username, { extraMinutes: 20 });
	await expect(reopen()).rejects.toBeInstanceOf(InvalidData);
	expect(
		(await prisma.response.findUniqueOrThrow({ where: { id: answered.id } }))
			.acceptingSubmissions,
	).toBe(false);
});

test("closing an attempt is allowed whatever its window", async () => {
	const ctx = await setup();
	const exam = await makeOpenExam(ctx);
	const answered = await submitAnswer(ctx, exam, ctx.student);
	await schedule(exam, { startedMinutesAgo: 90, durationMinutes: 60 });

	const closed = await db.response.update(
		{ publicId: answered.publicId },
		{ acceptingSubmissions: false },
		{ actor: ctx.instructor },
	);
	expect(closed.acceptingSubmissions).toBe(false);
});

// ---------------------------------------------------------------------------
// Releasing grades with a pending exception
// ---------------------------------------------------------------------------

test("releaseGrades refuses a closed EXAM while a makeup is pending and succeeds after its window", async () => {
	const ctx = await setup();
	const exam = await completedExam(ctx);
	await grantException(ctx, exam, ctx.classmate.username, {
		scheduledAt: fromNow(60),
	});
	const release = () =>
		db.exam.releaseGrades(
			{ course: ctx.course.id, slug: exam.slug },
			{ actor: ctx.instructor },
		);

	await expect(release()).rejects.toBeInstanceOf(InvalidData);
	expect(
		(await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } }))
			.gradesReleasedAt,
	).toBeNull();

	// Window ended two hours ago.
	await db.examException.update(
		{
			course: ctx.course.id,
			exam: exam.slug,
			username: ctx.classmate.username,
		},
		{ scheduledAt: fromNow(-180) },
		FULL_ACCESS,
	);
	const released = await release();
	expect(released.gradesReleasedAt).toBeInstanceOf(Date);
});

test("releaseGrades refuses while a student's extra time is still running", async () => {
	const ctx = await setup();
	const exam = await makeOpenExam(ctx);
	await schedule(exam, { startedMinutesAgo: 90, durationMinutes: 60 });
	await grantException(ctx, exam, ctx.student.username, { extraMinutes: 45 });

	await expect(
		db.exam.releaseGrades(
			{ course: ctx.course.id, slug: exam.slug },
			{ actor: ctx.instructor },
		),
	).rejects.toBeInstanceOf(InvalidData);
});
