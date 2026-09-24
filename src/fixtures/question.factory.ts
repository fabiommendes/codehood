import { Factory } from "fishery";
import { db, type QuestionCreate, type QuestionView, type schema } from "@/db";
import { questionFactory as mdqFactory } from "@/mdq/factory";
import type { Question as MdqQuestion } from "@/mdq/schemas-generated";
import { persistedCourseFactory } from "./course.factory";
import { type PersistParams, serviceOpts } from "./support";

/** Transient params of both question factories. */
export interface QuestionParams extends PersistParams {
	/**
	 * MDQ type of the generated document. Left unset, the type cycles through
	 * every one in turn, so a `buildList` covers the whole union.
	 */
	type?: MdqQuestion["type"];
}

/**
 * Defaults to a `PUBLISHED` question carrying a generated MDQ document. Pass
 * `question` to author the document by hand, or the transient `type` to pin
 * which kind is generated.
 */
function buildQuestion(
	sequence: number,
	params: Partial<QuestionCreate>,
	transient: QuestionParams,
): QuestionCreate {
	return {
		course: params.course ?? (0 as schema.CourseId),
		slug: params.slug ?? `question-${sequence}`,
		status: "PUBLISHED",
		version: "1",
		question: mdqFactory.build(transient.type ? { type: transient.type } : {}),
	};
}

/** Builds `QuestionCreate` payloads, ready for `questionService.create`. */
export const questionFactory = Factory.define<
	QuestionCreate,
	QuestionParams,
	QuestionCreate,
	Partial<QuestionCreate>
>(({ sequence, params, transientParams }) =>
	buildQuestion(sequence, params, transientParams),
);

/**
 * Builds a `QuestionCreate` payload and persists it via `questionService.create`.
 *
 * `course` is provisioned automatically (a fresh course) when left unset.
 *
 * Returns a `QuestionView`: the service hands back the public half to an actor
 * who may not write the course, and the default actor's full access is not
 * something the type can know.
 */
export const persistedQuestionFactory = Factory.define<
	QuestionCreate,
	QuestionParams,
	QuestionView,
	Partial<QuestionCreate>
>(({ sequence, params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const opts = serviceOpts(transientParams);
		const course =
			params.course ??
			(await persistedCourseFactory.create({}, { transient: transientParams }))
				.id;

		return db.question.create({ ...input, course }, opts);
	});

	return buildQuestion(sequence, params, transientParams);
});
