import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { NotAllowed, NotFound } from "@/core/error";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { effectiveAnswerHistory } from "@/services/answer-history";

// R30: the per-exam switch of the edit history, written only by
// `ExamService.setAnswerHistory` and only by whoever writes the course.

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function makeExam(type: "PRACTICE" | "QUIZ" | "EXAM" = "EXAM") {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
	});
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: tag("exam-"),
		type,
		status: "ONGOING",
	});
	return {
		instructor,
		course,
		student,
		exam,
		pk: { course: course.id, slug: exam.slug },
	};
}

async function stored(id: schema.ExamId): Promise<boolean | null> {
	const row = await prisma.exam.findUniqueOrThrow({ where: { id } });
	return row.answerHistory;
}

test("the owner stores an explicit value, true or false, in any exam type", async () => {
	for (const type of ["PRACTICE", "QUIZ", "EXAM"] as const) {
		const { instructor, exam, pk } = await makeExam(type);
		expect(await stored(exam.id)).toBeNull();

		const off = await db.exam.setAnswerHistory(pk, false, {
			actor: instructor,
		});
		expect(off.answerHistory).toBe(false);
		expect(effectiveAnswerHistory(off)).toBe(false);
		expect(await stored(exam.id)).toBe(false);

		const on = await db.exam.setAnswerHistory(pk, true, { actor: instructor });
		expect(on.answerHistory).toBe(true);
		expect(effectiveAnswerHistory(on)).toBe(true);
		expect(await stored(exam.id)).toBe(true);
	}
});

test("the default follows the type and an explicit value overrides it", async () => {
	const defaults = { PRACTICE: false, QUIZ: true, EXAM: true } as const;
	for (const type of ["PRACTICE", "QUIZ", "EXAM"] as const) {
		const { exam } = await makeExam(type);
		expect(exam.answerHistory).toBeNull();
		expect(effectiveAnswerHistory(exam)).toBe(defaults[type]);
	}
});

test("a student, the instructor of another course and a non-owning admin are refused", async () => {
	const { student, exam, pk } = await makeExam();
	const stranger = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	await persistedCourseFactory.create({ instructor: stranger.username });
	const admin = await persistedUserFactory.create({ role: "ADMIN" });

	for (const actor of [student, stranger, admin]) {
		await expect(
			db.exam.setAnswerHistory(pk, false, { actor }),
		).rejects.toBeInstanceOf(NotAllowed);
	}
	expect(await stored(exam.id)).toBeNull();
});

test("SYSTEM may flip it and a missing exam is NotFound", async () => {
	const { exam, course, pk } = await makeExam();
	await db.exam.setAnswerHistory(pk, false, FULL_ACCESS);
	expect(await stored(exam.id)).toBe(false);

	await expect(
		db.exam.setAnswerHistory(
			{ course: course.id, slug: "nope" },
			true,
			FULL_ACCESS,
		),
	).rejects.toBeInstanceOf(NotFound);
});

test("update and upsert never carry the switch", async () => {
	const { instructor, exam, pk } = await makeExam();
	await db.exam.setAnswerHistory(pk, false, { actor: instructor });

	// biome-ignore lint/suspicious/noExplicitAny: the field is not part of the input type on purpose
	const withKey: any = { title: "Renamed", answerHistory: true };
	await db.exam.update(pk, withKey, { actor: instructor });

	expect(await stored(exam.id)).toBe(false);
});
