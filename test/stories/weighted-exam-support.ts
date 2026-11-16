import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalChoice } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { seedUser } from "./helpers";

/**
 * A course with an exam of two choice questions, "Heavy" worth 3 and "Light" worth 1.
 *
 * `prefix` keeps usernames and slugs unique to one story. The exam is open,
 * with no attempt yet; `closeExam` settles it.
 */
export async function weightedExam(prefix: string) {
	const teacher = await seedUser({
		role: "INSTRUCTOR",
		username: `${prefix}-prof`,
	});
	const student = await seedUser({
		role: "STUDENT",
		username: `${prefix}-ana`,
		name: "Ana Prado",
	});
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	for (const [slug, title, weight] of [
		["q-heavy", "Heavy question", 3],
		["q-light", "Light question", 1],
	] as const) {
		await db.question.create(
			{
				course: course.id,
				slug,
				status: "PUBLISHED",
				version: "1",
				question: { ...capitalChoice, id: slug, title, weight },
			},
			FULL_ACCESS,
		);
	}
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "weighted",
		title: "Weighted exam",
		type: "EXAM",
		status: "ONGOING",
		duration: { hours: 1 },
		questions: [{ slug: "q-heavy" }, { slug: "q-light" }],
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});

	/// Has the student miss the heavy question and get the light one, then closes the exam and releases the grades: 25% weighted, 50% plain.
	async function closeExam(): Promise<{ heavy: string }> {
		const heavy = await db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: "q-heavy",
				payload: "rio",
			},
			{ actor: student },
		);
		await db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: "q-light",
				payload: "brasilia",
			},
			{ actor: student },
		);
		await db.response.finish(
			{ course: course.id, exam: exam.slug },
			{ actor: student },
		);
		await prisma.exam.update({
			where: { id: exam.id },
			data: {
				status: "COMPLETED",
				gradesReleasedAt: new Date(Date.now() - 60_000),
			},
		});
		return { heavy: heavy.submissions.at(-1)?.publicId ?? "" };
	}

	return {
		teacher,
		student,
		course,
		href,
		exam,
		examUrl: `${href}/exams/${exam.slug}`,
		closeExam,
	};
}
