/**
 * The per-exam answer-history switch (spec
 * `dev/specs/to-do/historico-de-edicao-no-servidor.md`, R30): the effective
 * value by exam type, and the fact that only the server sets it.
 */

import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { examCreate, examSchema, examUpdate } from "@/core/schemas";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { effectiveAnswerHistory } from "@/services/answer-history";

const TYPES = ["PRACTICE", "QUIZ", "EXAM"] as const;
const FLAGS = [null, true, false] as const;

for (const type of TYPES) {
	for (const answerHistory of FLAGS) {
		test(`${type} with answerHistory ${answerHistory} resolves as documented`, () => {
			const expected = answerHistory ?? type !== "PRACTICE";
			expect(effectiveAnswerHistory({ type, answerHistory })).toBe(expected);
		});
	}
}

test("an exam reads back answerHistory as null until someone sets it", async () => {
	const exam = await persistedExamFactory.create();

	expect(exam.answerHistory).toBeNull();
	expect(examSchema.shape).toHaveProperty("answerHistory");
});

test("neither examCreate nor examUpdate accepts answerHistory", () => {
	expect(examCreate.shape).not.toHaveProperty("answerHistory");
	expect(examUpdate.shape).not.toHaveProperty("answerHistory");
});

test("ExamService.update leaves the switch alone even when handed one", async () => {
	const exam = await persistedExamFactory.create();
	await prisma.exam.update({
		where: { id: exam.id },
		data: { answerHistory: false },
	});

	// The schema strips the key, the way the REST layer hands the body over.
	const patch = examUpdate.parse({ title: "Renamed", answerHistory: true });
	const updated = await db.exam.update({ id: exam.id }, patch, FULL_ACCESS);

	expect(updated.title).toBe("Renamed");
	expect(updated.answerHistory).toBe(false);
});

test("ExamService.create ignores answerHistory", async () => {
	const course = await persistedCourseFactory.create();
	const created = await db.exam.create(
		examCreate.parse({
			course: course.id,
			slug: "no-switch",
			title: "T",
			answerHistory: true,
		}),
		FULL_ACCESS,
	);

	expect(created.answerHistory).toBeNull();
});
