import { Factory } from "fishery";
import {
	db,
	type ExamException,
	type ExamExceptionCreate,
	type schema,
} from "@/db";
import { type PersistParams, serviceOpts } from "./support";

function buildExamException(
	sequence: number,
	params: Partial<ExamExceptionCreate>,
): ExamExceptionCreate {
	return {
		course: params.course ?? (0 as schema.CourseId),
		exam: params.exam ?? "exam",
		username: params.username ?? `student-${sequence}`,
		extraTime:
			params.extraTime === undefined ? { minutes: 30 } : params.extraTime,
		scheduledAt: params.scheduledAt,
		note: params.note,
	};
}

/** Builds `ExamExceptionCreate` payloads granting 30 extra minutes, ready for `examExceptionService.create`. */
export const examExceptionFactory = Factory.define<
	ExamExceptionCreate,
	PersistParams,
	ExamExceptionCreate,
	Partial<ExamExceptionCreate>
>(({ sequence, params }) => buildExamException(sequence, params));

/**
 * Builds an `ExamExceptionCreate` payload and persists it via `examExceptionService.create`.
 *
 * Unlike most persisted factories, nothing is provisioned: `course`, `exam`
 * and `username` must name an existing exam and an enrolled student, since an
 * exception only makes sense between the two.
 */
export const persistedExamExceptionFactory = Factory.define<
	ExamExceptionCreate,
	PersistParams,
	ExamException,
	Partial<ExamExceptionCreate>
>(({ sequence, params, transientParams, onCreate }) => {
	onCreate((input) =>
		db.examException.create(input, serviceOpts(transientParams)),
	);
	return buildExamException(sequence, params);
});
