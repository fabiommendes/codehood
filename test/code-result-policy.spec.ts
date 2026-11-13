import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { loadResultPolicy } from "@/db/result-policy";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { sumCode } from "@/mdq/fixtures";
import { examResult } from "@/services/exam-result";

// The result of a `code` question read through the services: the submissions
// of an attempt, the passes on them and the policy loaded from the course.

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

/// Sends pretest failure, 0.6 and 1.0 on a question with penalty 0.2, and returns the exam's result.
async function resultOf(type: "EXAM" | "PRACTICE", penalty = 0.2) {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: await ensureEdition(),
	});
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const slug = tag("code-");
	await db.question.create(
		{
			course: course.id,
			slug,
			status: "PUBLISHED",
			version: "1",
			rev: null,
			question: { ...sumCode, meta: { worker: "w", penalty } },
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: tag("exam-"),
		status: "ONGOING",
		type,
		questions: [{ slug }],
	});

	const scores: (string | null)[] = [null, "3/5", "1"];
	for (const [index, score] of scores.entries()) {
		await db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: slug,
				payload: `v${index}`,
				kind: "SUBMIT",
			},
			{ actor: student },
		);
		const row = await prisma.submission.findFirstOrThrow({
			where: {
				payload: { equals: `v${index}` },
				response: { examId: exam.id },
			},
		});
		await prisma.gradingJob.update({
			where: { submissionId: row.id },
			data: { state: "DONE" },
		});
		if (score === null) {
			await prisma.submission.update({
				where: { id: row.id },
				data: { status: "PRETEST_FAILED" },
			});
			continue;
		}
		await prisma.submission.update({
			where: { id: row.id },
			data: { status: "GRADED_AUTOMATICALLY" },
		});
		await prisma.feedback.create({
			data: { ref: "bot", submissionId: row.id, score, botId: "w" },
		});
	}
	// A later autosave must not hide the sends.
	await db.response.submit(
		{ course: course.id, exam: exam.slug, question: slug, payload: "typing" },
		{ actor: student },
	);

	const [attempt] = await db.response.findMany(
		{ course: course.id, exam: exam.slug },
		FULL_ACCESS,
	);
	const feedback = await db.feedback.findMany(
		{ course: course.id },
		FULL_ACCESS,
	);
	const policyOf = await loadResultPolicy(course.id);
	return examResult(
		[slug],
		attempt?.submissions ?? [],
		feedback,
		policyOf({ type }),
	);
}

test("penalty 0.2, failed pretest, 0.6 then 1.0 scores 0.8", async () => {
	const result = await resultOf("EXAM");
	expect(result.questions[0]).toMatchObject({ status: "graded", score: 0.8 });
	expect(result.total).toBe(0.8);
});

test("the penalty comes from the question", async () => {
	const result = await resultOf("EXAM", 0.5);
	expect(result.total).toBe(0.6);
});

test("a practice exam scores 1.0, with no discount", async () => {
	const result = await resultOf("PRACTICE");
	expect(result.total).toBe(1);
});
