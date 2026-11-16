import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import type { CourseId } from "@/core/schemas";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalChoice } from "@/mdq/fixtures";
import { resetDatabase } from "./stories/helpers";

test.beforeEach(resetDatabase);

/// Creates (or, with an existing slug, versions) a question; `weight` is omitted when undefined.
async function saveQuestion(
	course: CourseId,
	slug: string,
	version: string,
	weight?: number,
) {
	const pk = { course, slug };
	const question = {
		...capitalChoice,
		id: slug,
		title: slug,
		...(weight === undefined ? {} : { weight }),
	};
	const existing = await db.question.findOne(pk, FULL_ACCESS);
	if (existing) {
		await db.question.update(pk, { version, question }, FULL_ACCESS);
		return;
	}
	await db.question.create(
		{ course, slug, status: "PUBLISHED", version, question },
		FULL_ACCESS,
	);
}

function weights(exam: { questions: { slug: string; weight: number }[] }) {
	return Object.fromEntries(exam.questions.map((q) => [q.slug, q.weight]));
}

test("a question without weight in its frontmatter weighs 1 in the exam", async () => {
	const course = await persistedCourseFactory.create();
	await saveQuestion(course.id, "plain", "v1");

	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "e",
		questions: [{ slug: "plain" }],
	});

	expect(weights(exam)).toEqual({ plain: 1 });
});

test("an exam that pins no version reads the weight of the latest one", async () => {
	const course = await persistedCourseFactory.create();
	await saveQuestion(course.id, "q", "v1", 2);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "e",
		questions: [{ slug: "q" }],
	});
	expect(weights(exam)).toEqual({ q: 2 });

	await saveQuestion(course.id, "q", "v2", 5);

	const found = await db.exam.findOne(
		{ course: course.id, slug: "e" },
		FULL_ACCESS,
	);
	expect(weights(found as NonNullable<typeof found>)).toEqual({ q: 5 });
});

test("an exam that pins a version reads the weight of that version, whatever the latest is", async () => {
	const course = await persistedCourseFactory.create();
	await saveQuestion(course.id, "pinned", "v1", 3);
	await saveQuestion(course.id, "loose", "v1", 4);
	await persistedExamFactory.create({
		course: course.id,
		slug: "e",
		questions: [{ slug: "pinned", version: "v1" }, { slug: "loose" }],
	});
	await saveQuestion(course.id, "pinned", "v2", 9);
	await saveQuestion(course.id, "loose", "v2", 7);

	const found = await db.exam.findOne(
		{ course: course.id, slug: "e" },
		FULL_ACCESS,
	);
	expect(weights(found as NonNullable<typeof found>)).toEqual({
		pinned: 3,
		loose: 7,
	});
	const listed = await db.exam.findMany({ course: course.id }, FULL_ACCESS);
	expect(weights(listed[0] as NonNullable<(typeof listed)[0]>)).toEqual({
		pinned: 3,
		loose: 7,
	});
});
