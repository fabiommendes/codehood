import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import { db, type Exam, type ExamCreate, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "./course.factory";
import { type PersistParams, serviceOpts } from "./support";

function buildExam(sequence: number, params: Partial<ExamCreate>): ExamCreate {
	return {
		course: params.course ?? (0 as schema.CourseId),
		slug: params.slug ?? `exam-${sequence}`,
		title: params.title ?? faker.lorem.words(3),
		type: params.type ?? "EXAM",
		status: params.status ?? "SCHEDULED",
		scheduledAt: params.scheduledAt,
		duration: params.duration,
	};
}

/** Builds `ExamCreate` payloads, ready for `examService.create`. */
export const examFactory = Factory.define<
	ExamCreate,
	PersistParams,
	ExamCreate,
	Partial<ExamCreate>
>(({ sequence, params }) => buildExam(sequence, params));

/**
 * Builds an `ExamCreate` payload and persists it via `examService.create`.
 *
 * `course` is provisioned automatically (a fresh course) when left unset.
 */
export const persistedExamFactory = Factory.define<
	ExamCreate,
	PersistParams,
	Exam,
	Partial<ExamCreate>
>(({ sequence, params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const opts = serviceOpts(transientParams);
		const courseId =
			params.course ??
			(await persistedCourseFactory.create({}, { transient: transientParams }))
				.id;

		return db.exam.create({ ...input, course: courseId }, opts);
	});

	return buildExam(sequence, params);
});

/**
 * Persists an ongoing exam of `course` holding the questions `slugs`, which releases their public half to the course's members.
 *
 * The questions are linked straight in the database, so a hidden, archived or
 * draft question can be held too.
 */
export async function persistedOpenExam(
	course: schema.CourseId,
	slugs: readonly string[],
	params: Partial<ExamCreate> = {},
): Promise<Exam> {
	const exam = await persistedExamFactory.create({
		...params,
		course,
		status: params.status ?? "ONGOING",
	});
	const refs = await prisma.questionRef.findMany({
		where: { courseId: course, slug: { in: [...slugs] } },
		select: { id: true },
	});
	await prisma.questionsForExam.createMany({
		data: refs.map((ref, position) => ({
			examId: exam.id,
			questionRefId: ref.id,
			position,
		})),
	});
	return exam;
}
