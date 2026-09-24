import { expect, test } from "@playwright/test";
import { type Actor, FULL_ACCESS, SYSTEM } from "@/auth/actor";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import { db, type schema, type User } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedSubmissionFactory } from "@/fixtures/submission.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";

// Random suffix, not an incrementing counter: this file's own edition slug
// would otherwise collide with the ones sibling spec files draw, since they
// all share one test database.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureEdition(slug = "2092-1"): Promise<string> {
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

async function makeCourse(instructor?: User) {
	const owner =
		instructor ?? (await persistedUserFactory.create({ role: "INSTRUCTOR" }));
	const course = await persistedCourseFactory.create({
		instructor: owner.username,
		edition: await ensureEdition(),
	});
	return { course, instructor: owner };
}

async function enrollStudent(courseId: schema.CourseId) {
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: courseId, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

async function makeQuestion(courseId: schema.CourseId) {
	return persistedQuestionFactory.create({ course: courseId, slug: tag("q-") });
}

async function makeExam(
	courseId: schema.CourseId,
	questionSlugs: string[],
	overrides: {
		status?: "DRAFT" | "SCHEDULED" | "ONGOING" | "COMPLETED" | "ARCHIVED";
		type?: "PRACTICE" | "QUIZ" | "EXAM";
	} = {},
) {
	return persistedExamFactory.create({
		course: courseId,
		slug: tag("exam-"),
		status: overrides.status ?? "ONGOING",
		type: overrides.type ?? "EXAM",
		questions: questionSlugs.map((slug) => ({ slug })),
	});
}

async function makeOpenResponse(
	courseId: schema.CourseId,
	questionSlugs: string[],
	author: string,
	overrides: { type?: "PRACTICE" | "QUIZ" | "EXAM" } = {},
) {
	const exam = await makeExam(courseId, questionSlugs, {
		status: "ONGOING",
		type: overrides.type ?? "EXAM",
	});
	const response = await persistedResponseFactory.create({
		course: courseId,
		exam: exam.slug,
		author,
	});
	return { exam, response };
}

//
// Happy path
//

test("create() appends an attempt to an open response, resolving responseId/questionId itself; delete() removes only the attempt", async () => {
	const { course, instructor } = await makeCourse();
	const student = await enrollStudent(course.id);
	const question = await makeQuestion(course.id);
	const { response } = await makeOpenResponse(
		course.id,
		[question.slug],
		student.username,
	);

	const submission = await db.submission.create(
		{
			response: { publicId: response.publicId },
			question: question.slug,
			payload: { answer: 42 },
			startedAt: new Date("2026-02-01T00:00:00Z"),
		},
		{ actor: student },
	);

	expect(submission.responseId).toBe(response.id);
	expect(submission.questionId).toBe(question.id);
	expect(submission.status).toBe("PENDING_GRADE");
	expect(submission.automaticallyTriggered).toBe(false);
	expect(submission.payload).toEqual({ answer: 42 });
	expect(submission.startedAt).toEqual(new Date("2026-02-01T00:00:00Z"));

	// Visible to its author and to the instructor, by publicId.
	for (const actor of [student, instructor]) {
		const found = await db.submission.findOne(
			{ publicId: submission.publicId },
			{ actor },
		);
		expect(found?.publicId).toBe(submission.publicId);
	}

	// Only the instructor moves the grading status.
	const graded = await db.submission.update(
		{ publicId: submission.publicId },
		{ status: "GRADED_MANUALLY" },
		{ actor: instructor },
	);
	expect(graded.status).toBe("GRADED_MANUALLY");
	expect(graded.payload).toEqual({ answer: 42 });

	await db.submission.delete(
		{ publicId: submission.publicId },
		{ actor: instructor },
	);
	expect(
		await prisma.submission.findUnique({ where: { id: submission.id } }),
	).toBeNull();

	// The response itself is untouched.
	expect(
		await prisma.response.findUnique({ where: { id: response.id } }),
	).not.toBeNull();
});

//
// R2 — a submission's question must be one the response's exam carries.
//

test("create() refuses a question the exam does not carry", async () => {
	const { course } = await makeCourse();
	const student = await enrollStudent(course.id);
	const inExam = await makeQuestion(course.id);
	const notInExam = await makeQuestion(course.id);
	const { response } = await makeOpenResponse(
		course.id,
		[inExam.slug],
		student.username,
	);

	await expect(
		db.submission.create(
			{
				response: { publicId: response.publicId },
				question: notInExam.slug,
				payload: { answer: 1 },
			},
			{ actor: student },
		),
	).rejects.toBeInstanceOf(InvalidData);

	expect(
		await prisma.submission.count({ where: { responseId: response.id } }),
	).toBe(0);
});

//
// R4 — a submission is refused when its response has acceptingSubmissions: false.
//

test("create() refuses an attempt against a closed response", async () => {
	const { course } = await makeCourse();
	const student = await enrollStudent(course.id);
	const question = await makeQuestion(course.id);
	const exam = await makeExam(course.id, [question.slug], { type: "EXAM" });
	const response = await persistedResponseFactory.create({
		course: course.id,
		exam: exam.slug,
		author: student.username,
		acceptingSubmissions: false,
	});

	await expect(
		db.submission.create(
			{
				response: { publicId: response.publicId },
				question: question.slug,
				payload: { answer: 1 },
			},
			{ actor: student },
		),
	).rejects.toBeInstanceOf(InvalidData);

	expect(
		await prisma.submission.count({ where: { responseId: response.id } }),
	).toBe(0);
});

//
// R5 — a submission is refused unless the exam is ONGOING.
//

const examStatuses: {
	status: "DRAFT" | "SCHEDULED" | "ONGOING" | "COMPLETED";
	allowed: boolean;
}[] = [
	{ status: "DRAFT", allowed: false },
	{ status: "SCHEDULED", allowed: false },
	{ status: "COMPLETED", allowed: false },
	{ status: "ONGOING", allowed: true },
];

for (const { status, allowed } of examStatuses) {
	test(`create() ${allowed ? "accepts" : "refuses"} an attempt against a ${status} exam`, async () => {
		const { course } = await makeCourse();
		const student = await enrollStudent(course.id);
		const question = await makeQuestion(course.id);
		const exam = await makeExam(course.id, [question.slug], {
			status,
			type: "EXAM",
		});
		// SYSTEM opens the response directly, sidestepping the visibility rule
		// that would otherwise hide a DRAFT/ARCHIVED exam from the student —
		// that is covered separately in response-service.spec.ts.
		const response = await persistedResponseFactory.create(
			{ course: course.id, exam: exam.slug, author: student.username },
			{ transient: { actor: FULL_ACCESS.actor } },
		);

		const attempt = db.submission.create(
			{
				response: { publicId: response.publicId },
				question: question.slug,
				payload: { answer: 1 },
			},
			{ actor: student },
		);

		if (allowed) {
			await expect(attempt).resolves.toMatchObject({ responseId: response.id });
		} else {
			await expect(attempt).rejects.toBeInstanceOf(InvalidData);
			expect(
				await prisma.submission.count({ where: { responseId: response.id } }),
			).toBe(0);
		}
	});
}

//
// R6 — a submission's responseId and questionId are resolved by the service,
// never taken from the caller as a pair that could disagree.
//

test("create() ignores a responseId/questionId smuggled in the payload and always resolves its own pair", async () => {
	const { course } = await makeCourse();
	const student = await enrollStudent(course.id);
	const question = await makeQuestion(course.id);
	const { response } = await makeOpenResponse(
		course.id,
		[question.slug],
		student.username,
	);
	const foreignQuestion = await makeQuestion(course.id);
	const foreignResponse = await persistedResponseFactory.create({});

	const smuggled = {
		response: { publicId: response.publicId },
		question: question.slug,
		payload: { answer: 1 },
		responseId: foreignResponse.id,
		questionId: foreignQuestion.id,
		// biome-ignore lint/suspicious/noExplicitAny: intentionally smuggled fields the create schema does not declare
	} as any;
	const submission = await db.submission.create(smuggled, { actor: student });

	expect(submission.responseId).toBe(response.id);
	expect(submission.questionId).toBe(question.id);
	expect(submission.responseId).not.toBe(foreignResponse.id);
	expect(submission.questionId).not.toBe(foreignQuestion.id);
});

//
// R8 — a submission the actor may not read is NotFound, not NotAllowed.
// Access control: {author, peer, owning instructor, other instructor, admin, SYSTEM} x {read, update, delete}.
//

test("findOne(): the author and the owning instructor read the submission; a peer, another instructor, and a non-owning admin get null", async () => {
	const { course, instructor } = await makeCourse();
	const author = await enrollStudent(course.id);
	const peer = await enrollStudent(course.id);
	const { instructor: otherInstructor } = await makeCourse();
	const admin = await persistedUserFactory.create({ role: "ADMIN" });
	const question = await makeQuestion(course.id);
	const { response } = await makeOpenResponse(
		course.id,
		[question.slug],
		author.username,
	);
	const submission = await persistedSubmissionFactory.create({
		response: { publicId: response.publicId },
		question: question.slug,
	});

	for (const actor of [author, instructor, SYSTEM] as Actor[]) {
		const found = await db.submission.findOne(
			{ publicId: submission.publicId },
			{ actor },
		);
		expect(found?.publicId).toBe(submission.publicId);
	}

	for (const actor of [peer, otherInstructor, admin]) {
		expect(
			await db.submission.findOne({ publicId: submission.publicId }, { actor }),
		).toBeNull();
	}
});

test("update()/delete(): the author may read but not write, so gets NotAllowed; a peer, another instructor, and a non-owning admin cannot even read, so get NotFound", async () => {
	const { course } = await makeCourse();
	const author = await enrollStudent(course.id);
	const peer = await enrollStudent(course.id);
	const { instructor: otherInstructor } = await makeCourse();
	const admin = await persistedUserFactory.create({ role: "ADMIN" });
	const question = await makeQuestion(course.id);
	const { response } = await makeOpenResponse(
		course.id,
		[question.slug],
		author.username,
	);
	const submission = await persistedSubmissionFactory.create({
		response: { publicId: response.publicId },
		question: question.slug,
	});

	await expect(
		db.submission.update(
			{ publicId: submission.publicId },
			{ status: "WILL_NOT_GRADE" },
			{ actor: author },
		),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.submission.delete({ publicId: submission.publicId }, { actor: author }),
	).rejects.toBeInstanceOf(NotAllowed);

	for (const actor of [peer, otherInstructor, admin]) {
		await expect(
			db.submission.update(
				{ publicId: submission.publicId },
				{ status: "WILL_NOT_GRADE" },
				{ actor },
			),
		).rejects.toBeInstanceOf(NotFound);
		await expect(
			db.submission.delete({ publicId: submission.publicId }, { actor }),
		).rejects.toBeInstanceOf(NotFound);
	}

	expect(
		(
			await prisma.submission.findUniqueOrThrow({
				where: { id: submission.id },
			})
		).status,
	).toBe("PENDING_GRADE");
});

test("update()/delete(): the owning instructor and SYSTEM may write the submission", async () => {
	const { course, instructor } = await makeCourse();
	const author = await enrollStudent(course.id);
	const question = await makeQuestion(course.id);
	const { response } = await makeOpenResponse(
		course.id,
		[question.slug],
		author.username,
	);
	const submission = await persistedSubmissionFactory.create({
		response: { publicId: response.publicId },
		question: question.slug,
	});

	const graded = await db.submission.update(
		{ publicId: submission.publicId },
		{ status: "GRADED_AUTOMATICALLY" },
		{ actor: instructor },
	);
	expect(graded.status).toBe("GRADED_AUTOMATICALLY");

	await db.submission.delete({ publicId: submission.publicId }, FULL_ACCESS);
	expect(
		await prisma.submission.findUnique({ where: { id: submission.id } }),
	).toBeNull();
});

//
// create() access control, following R8: referencing an existing row by id is
// still a read. A peer naming another student's response publicId gets
// NotFound, indistinguishable from a publicId that names no row at all —
// otherwise the error itself would leak whether that response exists.
// NotAllowed is reserved for an actor who CAN read the response but may not
// write it, e.g. its author once no longer ACTIVE in the course.
//

test("create() is NotFound both for a response the actor may not read and for one that does not exist, indistinguishably", async () => {
	const { course } = await makeCourse();
	const author = await enrollStudent(course.id);
	const peer = await enrollStudent(course.id);
	const question = await makeQuestion(course.id);
	const { response } = await makeOpenResponse(
		course.id,
		[question.slug],
		author.username,
	);

	const unreadable = db.submission.create(
		{
			response: { publicId: response.publicId },
			question: question.slug,
			payload: { answer: 1 },
		},
		{ actor: peer },
	);
	const missing = db.submission.create(
		{
			response: { publicId: "no-such-response" },
			question: question.slug,
			payload: { answer: 1 },
		},
		{ actor: peer },
	);

	await expect(unreadable).rejects.toBeInstanceOf(NotFound);
	await expect(missing).rejects.toBeInstanceOf(NotFound);

	const [unreadableError, missingError] = await Promise.all([
		unreadable.catch((error) => error),
		missing.catch((error) => error),
	]);
	// Same status and code: nothing in the response tells a peer that one
	// publicId belongs to a real row and the other does not.
	expect(unreadableError).toMatchObject({
		status: missingError.status,
		code: missingError.code,
		resource: missingError.resource,
	});
});

test("create() refuses NotAllowed, not NotFound, for an actor who can read the response but not write it: its author once no longer ACTIVE in the course", async () => {
	const { course } = await makeCourse();
	const author = await enrollStudent(course.id);
	const question = await makeQuestion(course.id);
	const { response } = await makeOpenResponse(
		course.id,
		[question.slug],
		author.username,
	);

	await prisma.enrollment.update({
		where: {
			username_courseId: { username: author.username, courseId: course.id },
		},
		data: { status: "DROPPED" },
	});

	await expect(
		db.submission.create(
			{
				response: { publicId: response.publicId },
				question: question.slug,
				payload: { answer: 1 },
			},
			{ actor: author },
		),
	).rejects.toBeInstanceOf(NotAllowed);
});

//
// findMany() narrowing, mirroring R9 on the response side, plus the `practice` filter.
//

test("findMany(): a student is narrowed to their own submissions; naming another author is refused; an instructor of another course is refused outright; a non-owning admin sees none", async () => {
	const { course, instructor } = await makeCourse();
	const author = await enrollStudent(course.id);
	const peer = await enrollStudent(course.id);
	const { instructor: otherInstructor } = await makeCourse();
	const admin = await persistedUserFactory.create({ role: "ADMIN" });
	const question = await makeQuestion(course.id);
	const { response } = await makeOpenResponse(
		course.id,
		[question.slug],
		author.username,
	);
	await persistedSubmissionFactory.create({
		response: { publicId: response.publicId },
		question: question.slug,
	});

	const ownRows = await db.submission.findMany(
		{ course: course.id },
		{ actor: peer },
	);
	expect(ownRows).toHaveLength(0);

	await expect(
		db.submission.findMany(
			{ course: course.id, author: author.username },
			{ actor: peer },
		),
	).rejects.toBeInstanceOf(NotAllowed);

	await expect(
		db.submission.findMany({ course: course.id }, { actor: otherInstructor }),
	).rejects.toBeInstanceOf(NotAllowed);

	const asAdmin = await db.submission.findMany(
		{ course: course.id },
		{ actor: admin },
	);
	expect(asAdmin).toHaveLength(0);

	const asAuthor = await db.submission.findMany(
		{ course: course.id },
		{ actor: author },
	);
	expect(asAuthor).toHaveLength(1);

	const asInstructor = await db.submission.findMany(
		{ course: course.id },
		{ actor: instructor },
	);
	expect(asInstructor).toHaveLength(1);
});

test("findMany() with practice narrows to submissions made in a PRACTICE exam", async () => {
	const { course, instructor } = await makeCourse();
	const gradedQuestion = await makeQuestion(course.id);
	const practiceQuestion = await makeQuestion(course.id);
	const author = await enrollStudent(course.id);

	const { response: gradedResponse } = await makeOpenResponse(
		course.id,
		[gradedQuestion.slug],
		author.username,
		{ type: "EXAM" },
	);
	await persistedSubmissionFactory.create({
		response: { publicId: gradedResponse.publicId },
		question: gradedQuestion.slug,
	});

	const { response: practiceResponse } = await makeOpenResponse(
		course.id,
		[practiceQuestion.slug],
		author.username,
		{ type: "PRACTICE" },
	);
	await persistedSubmissionFactory.create({
		response: { publicId: practiceResponse.publicId },
		question: practiceQuestion.slug,
	});

	const onlyPractice = await db.submission.findMany(
		{ course: course.id, practice: true },
		{ actor: instructor },
	);
	expect(onlyPractice.map((s) => s.responseId)).toEqual([practiceResponse.id]);

	const onlyGraded = await db.submission.findMany(
		{ course: course.id, practice: false },
		{ actor: instructor },
	);
	expect(onlyGraded.map((s) => s.responseId)).toEqual([gradedResponse.id]);
});
