import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalChoice } from "@/mdq/fixtures";
import { resetDatabase } from "./stories/helpers";

test.beforeEach(resetDatabase);

type Course = Awaited<ReturnType<typeof persistedCourseFactory.create>>;

/// Creates the questions `a`, `b` and `c` in `course`, in that order.
async function threeQuestions(course: Course): Promise<void> {
	for (const slug of ["a", "b", "c"]) {
		await db.question.create(
			{
				course: course.id,
				slug,
				status: "PUBLISHED",
				version: "1",
				question: { ...capitalChoice, id: slug, title: slug },
			},
			FULL_ACCESS,
		);
	}
}

function slugs(exam: { questions: { slug: string }[] } | null): string[] {
	return exam?.questions.map((question) => question.slug) ?? [];
}

test("an exam keeps its questions in the order it was created with", async () => {
	const course = await persistedCourseFactory.create();
	await threeQuestions(course);

	const created = await persistedExamFactory.create({
		course: course.id,
		slug: "ordered",
		questions: [{ slug: "c" }, { slug: "a" }, { slug: "b" }],
	});

	expect(slugs(created)).toEqual(["c", "a", "b"]);
	const found = await db.exam.findOne(
		{ course: course.id, slug: "ordered" },
		FULL_ACCESS,
	);
	expect(slugs(found)).toEqual(["c", "a", "b"]);
	const listed = await db.exam.findMany({ course: course.id }, FULL_ACCESS);
	expect(slugs(listed[0] ?? null)).toEqual(["c", "a", "b"]);
});

test("updating an exam's questions replaces their order", async () => {
	const course = await persistedCourseFactory.create();
	await threeQuestions(course);
	await persistedExamFactory.create({
		course: course.id,
		slug: "reordered",
		questions: [{ slug: "a" }, { slug: "b" }, { slug: "c" }],
	});

	const updated = await db.exam.update(
		{ course: course.id, slug: "reordered" },
		{ questions: [{ slug: "b" }, { slug: "c" }, { slug: "a" }] },
		FULL_ACCESS,
	);

	expect(slugs(updated)).toEqual(["b", "c", "a"]);
	const found = await db.exam.findOne(
		{ course: course.id, slug: "reordered" },
		FULL_ACCESS,
	);
	expect(slugs(found)).toEqual(["b", "c", "a"]);
});
