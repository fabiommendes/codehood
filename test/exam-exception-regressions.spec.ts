import { type APIRequestContext, expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData } from "@/core/error";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedSubmissionFactory } from "@/fixtures/submission.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";

// Rules of exam exceptions that a first implementation got wrong.

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

const MINUTE = 60_000;
const PASSWORD = "correct-horse-battery-staple";

/// `minutes` from the real clock, negative for the past.
function fromNow(minutes: number): Date {
	return new Date(Date.now() + minutes * MINUTE);
}

async function ensureEdition(slug = "2096-1"): Promise<string> {
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
	const student = await persistedUserFactory.create({
		role: "STUDENT",
		password: PASSWORD,
	});
	await db.enrollment.create(
		{ course: courseId, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

/// A course with its instructor, two students and a question.
async function setup() {
	const instructor = await persistedUserFactory.create({
		role: "INSTRUCTOR",
		password: PASSWORD,
	});
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

/// An `ONGOING` exam, so attempts can be written before the clock is arranged.
function openExam(
	ctx: Ctx,
	overrides: {
		type?: "QUIZ" | "EXAM";
		duration?: { minutes: number };
	} = {},
) {
	return persistedExamFactory.create({
		course: ctx.course.id,
		slug: tag("exam-"),
		type: overrides.type ?? "EXAM",
		status: "ONGOING",
		duration: overrides.duration,
		questions: [{ slug: ctx.question.slug }],
	});
}

/// Moves `exam` to a window that started `startedMinutesAgo` ago and lasts `durationMinutes`.
async function schedule(
	exam: { id: schema.ExamId },
	startedMinutesAgo: number,
	durationMinutes: number,
) {
	await prisma.exam.update({
		where: { id: exam.id },
		data: {
			status: "SCHEDULED",
			scheduledAt: fromNow(-startedMinutesAgo),
			durationMs: durationMinutes * MINUTE,
		},
	});
}

/// A closed attempt of `author` at `exam`, with one answer.
async function answered(
	ctx: Ctx,
	exam: { slug: string },
	author: { username: string },
) {
	const response = await persistedResponseFactory.create({
		course: ctx.course.id,
		exam: exam.slug,
		author: author.username,
	});
	const submission = await persistedSubmissionFactory.create({
		response: { publicId: response.publicId },
		question: ctx.question.slug,
	});
	await db.response.update(
		{ publicId: response.publicId },
		{ acceptingSubmissions: false },
		FULL_ACCESS,
	);
	return { response, submission };
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

const acceptingSubmissions = async (id: schema.ResponseId) =>
	(await prisma.response.findUniqueOrThrow({ where: { id } }))
		.acceptingSubmissions;

//
// Feedback of a QUIZ is held back while a makeup is pending
//

const FEEDBACK_TEXT = "the answer key says brasilia";

/// A QUIZ whose class window ended an hour ago, with graded feedback on `student`'s answer and a pending makeup for `classmate`.
async function quizWithPendingMakeup() {
	const ctx = await setup();
	const exam = await openExam(ctx, { type: "QUIZ", duration: { minutes: 30 } });
	const { response, submission } = await answered(ctx, exam, ctx.student);
	await db.feedback.create(
		{
			submission: { id: submission.id },
			ref: "manual",
			score: "1",
			feedback: FEEDBACK_TEXT,
		},
		{ actor: ctx.instructor },
	);
	// The exception exists before the window closes: a QUIZ releases on close.
	await grantException(ctx, exam, ctx.classmate.username, {
		scheduledAt: fromNow(60),
	});
	await schedule(exam, 90, 30);
	return { ctx, exam, response, submission };
}

/// Ends the classmate's makeup window two hours ago.
function endMakeup(ctx: Ctx, exam: { slug: string }) {
	return db.examException.update(
		{
			course: ctx.course.id,
			exam: exam.slug,
			username: ctx.classmate.username,
		},
		{ scheduledAt: fromNow(-180) },
		FULL_ACCESS,
	);
}

test("feedback of a QUIZ stays unreadable by students until the last makeup window closes", async () => {
	const { ctx, exam } = await quizWithPendingMakeup();
	const read = () =>
		db.feedback.findMany(
			{ course: ctx.course.id, exam: exam.slug },
			{ actor: ctx.student },
		);

	expect(await read()).toEqual([]);

	await endMakeup(ctx, exam);
	const released = await read();
	expect(released.map((f) => f.feedback)).toEqual([FEEDBACK_TEXT]);
});

test("REST feedback of a QUIZ does not reach the student while a makeup is pending, and does after", async ({
	request,
}) => {
	const { ctx, exam, submission } = await quizWithPendingMakeup();
	const login = await request.post("/api/auth/login", {
		data: { login: ctx.student.username, password: PASSWORD },
	});
	const { token } = await login.json();
	const headers = { Authorization: `Bearer ${token}` };
	const url = `/api/course/${ctx.course.discipline.slug}/${ctx.instructor.username}_${ctx.course.edition.slug}/submission/${submission.publicId}/feedback`;
	const body = async (r: APIRequestContext) =>
		(await r.get(url, { headers })).text();

	expect(await body(request)).not.toContain(FEEDBACK_TEXT);

	await endMakeup(ctx, exam);
	expect(await body(request)).toContain(FEEDBACK_TEXT);
});

//
// Reopening an attempt whose deadline counts from its start
//

test("an attempt on an unscheduled timed exam cannot be reopened after its own deadline, unless an exception extends it", async () => {
	const ctx = await setup();
	const exam = await openExam(ctx, { duration: { minutes: 60 } });
	const { response } = await answered(ctx, exam, ctx.student);
	// Started three hours ago on a 60 minute exam: the deadline was two hours ago.
	await prisma.response.update({
		where: { id: response.id },
		data: { createdAt: fromNow(-180) },
	});
	const reopen = () =>
		db.response.update(
			{ publicId: response.publicId },
			{ acceptingSubmissions: true },
			{ actor: ctx.instructor },
		);

	await expect(reopen()).rejects.toBeInstanceOf(InvalidData);
	expect(await acceptingSubmissions(response.id)).toBe(false);

	// 60 + 240 minutes from the start is two hours from now.
	await grantException(ctx, exam, ctx.student.username, { extraMinutes: 240 });
	const reopened = await reopen();
	expect(reopened.acceptingSubmissions).toBe(true);
});

//
// An exception needs the exam to keep its duration
//

test("an exam cannot lose its duration while an exception holds a makeup date, and can once it is removed", async () => {
	const ctx = await setup();
	const exam = await persistedExamFactory.create({
		course: ctx.course.id,
		slug: tag("exam-"),
		type: "EXAM",
		status: "SCHEDULED",
		scheduledAt: fromNow(60),
		duration: { minutes: 60 },
	});
	await grantException(ctx, exam, ctx.student.username, {
		scheduledAt: fromNow(60 * 48),
	});
	const untime = () =>
		db.exam.update(
			{ course: ctx.course.id, slug: exam.slug },
			{ duration: null },
			FULL_ACCESS,
		);

	await expect(untime()).rejects.toBeInstanceOf(InvalidData);
	const kept = await db.exam.findOne(
		{ course: ctx.course.id, slug: exam.slug },
		FULL_ACCESS,
	);
	expect(kept?.duration).not.toBeNull();

	await db.examException.delete(
		{
			course: ctx.course.id,
			exam: exam.slug,
			username: ctx.student.username,
		},
		FULL_ACCESS,
	);
	const updated = await untime();
	expect(updated.duration).toBeNull();
});

//
// Exceptions after the results are out
//

test("an exception cannot be created or changed on an EXAM whose grades were released", async () => {
	const ctx = await setup();
	const exam = await openExam(ctx);
	await schedule(exam, 120, 60);
	await grantException(ctx, exam, ctx.student.username, { extraMinutes: 30 });
	await prisma.exam.update({
		where: { id: exam.id },
		data: { gradesReleasedAt: fromNow(-10) },
	});

	await expect(
		grantException(ctx, exam, ctx.classmate.username, { extraMinutes: 30 }),
	).rejects.toBeInstanceOf(InvalidData);
	await expect(
		db.examException.update(
			{
				course: ctx.course.id,
				exam: exam.slug,
				username: ctx.student.username,
			},
			{ extraTime: { minutes: 45 } },
			FULL_ACCESS,
		),
	).rejects.toBeInstanceOf(InvalidData);
});

test("an exception cannot be created on a QUIZ whose results are already released, but can while it is still open", async () => {
	const ctx = await setup();
	const open = await openExam(ctx, { type: "QUIZ" });
	await schedule(open, 10, 60);
	await expect(
		grantException(ctx, open, ctx.student.username, { extraMinutes: 30 }),
	).resolves.toBeDefined();

	const released = await openExam(ctx, { type: "QUIZ" });
	await schedule(released, 120, 30);
	await expect(
		grantException(ctx, released, ctx.student.username, { extraMinutes: 30 }),
	).rejects.toBeInstanceOf(InvalidData);
});

//
// A student who dropped the course holds nobody back
//

test("the exception of a dropped student does not block releasing an EXAM's grades", async () => {
	const ctx = await setup();
	const exam = await openExam(ctx);
	await schedule(exam, 120, 60);
	await grantException(ctx, exam, ctx.classmate.username, {
		scheduledAt: fromNow(60 * 48),
	});
	const release = () =>
		db.exam.releaseGrades(
			{ course: ctx.course.id, slug: exam.slug },
			{ actor: ctx.instructor },
		);

	await expect(release()).rejects.toBeInstanceOf(InvalidData);

	await db.enrollment.delete(
		{ course: ctx.course.id, username: ctx.classmate.username },
		FULL_ACCESS,
	);
	const released = await release();
	expect(released.gradesReleasedAt).toBeInstanceOf(Date);
});

test("the exception of a dropped student does not hold back a QUIZ's feedback", async () => {
	const { ctx, exam } = await quizWithPendingMakeup();
	await db.enrollment.delete(
		{ course: ctx.course.id, username: ctx.classmate.username },
		FULL_ACCESS,
	);

	const read = await db.feedback.findMany(
		{ course: ctx.course.id, exam: exam.slug },
		{ actor: ctx.student },
	);
	expect(read.map((f) => f.feedback)).toEqual([FEEDBACK_TEXT]);
});

//
// Reopening through upsert
//

test("an upsert by the owner cannot reopen an attempt whose personal window has closed", async () => {
	const ctx = await setup();
	const exam = await openExam(ctx);
	const { response } = await answered(ctx, exam, ctx.student);
	await schedule(exam, 90, 60);

	await expect(
		db.response.upsert(
			{
				course: ctx.course.id,
				exam: exam.slug,
				author: ctx.student.username,
				acceptingSubmissions: true,
			},
			{ actor: ctx.instructor },
		),
	).rejects.toBeInstanceOf(InvalidData);
	expect(await acceptingSubmissions(response.id)).toBe(false);
});

test("an upsert by the owner reopens an attempt while the personal window is open", async () => {
	const ctx = await setup();
	const exam = await openExam(ctx);
	const { response } = await answered(ctx, exam, ctx.student);
	await schedule(exam, 90, 60);
	await grantException(ctx, exam, ctx.student.username, { extraMinutes: 45 });

	await db.response.upsert(
		{
			course: ctx.course.id,
			exam: exam.slug,
			author: ctx.student.username,
			acceptingSubmissions: true,
		},
		{ actor: ctx.instructor },
	);
	expect(await acceptingSubmissions(response.id)).toBe(true);
});

test("a student's own upsert does not reopen their closed attempt", async () => {
	const ctx = await setup();
	const exam = await openExam(ctx);
	const { response } = await answered(ctx, exam, ctx.student);

	await db.response
		.upsert(
			{
				course: ctx.course.id,
				exam: exam.slug,
				acceptingSubmissions: true,
			},
			{ actor: ctx.student },
		)
		.catch(() => undefined);

	expect(await acceptingSubmissions(response.id)).toBe(false);
});
