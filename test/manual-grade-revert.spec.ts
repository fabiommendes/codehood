import { expect, test } from "@playwright/test";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import { scoreValue } from "@/core/score";
import { db } from "@/db";
import { prisma } from "@/db/client";
import {
	type GradingPass,
	isManualChange,
	REVERT_REF_PREFIX,
} from "@/services/grading";
import {
	actorOf,
	enroll,
	makeCourse,
	makeExam,
	makeQuestion,
} from "./conditional-write-exam-support";

// `manualGrade.revert`: "Desfazer", the pass that takes an answer back to its automatic score without erasing history.

/// A closed exam with a student who answered `q1` (graded automatically at 0.5) and left `q2` blank.
async function setup() {
	const { course, instructor } = await makeCourse();
	const q1 = await makeQuestion(course.id);
	const q2 = await makeQuestion(course.id);
	const exam = await makeExam(course.id, {
		duration: { minutes: 60 },
		questions: [{ slug: q1.slug }, { slug: q2.slug }],
	});
	const student = await enroll(course.id);
	await db.response.submit(
		{
			course: course.id,
			exam: exam.slug,
			question: q1.slug,
			payload: "my answer",
		},
		{ actor: student },
	);
	await db.response.finish(
		{ course: course.id, exam: exam.slug },
		{ actor: student },
	);
	await prisma.exam.update({
		where: { id: exam.id },
		data: { status: "COMPLETED" },
	});
	// The student's last submission of `q1`: the one that counts.
	const stored = await prisma.submission.findFirstOrThrow({
		where: { response: { examId: exam.id }, question: { slug: q1.slug } },
		orderBy: { id: "desc" },
	});
	// The server's own pass: no grader, no bot.
	await prisma.feedback.create({
		data: {
			submissionId: stored.id,
			ref: "auto-1",
			score: "0.5",
			graderId: null,
			botId: null,
		},
	});
	return {
		course,
		instructor,
		student,
		q1,
		q2,
		exam,
		as: actorOf(instructor),
		answer: stored.publicId,
	};
}

type Ctx = Awaited<ReturnType<typeof setup>>;

/// The instructor changes the grade of a student's answer by hand.
function change(ctx: Ctx, score: string) {
	return db.feedback.create(
		{
			submission: { publicId: ctx.answer, course: ctx.course.id },
			ref: `web-${Math.random().toString(36).slice(2)}`,
			score,
		},
		ctx.as,
	);
}

function revert(ctx: Ctx, submission = ctx.answer, as = ctx.as) {
	return db.manualGrade.revert(
		{ course: ctx.course.id, exam: ctx.exam.slug, submission },
		as,
	);
}

/// The passes of a submission, oldest first.
async function passesOf(publicId: string) {
	return prisma.feedback.findMany({
		where: { submission: { publicId } },
		orderBy: [{ createdAt: "asc" }, { id: "asc" }],
	});
}

/// The passes as the grading pages read them, oldest first.
async function gradingPasses(publicId: string): Promise<GradingPass[]> {
	return (await passesOf(publicId)).map((f) => ({
		score: scoreValue(f.score),
		comment: f.feedback,
		grader: f.graderId,
		bot: f.botId,
		willNotGrade: false,
		ref: f.ref,
		updatedAt: f.updatedAt,
	}));
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

/// An instructor-created blank answer, graded 1 by hand.
async function blankGrade(ctx: Ctx, score = "1") {
	return db.manualGrade.gradeUnanswered(
		{
			course: ctx.course.id,
			exam: ctx.exam.slug,
			author: ctx.student.username,
			question: ctx.q2.slug,
			score,
		},
		ctx.as,
	);
}

//
// Happy paths
//

test("revert: after a change by hand, the newest pass has the revert ref and the automatic score", async () => {
	const ctx = await setup();
	await change(ctx, "1");

	await revert(ctx);

	const passes = await passesOf(ctx.answer);
	const newest = passes.at(-1);
	expect(newest?.ref.startsWith(REVERT_REF_PREFIX)).toBe(true);
	expect(newest?.graderId).toBe(ctx.instructor.username);
	expect(scoreValue(newest?.score ?? "")).toBe(0.5);
});

test("revert: the answer stops being a change by hand", async () => {
	const ctx = await setup();
	await change(ctx, "1");
	expect(isManualChange(await gradingPasses(ctx.answer), null)).toBe(true);

	await revert(ctx);

	expect(isManualChange(await gradingPasses(ctx.answer), null)).toBe(false);
});

test("revert: the history stays, one pass is added and none is deleted", async () => {
	const ctx = await setup();
	const manual = await change(ctx, "1");
	const before = await passesOf(ctx.answer);

	await revert(ctx);

	const after = await passesOf(ctx.answer);
	expect(after).toHaveLength(before.length + 1);
	expect(after.slice(0, before.length).map((p) => p.ref)).toEqual(
		before.map((p) => p.ref),
	);
	expect(after.map((p) => p.ref)).toContain(manual.ref);
});

test("revert: returns the answer's submission", async () => {
	const ctx = await setup();
	await change(ctx, "1");

	const result = await revert(ctx);

	expect(result.publicId).toBe(ctx.answer);
});

test("revert: a change written after a revert is a change again, and reverts again", async () => {
	const ctx = await setup();
	await change(ctx, "1");
	await revert(ctx);
	await change(ctx, "0.25");
	expect(isManualChange(await gradingPasses(ctx.answer), null)).toBe(true);

	await revert(ctx);

	const passes = await passesOf(ctx.answer);
	expect(passes).toHaveLength(5);
	expect(
		passes.filter((p) => p.ref.startsWith(REVERT_REF_PREFIX)),
	).toHaveLength(2);
	expect(scoreValue(passes.at(-1)?.score ?? "")).toBe(0.5);
	expect(isManualChange(await gradingPasses(ctx.answer), null)).toBe(false);
});

test("revert: two reverts never share a ref", async () => {
	const ctx = await setup();
	await change(ctx, "1");
	await revert(ctx);
	await change(ctx, "0");
	await revert(ctx);

	const refs = (await passesOf(ctx.answer))
		.filter((p) => p.ref.startsWith(REVERT_REF_PREFIX))
		.map((p) => p.ref);
	expect(new Set(refs).size).toBe(2);
});

test("revert: on an answer the instructor created, the revert pass gives 0 and the change is undone", async () => {
	const ctx = await setup();
	const blank = await blankGrade(ctx, "1");
	expect(
		isManualChange(
			await gradingPasses(blank.publicId),
			ctx.instructor.username,
		),
	).toBe(true);

	await revert(ctx, blank.publicId);

	const passes = await passesOf(blank.publicId);
	expect(passes).toHaveLength(2);
	expect(passes.at(-1)?.ref.startsWith(REVERT_REF_PREFIX)).toBe(true);
	expect(scoreValue(passes.at(-1)?.score ?? "")).toBe(0);
	expect(
		isManualChange(
			await gradingPasses(blank.publicId),
			ctx.instructor.username,
		),
	).toBe(false);
	// The submission stays: nothing is deleted.
	expect(
		await prisma.submission.count({ where: { publicId: blank.publicId } }),
	).toBe(1);
});

//
// Refusals: each leaves the passes as they were
//

test("revert: a student is refused, even on their own answer", async () => {
	const ctx = await setup();
	await change(ctx, "1");
	const before = await passesOf(ctx.answer);

	const error = await refusal(revert(ctx, ctx.answer, actorOf(ctx.student)));

	expect(error).toBeInstanceOf(NotAllowed);
	expect(await passesOf(ctx.answer)).toHaveLength(before.length);
});

test("revert: an instructor of another course is refused", async () => {
	const ctx = await setup();
	await change(ctx, "1");
	const before = await passesOf(ctx.answer);
	const other = await makeCourse();

	const error = await refusal(
		revert(ctx, ctx.answer, actorOf(other.instructor)),
	);

	expect(error).toBeInstanceOf(NotAllowed);
	expect(await passesOf(ctx.answer)).toHaveLength(before.length);
});

test("revert: an answer that was not changed by hand is refused on submission", async () => {
	const ctx = await setup();
	const before = await passesOf(ctx.answer);

	const error = await refusal(revert(ctx));

	expect(error).toBeInstanceOf(InvalidData);
	expect((error as InvalidData).errors).toHaveProperty("submission");
	expect(await passesOf(ctx.answer)).toHaveLength(before.length);
});

test("revert: an answer already reverted is refused and writes no second revert", async () => {
	const ctx = await setup();
	await change(ctx, "1");
	await revert(ctx);
	const before = await passesOf(ctx.answer);

	const error = await refusal(revert(ctx));

	expect(error).toBeInstanceOf(InvalidData);
	expect((error as InvalidData).errors).toHaveProperty("submission");
	expect(await passesOf(ctx.answer)).toHaveLength(before.length);
});

test("revert: a first human pass on a student's answer is a plain correction, so it is refused", async () => {
	const ctx = await setup();
	await prisma.feedback.deleteMany({
		where: { submission: { publicId: ctx.answer } },
	});
	await change(ctx, "1");
	const before = await passesOf(ctx.answer);

	const error = await refusal(revert(ctx));

	expect(error).toBeInstanceOf(InvalidData);
	expect(await passesOf(ctx.answer)).toHaveLength(before.length);
});

test("revert: a submission that does not exist is not found", async () => {
	const ctx = await setup();

	const error = await refusal(revert(ctx, "no-such-submission"));

	expect(error).toBeInstanceOf(NotFound);
});

test("revert: a submission of another exam of the course is not found, and left alone", async () => {
	const ctx = await setup();
	await change(ctx, "1");
	const before = await passesOf(ctx.answer);
	const otherExam = await makeExam(ctx.course.id, {
		status: "COMPLETED",
		questions: [{ slug: ctx.q1.slug }],
	});

	const error = await refusal(
		db.manualGrade.revert(
			{
				course: ctx.course.id,
				exam: otherExam.slug,
				submission: ctx.answer,
			},
			ctx.as,
		),
	);

	expect(error).toBeInstanceOf(NotFound);
	expect(await passesOf(ctx.answer)).toHaveLength(before.length);
});
