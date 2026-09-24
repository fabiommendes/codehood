import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import { db, type Exam, type ExamCreate, type schema } from "@/db";
import { persistedCourseFactory } from "./course.factory";
import { type PersistParams, serviceOpts } from "./support";

function buildExam(sequence: number, params: Partial<ExamCreate>): ExamCreate {
	return {
		course: params.course ?? (0 as schema.CourseId),
		slug: params.slug ?? `exam-${sequence}`,
		title: params.title ?? faker.lorem.words(3),
		type: params.type ?? "EXAM",
		status: params.status ?? "SCHEDULED",
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
