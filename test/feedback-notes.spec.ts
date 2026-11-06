import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedEditionFactory } from "@/fixtures/edition.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedSubmissionFactory } from "@/fixtures/submission.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";

/// `Feedback.notes` is for the instructor: the service writes and returns it to them and never to a student.

const SECRET = "possible plagiarism: identical to a known answer";

async function setup() {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	const edition = await persistedEditionFactory.create();
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: edition.slug,
	});
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const question = await persistedQuestionFactory.create({ course: course.id });
	const exam = await persistedExamFactory.create({
		course: course.id,
		status: "ONGOING",
		type: "EXAM",
		questions: [{ slug: question.slug }],
	});
	const response = await persistedResponseFactory.create({
		course: course.id,
		exam: exam.slug,
		author: student.username,
	});
	const submission = await persistedSubmissionFactory.create({
		response: { publicId: response.publicId },
		question: question.slug,
	});
	return {
		instructor,
		student,
		course,
		exam,
		key: { submission: { publicId: submission.publicId }, ref: "pass-1" },
	};
}

async function release(ctx: Awaited<ReturnType<typeof setup>>) {
	await prisma.exam.update({
		where: { id: ctx.exam.id },
		data: { status: "COMPLETED" },
	});
	await db.exam.releaseGrades(
		{ course: ctx.course.id, slug: ctx.exam.slug },
		{ actor: ctx.instructor },
	);
}

test("create() stores notes and the instructor reads them back from create, findOne and findMany", async () => {
	const ctx = await setup();

	const created = await db.feedback.create(
		{ ...ctx.key, score: "1", notes: SECRET },
		{ actor: ctx.instructor },
	);

	expect(created.notes).toBe(SECRET);
	const one = await db.feedback.findOne(ctx.key, { actor: ctx.instructor });
	expect(one?.notes).toBe(SECRET);
	const many = await db.feedback.findMany(
		{ course: ctx.course.id, exam: ctx.exam.slug },
		{ actor: ctx.instructor },
	);
	expect(many.map((f) => f.notes)).toEqual([SECRET]);
});

test("notes default to null when not given, and update() sets and clears them", async () => {
	const ctx = await setup();
	const created = await db.feedback.create(
		{ ...ctx.key, score: "1" },
		{ actor: ctx.instructor },
	);
	expect(created.notes).toBeNull();

	const set = await db.feedback.update(
		ctx.key,
		{ notes: SECRET },
		{ actor: ctx.instructor },
	);
	expect(set.notes).toBe(SECRET);

	const untouched = await db.feedback.update(
		ctx.key,
		{ score: "1/2" },
		{ actor: ctx.instructor },
	);
	expect(untouched.notes).toBe(SECRET);

	const cleared = await db.feedback.update(
		ctx.key,
		{ notes: null },
		{ actor: ctx.instructor },
	);
	expect(cleared.notes).toBeNull();
});

test("SYSTEM acting as a bot can record notes", async () => {
	const ctx = await setup();
	const created = await db.feedback.create(
		{ ...ctx.key, score: "0", bot: "runner", notes: SECRET },
		FULL_ACCESS,
	);
	expect(created.notes).toBe(SECRET);
});

test("a student reading released feedback gets the score and comment but no notes, from findOne and findMany", async () => {
	const ctx = await setup();
	await db.feedback.create(
		{ ...ctx.key, score: "1", feedback: "Well done", notes: SECRET },
		{ actor: ctx.instructor },
	);
	await release(ctx);

	const one = await db.feedback.findOne(ctx.key, { actor: ctx.student });
	expect(one?.feedback).toBe("Well done");
	expect(one).not.toHaveProperty("notes");
	expect(JSON.stringify(one)).not.toContain(SECRET);

	const many = await db.feedback.findMany(
		{ course: ctx.course.id, exam: ctx.exam.slug },
		{ actor: ctx.student },
	);
	expect(many).toHaveLength(1);
	expect(many[0]).not.toHaveProperty("notes");
	expect(JSON.stringify(many)).not.toContain(SECRET);
});

test("a student cannot write notes: create and update are refused", async () => {
	const ctx = await setup();
	await db.feedback.create(
		{ ...ctx.key, score: "1" },
		{ actor: ctx.instructor },
	);
	await release(ctx);

	await expect(
		db.feedback.update(ctx.key, { notes: "mine" }, { actor: ctx.student }),
	).rejects.toThrow();
	await expect(
		db.feedback.create(
			{ ...ctx.key, ref: "pass-2", score: "1", notes: "mine" },
			{ actor: ctx.student },
		),
	).rejects.toThrow();
	const stored = await prisma.feedback.findMany({
		where: { submission: { publicId: ctx.key.submission.publicId } },
	});
	expect(stored).toHaveLength(1);
});
