import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { upload } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { seedUser } from "./helpers";

/// The slug of the upload question every scenario of this file holds.
export const UPLOAD_SLUG = "upload-diagram";

/// Bytes that pass for a PDF and for a PNG; the services only check names and sizes.
export const PDF_BYTES = Buffer.from(
	"%PDF-1.4\nstack of factorial(3)\n%%EOF\n",
);
export const PDF_BYTES_V2 = Buffer.from(
	"%PDF-1.4\nsecond, longer version of the stack\n%%EOF\n",
);
export const PNG_BYTES = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

/**
 * A course with an open exam of one upload question (2 files, 1 MB each, `.pdf`/`.png`).
 *
 * `prefix` keeps usernames and slugs unique to one story.
 */
export async function uploadExam(prefix: string) {
	const teacher = await seedUser({
		role: "INSTRUCTOR",
		username: `${prefix}-prof`,
	});
	const student = await seedUser({
		role: "STUDENT",
		username: `${prefix}-student`,
	});
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	await db.question.create(
		{
			course: course.id,
			slug: UPLOAD_SLUG,
			status: "PUBLISHED",
			version: "1",
			question: upload({
				id: UPLOAD_SLUG,
				title: "Recursion diagram",
				stem: "Draw the call stack of factorial(3) and upload it.",
				maxFiles: 2,
				maxSize: "1 MB",
				extensions: [".pdf", ".png"],
			}),
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: `${prefix}-exam`,
		title: "Diagram exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: UPLOAD_SLUG }],
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	return { teacher, student, course, exam, href };
}

/// The files the newest submission to the upload question of `examId` holds for `username`, by name and size.
export async function storedFiles(
	username: string,
	examId: number,
	questionSlug = UPLOAD_SLUG,
): Promise<{ name: string; size: number }[]> {
	const response = await prisma.response.findFirst({
		where: { authorId: username, examId },
	});
	if (!response) return [];
	const full = await db.response.findOne(
		{ publicId: response.publicId },
		FULL_ACCESS,
	);
	const question = await prisma.questionRef.findFirstOrThrow({
		where: { slug: questionSlug, courseId: full?.courseId },
	});
	const mine = (full?.submissions ?? []).filter(
		(s) => s.questionId === question.id,
	);
	const payload = mine.at(-1)?.payload as
		| { name: string; size: number }[]
		| null
		| undefined;
	return (payload ?? []).map(({ name, size }) => ({ name, size }));
}
