import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData, NotAllowed } from "@/core/error";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import {
	actorOf,
	enroll,
	makeCourse,
	makeExam,
	makeQuestion,
} from "./conditional-write-exam-support";

// An adjustment for a student who did not take the exam makes the attempt it hangs on: an empty one.

const HOUR = 60 * 60_000;

type ExamStatus = "ONGOING" | "COMPLETED" | "DRAFT" | "SCHEDULED";

/// A course with an exam of one question, `COMPLETED` unless `fields` say otherwise.
async function setup(
	fields: Partial<Parameters<typeof makeExam>[1]> = {},
	status: ExamStatus = "COMPLETED",
) {
	const { course, instructor } = await makeCourse();
	const question = await makeQuestion(course.id);
	const exam = await makeExam(course.id, {
		status,
		// An exception that moves the date needs an exam with a duration.
		duration: { minutes: 60 },
		questions: [{ slug: question.slug }],
		...fields,
	});
	return { course, instructor, question, exam, as: actorOf(instructor) };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

/// Adjusts `usernames`: a bonus of ten points of the total unless `extra` says otherwise.
function adjust(
	ctx: Ctx,
	usernames: string[],
	extra: Partial<Parameters<typeof db.examAdjustment.create>[0]> = {},
	as: ReturnType<typeof actorOf> = ctx.as,
) {
	return db.examAdjustment.create(
		{
			course: ctx.course.id,
			exam: ctx.exam.slug,
			usernames,
			op: "OFFSET",
			value: "0.1",
			...extra,
		},
		as,
	);
}

/// What "nothing written" is measured on.
async function rows(ctx: Ctx) {
	return {
		responses: await prisma.response.count({ where: { examId: ctx.exam.id } }),
		adjustments: await prisma.examAdjustment.count({
			where: { response: { examId: ctx.exam.id } },
		}),
	};
}

const NOTHING = { responses: 0, adjustments: 0 };

/// The `InvalidData` a promise is refused with, failing the test if it resolves.
async function invalid(attempted: Promise<unknown>): Promise<InvalidData> {
	const error = await attempted.then(
		() => null,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(InvalidData);
	return error as InvalidData;
}

//
// create
//

test("create: a student who did not take the exam gets an empty attempt, closed and made by the instructor", async () => {
	const ctx = await setup();
	const student = await enroll(ctx.course.id);

	const [created] = await adjust(ctx, [student.username], {
		op: "SET",
		value: "0.8",
	});

	const response = await prisma.response.findFirst({
		where: { examId: ctx.exam.id, authorId: student.username },
		include: { submissions: true },
	});
	expect(response).toMatchObject({
		acceptingSubmissions: false,
		slotKey: 0,
		preview: false,
		createdById: ctx.instructor.username,
		submissions: [],
	});
	expect(response?.closedAt).toBeInstanceOf(Date);
	expect(created).toMatchObject({
		author: student.username,
		response: response?.publicId,
		op: "SET",
		value: "0.8",
	});
});

test("create: a student with an attempt keeps it, and no second one is made", async () => {
	const ctx = await setup({}, "ONGOING");
	const student = await enroll(ctx.course.id);
	const existing = await persistedResponseFactory.create({
		course: ctx.course.id,
		exam: ctx.exam.slug,
		author: student.username,
	});
	await prisma.exam.update({
		where: { id: ctx.exam.id },
		data: { status: "COMPLETED" },
	});

	const [created] = await adjust(ctx, [student.username]);

	expect(created?.response).toBe(existing.publicId);
	const all = await prisma.response.findMany({
		where: { examId: ctx.exam.id, authorId: student.username },
	});
	expect(all).toHaveLength(1);
	expect(all[0]?.createdById).toBeNull();
});

test("create: a batch mixes students with and without an attempt, in the order given", async () => {
	const ctx = await setup({}, "ONGOING");
	const ana = await enroll(ctx.course.id);
	const bia = await enroll(ctx.course.id);
	await persistedResponseFactory.create({
		course: ctx.course.id,
		exam: ctx.exam.slug,
		author: ana.username,
	});
	await prisma.exam.update({
		where: { id: ctx.exam.id },
		data: { status: "COMPLETED" },
	});

	const created = await adjust(ctx, [bia.username, ana.username]);

	expect(created.map((row) => row.author)).toEqual([
		bia.username,
		ana.username,
	]);
	expect((await rows(ctx)).responses).toBe(2);
});

test("create: one student the exam cannot be adjusted for refuses the batch, and no empty attempt of the others stays", async () => {
	const ctx = await setup();
	const ana = await enroll(ctx.course.id);
	const stranger = await persistedUserFactory.create({ role: "STUDENT" });

	const error = await invalid(adjust(ctx, [ana.username, stranger.username]));

	expect(error.errors.usernames?.[0]?.code).toBe("invalid");
	expect(await rows(ctx)).toEqual(NOTHING);
});

test("create: a user who is not enrolled and has no attempt is refused on usernames", async () => {
	const ctx = await setup();
	const stranger = await persistedUserFactory.create({ role: "STUDENT" });

	const error = await invalid(adjust(ctx, [stranger.username]));

	expect(error.errors).toHaveProperty("usernames");
	expect(await rows(ctx)).toEqual(NOTHING);
});

test("create: an open exam is refused on usernames for a student without an attempt", async () => {
	const ctx = await setup({}, "ONGOING");
	const student = await enroll(ctx.course.id);

	const error = await invalid(adjust(ctx, [student.username]));

	expect(error.errors).toHaveProperty("usernames");
	expect(await rows(ctx)).toEqual(NOTHING);
});

test("create: an exam that has not opened is refused on usernames for a student without an attempt", async () => {
	const ctx = await setup(
		{ scheduledAt: new Date(Date.now() + 48 * HOUR) },
		"SCHEDULED",
	);
	const student = await enroll(ctx.course.id);

	const error = await invalid(adjust(ctx, [student.username]));

	expect(error.errors).toHaveProperty("usernames");
	expect(await rows(ctx)).toEqual(NOTHING);
});

test("create: a draft exam is refused on usernames for a student without an attempt", async () => {
	const ctx = await setup({}, "DRAFT");
	const student = await enroll(ctx.course.id);

	const error = await invalid(adjust(ctx, [student.username]));

	expect(error.errors).toHaveProperty("usernames");
	expect(await rows(ctx)).toEqual(NOTHING);
});

test("create: an exam still open for the student alone, by an exception, is refused on usernames", async () => {
	const ctx = await setup();
	const student = await enroll(ctx.course.id);
	await db.examException.create(
		{
			course: ctx.course.id,
			exam: ctx.exam.slug,
			username: student.username,
			scheduledAt: new Date(Date.now() - HOUR),
		},
		FULL_ACCESS,
	);

	const error = await invalid(adjust(ctx, [student.username]));

	expect(error.errors).toHaveProperty("usernames");
	expect(await rows(ctx)).toEqual(NOTHING);
});

test("create: an exam not yet open for the student alone, by an exception, is refused on usernames", async () => {
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

	const error = await invalid(adjust(ctx, [student.username]));

	expect(error.errors).toHaveProperty("usernames");
	expect(await rows(ctx)).toEqual(NOTHING);
});

test("create: an exception of a classmate does not hold back a student who has none", async () => {
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

	const created = await adjust(ctx, [ana.username]);

	expect(created).toHaveLength(1);
});

test("create: a PRACTICE exam is refused and leaves no attempt", async () => {
	const ctx = await setup({ type: "PRACTICE" });
	const student = await enroll(ctx.course.id);

	const error = await invalid(adjust(ctx, [student.username]));

	expect(error.errors).toHaveProperty("exam");
	expect(await rows(ctx)).toEqual(NOTHING);
});

test("create: someone who is not the course's instructor is not allowed, and no attempt is made", async () => {
	const ctx = await setup();
	const student = await enroll(ctx.course.id);

	for (const actor of [
		actorOf(student),
		actorOf((await makeCourse()).instructor),
	]) {
		const refused = adjust(ctx, [student.username], {}, actor);
		await expect(refused).rejects.toBeInstanceOf(NotAllowed);
	}
	expect(await rows(ctx)).toEqual(NOTHING);
});

test("create: a second adjustment on the same empty attempt reuses it", async () => {
	const ctx = await setup();
	const student = await enroll(ctx.course.id);

	await adjust(ctx, [student.username]);
	await adjust(ctx, [student.username], { op: "FACTOR", value: "1.1" });

	expect(await rows(ctx)).toEqual({ responses: 1, adjustments: 2 });
});

//
// response.delete
//

test("response.delete: an empty attempt with an active adjustment is refused with 409, and goes once the adjustment is revoked", async () => {
	const ctx = await setup();
	const student = await enroll(ctx.course.id);
	const [created] = await adjust(ctx, [student.username]);
	const response = await prisma.response.findFirstOrThrow({
		where: { examId: ctx.exam.id, authorId: student.username },
	});

	const refused = db.response.delete({ publicId: response.publicId }, ctx.as);
	await expect(refused).rejects.toBeInstanceOf(NotAllowed);
	await expect(refused).rejects.toMatchObject({ status: 409 });
	expect((await rows(ctx)).responses).toBe(1);

	await db.examAdjustment.revoke(
		{
			course: ctx.course.id,
			exam: ctx.exam.slug,
			publicId: created?.publicId ?? "",
		},
		ctx.as,
	);
	await db.response.delete({ publicId: response.publicId }, ctx.as);

	expect((await rows(ctx)).responses).toBe(0);
});
