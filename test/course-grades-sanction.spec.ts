import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { idempotenceEssay } from "@/mdq/fixtures";
import { loadCourseGrades } from "@/utils/course-grades";
import {
	actorOf,
	enroll,
	makeCourse,
	makeExam,
	tag,
} from "./conditional-write-exam-support";

/// A closed exam of one essay question, answered by two students: one still waiting for a grade, one graded 1.
async function setup() {
	const { course, instructor } = await makeCourse();
	const question = await db.question.create(
		{
			course: course.id,
			slug: tag("q-"),
			status: "PUBLISHED",
			version: "1",
			question: idempotenceEssay,
		},
		FULL_ACCESS,
	);
	const exam = await makeExam(course.id, {
		questions: [{ slug: question.slug }],
	});
	const answerAs = async (graded: boolean) => {
		const student = await enroll(course.id);
		const response = await db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: question.slug,
				payload: "An answer.",
			},
			actorOf(student),
		);
		if (graded) {
			await db.feedback.create(
				{
					submission: {
						publicId: response.submissions.at(-1)?.publicId ?? "",
					},
					ref: "pass-1",
					score: "1",
					grader: instructor.username,
				},
				FULL_ACCESS,
			);
		}
		return student;
	};
	const pending = await answerAs(false);
	const graded = await answerAs(true);
	return { course, instructor, exam, pending, graded };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

function sanction(ctx: Ctx, username: string) {
	return db.examAdjustment.create(
		{
			course: ctx.course.id,
			exam: ctx.exam.slug,
			usernames: [username],
			op: "FACTOR",
			value: "0",
			reason: "copied",
		},
		actorOf(ctx.instructor),
	);
}

/// The cell of `username` on the setup's exam, as the course's grades report reads it.
async function cellOf(ctx: Ctx, username: string) {
	const report = await loadCourseGrades(
		ctx.course.id,
		actorOf(ctx.instructor).actor,
		new Date(),
	);
	return report.students.find((row) => row.username === username)?.results[
		ctx.exam.slug
	];
}

test("the cell of a zeroed student is a total of 0 carrying the sanction, and a revoked one changes nothing", async () => {
	const ctx = await setup();
	await prisma.exam.update({
		where: { id: ctx.exam.id },
		data: { status: "COMPLETED" },
	});
	expect(await cellOf(ctx, ctx.pending.username)).toMatchObject({
		kind: "pending",
	});
	await sanction(ctx, ctx.pending.username);
	const [revoked] = await sanction(ctx, ctx.graded.username);
	await db.examAdjustment.revoke(
		{
			course: ctx.course.id,
			exam: ctx.exam.slug,
			publicId: revoked?.publicId ?? "",
		},
		actorOf(ctx.instructor),
	);

	const zeroed = await cellOf(ctx, ctx.pending.username);
	const untouched = await cellOf(ctx, ctx.graded.username);

	expect(zeroed).toMatchObject({
		kind: "total",
		total: 0,
		sanction: { factor: 0, reason: "copied" },
	});
	expect(untouched).toMatchObject({ kind: "total", total: 1 });
	expect(untouched).not.toHaveProperty("sanction");
});

test("a BOT key of the instructor reads the sanctioned cell without error", async () => {
	const ctx = await setup();
	await prisma.exam.update({
		where: { id: ctx.exam.id },
		data: { status: "COMPLETED" },
	});
	await sanction(ctx, ctx.pending.username);
	const bot = { ...actorOf(ctx.instructor).actor, bot: "runner" };

	const report = await loadCourseGrades(ctx.course.id, bot, new Date());

	expect(
		report.students.find((row) => row.username === ctx.pending.username)
			?.results[ctx.exam.slug],
	).toMatchObject({ kind: "total", total: 0 });
});
