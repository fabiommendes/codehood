import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import { scoreValue } from "@/core/score";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedUserFactory } from "@/fixtures/user.factory";
import {
	actorOf,
	enroll,
	makeCourse,
	makeExam,
	makeQuestion,
} from "./conditional-write-exam-support";

// `manualGrade.gradeUnanswered`: the instructor's grade for a question the student left unanswered.

const HOUR = 60 * 60_000;

type ExamStatus = "ONGOING" | "COMPLETED" | "DRAFT" | "SCHEDULED";

/// A course with an instructor and an exam of two questions, `COMPLETED` unless `fields` say otherwise.
async function setup(
	fields: Partial<Parameters<typeof makeExam>[1]> = {},
	status: ExamStatus = "COMPLETED",
) {
	const { course, instructor } = await makeCourse();
	const q1 = await makeQuestion(course.id);
	const q2 = await makeQuestion(course.id);
	const exam = await makeExam(course.id, {
		status,
		// An exception that moves the date needs an exam with a duration.
		duration: { minutes: 60 },
		questions: [{ slug: q1.slug }, { slug: q2.slug }],
		...fields,
	});
	return { course, instructor, q1, q2, exam, as: actorOf(instructor) };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

/// The student answers `question` while the exam is open, then delivers the attempt.
async function deliver(
	ctx: Ctx,
	student: Awaited<ReturnType<typeof enroll>>,
	question: string,
) {
	await db.response.submit(
		{
			course: ctx.course.id,
			exam: ctx.exam.slug,
			question,
			payload: "my answer",
		},
		{ actor: student },
	);
	await db.response.finish(
		{ course: ctx.course.id, exam: ctx.exam.slug },
		{ actor: student },
	);
}

/// Closes the exam for everyone, as an instructor does when the sitting is over.
function complete(ctx: Ctx) {
	return prisma.exam.update({
		where: { id: ctx.exam.id },
		data: { status: "COMPLETED" },
	});
}

function grade(
	ctx: Ctx,
	author: string,
	extra: Partial<Parameters<typeof db.manualGrade.gradeUnanswered>[0]> = {},
	as: ReturnType<typeof actorOf> = ctx.as,
) {
	return db.manualGrade.gradeUnanswered(
		{
			course: ctx.course.id,
			exam: ctx.exam.slug,
			author,
			question: ctx.q1.slug,
			score: "0.5",
			...extra,
		},
		as,
	);
}

/// What "nothing written" is measured on.
async function rows(ctx: Ctx) {
	return {
		responses: await prisma.response.count({ where: { examId: ctx.exam.id } }),
		submissions: await prisma.submission.count({
			where: { response: { examId: ctx.exam.id } },
		}),
		feedbacks: await prisma.feedback.count({
			where: { submission: { response: { examId: ctx.exam.id } } },
		}),
	};
}

/// The error a promise is refused with, failing the test if it resolves.
async function refusal(attempted: Promise<unknown>): Promise<unknown> {
	const error = await attempted.then(
		() => null,
		(e: unknown) => e,
	);
	expect(error).not.toBeNull();
	return error;
}

/// The `InvalidData` a promise is refused with.
async function invalid(attempted: Promise<unknown>): Promise<InvalidData> {
	const error = await refusal(attempted);
	expect(error).toBeInstanceOf(InvalidData);
	return error as InvalidData;
}

//
// Happy paths
//

test("gradeUnanswered: a delivered attempt without an answer gets an instructor submission with a null payload and a manual pass", async () => {
	const ctx = await setup({}, "ONGOING");
	const student = await enroll(ctx.course.id);
	await deliver(ctx, student, ctx.q2.slug);
	await complete(ctx);

	const created = await grade(ctx, student.username, {
		score: "0.75",
		comment: "wrote it on the board",
	});

	expect(created).toMatchObject({
		kind: "AUTOSAVE",
		status: "GRADED_MANUALLY",
		payload: null,
		createdBy: ctx.instructor.username,
		question: ctx.q1.slug,
	});
	const stored = await prisma.submission.findFirst({
		where: { publicId: created.publicId },
		include: { feedbacks: true },
	});
	// The JSON `null` survives a round trip through the column.
	expect(stored?.payload).toBeNull();
	expect(stored?.createdById).toBe(ctx.instructor.username);
	expect(stored?.feedbacks).toHaveLength(1);
	expect(stored?.feedbacks[0]).toMatchObject({
		graderId: ctx.instructor.username,
		botId: null,
		feedback: "wrote it on the board",
	});
	expect(scoreValue(stored?.feedbacks[0]?.score ?? "")).toBe(0.75);
});

test("gradeUnanswered: the student's own attempt is reused, still the student's, and no other attempt appears", async () => {
	const ctx = await setup({}, "ONGOING");
	const student = await enroll(ctx.course.id);
	await deliver(ctx, student, ctx.q2.slug);
	await complete(ctx);
	const before = await rows(ctx);

	await grade(ctx, student.username);

	const after = await rows(ctx);
	expect(after.responses).toBe(before.responses);
	expect(after.submissions).toBe(before.submissions + 1);
	const response = await prisma.response.findFirst({
		where: { examId: ctx.exam.id, authorId: student.username },
	});
	expect(response?.createdById).toBeNull();
});

test("gradeUnanswered: the attempt's updatedAt advances, so a conditional write on it sees the grade", async () => {
	const ctx = await setup({}, "ONGOING");
	const student = await enroll(ctx.course.id);
	await deliver(ctx, student, ctx.q2.slug);
	await complete(ctx);
	const before = await prisma.response.findFirstOrThrow({
		where: { examId: ctx.exam.id, authorId: student.username },
	});
	await new Promise((resolve) => setTimeout(resolve, 20));

	await grade(ctx, student.username);

	const after = await prisma.response.findFirstOrThrow({
		where: { examId: ctx.exam.id, authorId: student.username },
	});
	expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
});

test("gradeUnanswered: a student without an attempt gets a closed, empty one made by the instructor", async () => {
	const ctx = await setup();
	const student = await enroll(ctx.course.id);

	const created = await grade(ctx, student.username, { score: "1" });

	const response = await prisma.response.findFirst({
		where: { examId: ctx.exam.id, authorId: student.username },
		include: { submissions: true },
	});
	expect(response).toMatchObject({
		acceptingSubmissions: false,
		slotKey: 0,
		preview: false,
		createdById: ctx.instructor.username,
	});
	expect(response?.closedAt).toBeInstanceOf(Date);
	expect(response?.submissions.map((s) => s.publicId)).toEqual([
		created.publicId,
	]);
	expect(created.createdBy).toBe(ctx.instructor.username);
});

test("gradeUnanswered: never writes a SUBMIT or FINAL submission", async () => {
	const ctx = await setup();
	const student = await enroll(ctx.course.id);

	await grade(ctx, student.username);

	const kinds = await prisma.submission.findMany({
		where: { response: { examId: ctx.exam.id } },
		select: { kind: true },
	});
	expect(kinds).toEqual([{ kind: "AUTOSAVE" }]);
});

test("gradeUnanswered: an exception for another student does not hold the grade back", async () => {
	const ctx = await setup();
	const ana = await enroll(ctx.course.id);
	const bia = await enroll(ctx.course.id);
	await db.examException.create(
		{
			course: ctx.course.id,
			exam: ctx.exam.slug,
			username: bia.username,
			scheduledAt: new Date(Date.now() + 48 * HOUR),
		},
		FULL_ACCESS,
	);

	await grade(ctx, ana.username);

	expect(await rows(ctx)).toMatchObject({ responses: 1, submissions: 1 });
});

test("gradeUnanswered: an archived exam is closed for the student, so it takes the grade", async () => {
	const ctx = await setup({}, "COMPLETED");
	const student = await enroll(ctx.course.id);
	await prisma.exam.update({
		where: { id: ctx.exam.id },
		data: { status: "ARCHIVED" },
	});

	await grade(ctx, student.username);

	expect(await rows(ctx)).toMatchObject({ responses: 1, submissions: 1 });
});

//
// Refusals: each leaves no attempt, submission or pass behind
//

const NOTHING = { responses: 0, submissions: 0, feedbacks: 0 };

test("gradeUnanswered: an open exam is refused on author", async () => {
	const ctx = await setup({}, "ONGOING");
	const student = await enroll(ctx.course.id);

	const error = await invalid(grade(ctx, student.username));

	expect(error.errors).toHaveProperty("author");
	expect(await rows(ctx)).toEqual(NOTHING);
});

test("gradeUnanswered: an exam that has not opened is refused on author", async () => {
	const ctx = await setup(
		{ scheduledAt: new Date(Date.now() + 48 * HOUR) },
		"SCHEDULED",
	);
	const student = await enroll(ctx.course.id);

	const error = await invalid(grade(ctx, student.username));

	expect(error.errors).toHaveProperty("author");
	expect(await rows(ctx)).toEqual(NOTHING);
});

test("gradeUnanswered: a draft exam is refused on author", async () => {
	const ctx = await setup({}, "DRAFT");
	const student = await enroll(ctx.course.id);

	const error = await invalid(grade(ctx, student.username));

	expect(error.errors).toHaveProperty("author");
	expect(await rows(ctx)).toEqual(NOTHING);
});

test("gradeUnanswered: an exam still open for the student alone, by an exception, is refused on author", async () => {
	const ctx = await setup();
	const student = await enroll(ctx.course.id);
	// A makeup that began 10 minutes ago on a 60 minute exam: open for them only.
	await db.examException.create(
		{
			course: ctx.course.id,
			exam: ctx.exam.slug,
			username: student.username,
			scheduledAt: new Date(Date.now() - 10 * 60_000),
		},
		FULL_ACCESS,
	);

	const error = await invalid(grade(ctx, student.username));

	expect(error.errors).toHaveProperty("author");
	expect(await rows(ctx)).toEqual(NOTHING);
});

test("gradeUnanswered: an exam not yet open for the student alone, by an exception, is refused on author", async () => {
	const ctx = await setup();
	const student = await enroll(ctx.course.id);
	await db.examException.create(
		{
			course: ctx.course.id,
			exam: ctx.exam.slug,
			username: student.username,
			scheduledAt: new Date(Date.now() + 48 * HOUR),
		},
		FULL_ACCESS,
	);

	const error = await invalid(grade(ctx, student.username));

	expect(error.errors).toHaveProperty("author");
	expect(await rows(ctx)).toEqual(NOTHING);
});

test("gradeUnanswered: a PRACTICE exam is refused on author", async () => {
	const ctx = await setup({ type: "PRACTICE" });
	const student = await enroll(ctx.course.id);

	const error = await invalid(grade(ctx, student.username));

	expect(error.errors).toHaveProperty("author");
	expect(await rows(ctx)).toEqual(NOTHING);
});

test("gradeUnanswered: a user who is not enrolled is refused on author", async () => {
	const ctx = await setup();
	const stranger = await persistedUserFactory.create({ role: "STUDENT" });

	const error = await invalid(grade(ctx, stranger.username));

	expect(error.errors).toHaveProperty("author");
	expect(await rows(ctx)).toEqual(NOTHING);
});

test("gradeUnanswered: an attempt still in progress is refused on author", async () => {
	const ctx = await setup({}, "ONGOING");
	const student = await enroll(ctx.course.id);
	await db.response.submit(
		{
			course: ctx.course.id,
			exam: ctx.exam.slug,
			question: ctx.q2.slug,
			payload: "half way",
		},
		{ actor: student },
	);
	const before = await rows(ctx);

	const error = await invalid(grade(ctx, student.username));

	expect(error.errors).toHaveProperty("author");
	expect(await rows(ctx)).toEqual(before);
});

test("gradeUnanswered: a question the student already answered is refused on question", async () => {
	const ctx = await setup({}, "ONGOING");
	const student = await enroll(ctx.course.id);
	await deliver(ctx, student, ctx.q1.slug);
	await complete(ctx);
	const before = await rows(ctx);

	const error = await invalid(grade(ctx, student.username));

	expect(error.errors).toHaveProperty("question");
	expect(await rows(ctx)).toEqual(before);
});

test("gradeUnanswered: grading the same question twice refuses the second on question", async () => {
	const ctx = await setup();
	const student = await enroll(ctx.course.id);
	await grade(ctx, student.username);
	const before = await rows(ctx);

	const error = await invalid(grade(ctx, student.username, { score: "1" }));

	expect(error.errors).toHaveProperty("question");
	expect(await rows(ctx)).toEqual(before);
});

test("gradeUnanswered: a question the exam does not carry is not found, and nothing is written", async () => {
	const ctx = await setup();
	const student = await enroll(ctx.course.id);
	const outside = await makeQuestion(ctx.course.id);

	const error = await refusal(
		grade(ctx, student.username, { question: outside.slug }),
	);

	expect(error).toBeInstanceOf(NotFound);
	expect(await rows(ctx)).toEqual(NOTHING);
});

test("gradeUnanswered: a student actor is not allowed, and nothing is written", async () => {
	const ctx = await setup();
	const student = await enroll(ctx.course.id);

	const error = await refusal(
		grade(ctx, student.username, {}, actorOf(student)),
	);

	expect(error).toBeInstanceOf(NotAllowed);
	expect(await rows(ctx)).toEqual(NOTHING);
});

test("gradeUnanswered: the instructor of another course is not allowed, and nothing is written", async () => {
	const ctx = await setup();
	const student = await enroll(ctx.course.id);
	const other = await makeCourse();

	const error = await refusal(
		grade(ctx, student.username, {}, actorOf(other.instructor)),
	);

	expect(error).toBeInstanceOf(NotAllowed);
	expect(await rows(ctx)).toEqual(NOTHING);
});

//
// Score and atomicity
//

for (const [label, score] of [
	["above 1", "2"],
	["below 0", "-0.1"],
	["not a number", "great"],
	["empty", ""],
] as const) {
	test(`gradeUnanswered: a score ${label} is refused on score and leaves no empty attempt behind`, async () => {
		const ctx = await setup();
		const student = await enroll(ctx.course.id);

		const error = await invalid(grade(ctx, student.username, { score }));

		expect(error.errors).toHaveProperty("score");
		expect(await rows(ctx)).toEqual(NOTHING);
	});
}

for (const score of ["0", "1", "0.05"]) {
	test(`gradeUnanswered: the edge score ${score} is accepted`, async () => {
		const ctx = await setup();
		const student = await enroll(ctx.course.id);

		const created = await grade(ctx, student.username, { score });

		const pass = await prisma.feedback.findFirst({
			where: { submission: { publicId: created.publicId } },
		});
		expect(scoreValue(pass?.score ?? "")).toBe(Number(score));
	});
}
