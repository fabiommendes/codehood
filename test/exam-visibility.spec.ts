import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { seedUser } from "./stories/helpers";

test("a student asking for drafts or archived exams by status still gets only the visible ones", async () => {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	for (const status of ["DRAFT", "ARCHIVED", "ONGOING"] as const) {
		await persistedExamFactory.create({
			course: course.id,
			slug: status.toLowerCase(),
			status,
		});
	}

	const exams = await db.exam.findMany(
		{ course: course.id, statuses: ["DRAFT", "ARCHIVED", "ONGOING"] },
		{ actor: student },
	);

	expect(exams.map((exam) => exam.slug)).toEqual(["ongoing"]);
});
