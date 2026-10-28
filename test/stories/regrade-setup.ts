import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalShortAnswer } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { seedUser } from "./helpers";

export const REGRADE_MESSAGE = "The capital I typed is accepted in class.";

/**
 * A course whose `EXAM` is graded and released: each student typed an answer and got a zero.
 *
 * `prefix` keeps usernames and slugs unique to one story, since the database
 * is shared by every test of a run.
 */
export async function releasedExam(prefix: string, studentCount: number) {
	const teacher = await seedUser({
		role: "INSTRUCTOR",
		username: `${prefix}-prof`,
	});
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	await db.question.create(
		{
			course: course.id,
			slug: "q-short",
			status: "PUBLISHED",
			version: "1",
			question: {
				...capitalShortAnswer,
				id: "q-short",
				title: "Typed capital",
			},
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "regrade-exam",
		title: "Regrade exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "q-short" }],
	});

	const students = [];
	for (let i = 1; i <= studentCount; i++) {
		const student = await seedUser({
			role: "STUDENT",
			username: `${prefix}-student-${i}`,
		});
		await db.enrollment.create(
			{ course: course.id, username: student.username },
			FULL_ACCESS,
		);
		const response = await db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: "q-short",
				payload: `Reply number ${i}`,
			},
			{ actor: student },
		);
		const submission = response.submissions.at(-1)?.publicId ?? "";
		await db.response.finish(
			{ course: course.id, exam: exam.slug },
			{ actor: student },
		);
		await db.feedback.create(
			{
				submission: { publicId: submission },
				ref: "pass-1",
				score: "0",
				grader: teacher.username,
			},
			FULL_ACCESS,
		);
		students.push({ ...student, submission });
	}
	await prisma.exam.update({
		where: { id: exam.id },
		data: {
			status: "COMPLETED",
			gradesReleasedAt: new Date(Date.now() - 60_000),
		},
	});
	return {
		teacher,
		course,
		href,
		exam,
		students,
		examUrl: `${href}/exams/${exam.slug}`,
	};
}

/// Opens a regrade request on `submission` as its author, through the service.
export function requestRegrade(
	course: { id: Parameters<typeof db.regradeRequest.create>[0]["course"] },
	student: {
		username: string;
		role: "STUDENT" | "INSTRUCTOR" | "ADMIN";
		name: string;
	},
	submission: string,
) {
	return db.regradeRequest.create(
		{ course: course.id, submission, message: REGRADE_MESSAGE },
		{ actor: student },
	);
}
