import { createHash } from "node:crypto";
import { FULL_ACCESS } from "@/auth/actor";
import { isoDate } from "@/core/schemas/base";
import { db, type QuestionCreate } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { uploadFactory } from "@/mdq/factory";

/// Shared arrangement of the upload-file HTTP specs: an exam with upload questions and open attempts.

/// Mirrors `SESSION_COOKIE` in `src/middleware.ts`, which the test process cannot import.
const SESSION_COOKIE = "session";

export function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

export function sha256(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/// Fresh bytes of `size` bytes with `head` in front, so no test shares a blob with another.
export function fresh(size: number, head = ""): Buffer {
	const seed = Buffer.from(head + tag("b"));
	return Buffer.concat([
		seed,
		Buffer.alloc(Math.max(0, size - seed.length), 7),
	]).subarray(0, size);
}

async function ensureEdition(slug = "2094-1"): Promise<string> {
	if (!(await db.edition.findOne({ slug }, FULL_ACCESS))) {
		await db.edition.create(
			{
				slug,
				name: slug,
				startDate: isoDate.parse("2026-01-01"),
				endDate: isoDate.parse("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	return slug;
}

type QuestionDoc = QuestionCreate["question"];

/// A course with an instructor, two enrolled students and an open exam.
///
/// `pdf` takes 3 files of 20 MB, pdf and png only; `any` takes 2 files of
/// 20 MB with any extension (so `.html` is accepted); `small` takes 1 KB.
export async function makeWorld() {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: await ensureEdition(),
	});
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	const other = await persistedUserFactory.create({ role: "STUDENT" });
	for (const s of [student, other]) {
		await db.enrollment.create(
			{ course: course.id, username: s.username },
			FULL_ACCESS,
		);
	}
	const make = (slug: string, doc: QuestionDoc) =>
		db.question.create(
			{
				course: course.id,
				slug,
				status: "PUBLISHED",
				version: "1",
				question: doc,
			},
			FULL_ACCESS,
		);
	const pdf = await make(
		tag("pdf-"),
		uploadFactory.build({
			maxFiles: 3,
			maxSize: "20 MB",
			extensions: [".pdf", ".png"],
		}),
	);
	const anyDoc = uploadFactory.build({ maxFiles: 2, maxSize: "20 MB" });
	delete (anyDoc as { extensions?: unknown }).extensions;
	const any = await make(tag("any-"), anyDoc);
	const small = await make(
		tag("small-"),
		uploadFactory.build({
			maxFiles: 1,
			maxSize: "1 KB",
			extensions: [".pdf"],
		}),
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: tag("exam-"),
		status: "ONGOING",
		type: "EXAM",
		questions: [pdf, any, small].map((q) => ({ slug: q.slug })),
	});
	const attempt = await persistedResponseFactory.create({
		course: course.id,
		exam: exam.slug,
		author: student.username,
	});
	const courseSegment = `${course.discipline.slug}/${instructor.username}_${course.edition.slug}`;
	const examBase = `/api/course/${courseSegment}/exam/${exam.slug}`;
	return {
		instructor,
		course,
		student,
		other,
		pdf,
		any,
		small,
		exam,
		attempt,
		courseSegment,
		examBase,
	};
}

export type World = Awaited<ReturnType<typeof makeWorld>>;

/// The `Cookie` header of a fresh session of `username`, the way a browser sends it.
export async function sessionCookie(username: string): Promise<string> {
	const { token } = await db.session.create({ username }, FULL_ACCESS);
	return `${SESSION_COOKIE}=${token}`;
}

/// Uploads through the service, to arrange state without HTTP.
export function putFile(
	w: World,
	question: { slug: string },
	filename: string,
	bytes: Buffer,
	author: { username: string } = w.student,
) {
	return db.response.uploadFile(
		{
			course: w.course.id,
			exam: w.exam.slug,
			question: question.slug,
			filename,
			bytes,
			author: author.username,
		},
		{ actor: author as never },
	);
}
