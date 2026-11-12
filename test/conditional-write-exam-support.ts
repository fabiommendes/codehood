import { type Actor, FULL_ACCESS, type UserActor } from "@/auth/actor";
import { db, type schema, type User } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";

/// Fixtures of the ADR 0013 specs for exam, examException, response and
/// report. Every call creates rows under random keys, so no spec depends on the
/// seed or on a sibling spec's rows.

export const STALE = new Date(0);

/// The service options of a caller that expects `version` (`SYSTEM` by default).
export const at = (
	expectedUpdatedAt: Date | null,
	actor: Actor = FULL_ACCESS.actor,
): { actor: Actor; expectedUpdatedAt: Date | null } => ({
	actor,
	expectedUpdatedAt,
});

export function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

export const actorOf = (
	user: Pick<User, "username" | "name" | "role">,
): { actor: UserActor } => ({
	actor: { username: user.username, name: user.name, role: user.role },
});

async function ensureEdition(slug = "2097-1"): Promise<string> {
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

/// A course with its own instructor.
export async function makeCourse() {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: await ensureEdition(),
	});
	return { course, instructor };
}

export async function enroll(courseId: schema.CourseId) {
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: courseId, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

/// An essay question, which takes any text as an answer.
export function makeQuestion(courseId: schema.CourseId) {
	return persistedQuestionFactory.create(
		{ course: courseId, slug: tag("q-") },
		{ transient: { type: "essay" } },
	);
}

/// An exam in `courseId`: ongoing by default, so a student can answer it.
export function makeExam(
	courseId: schema.CourseId,
	fields: Partial<Parameters<typeof persistedExamFactory.create>[0]> = {},
) {
	return persistedExamFactory.create({
		course: courseId,
		slug: tag("exam-"),
		status: "ONGOING",
		type: "EXAM",
		...fields,
	});
}

/// A course, an enrolled student, and an ongoing exam with one question.
export async function makeAttempt() {
	const { course, instructor } = await makeCourse();
	const student = await enroll(course.id);
	const question = await makeQuestion(course.id);
	const exam = await makeExam(course.id, {
		questions: [{ slug: question.slug }],
	});
	return { course, instructor, student, question, exam };
}

/// A response of an enrolled student, opened by `create`.
export async function makeResponse() {
	const ctx = await makeAttempt();
	const response = await persistedResponseFactory.create({
		course: ctx.course.id,
		exam: ctx.exam.slug,
		author: ctx.student.username,
	});
	return { ...ctx, response };
}

/// A report sent by a student of a fresh course.
export async function makeReport(
	input: Partial<Parameters<typeof db.report.create>[0]> = {},
) {
	const { course, instructor } = await makeCourse();
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	const report = await db.report.create(
		{ kind: "BUG", message: `Something looks wrong ${tag("m")}`, ...input },
		actorOf(student),
	);
	return { course, instructor, student, report };
}
