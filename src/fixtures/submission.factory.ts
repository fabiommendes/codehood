import { Factory } from "fishery";
import { db, type Submission, type SubmissionCreate, type schema } from "@/db";
import { persistedCourseFactory } from "./course.factory";
import { persistedExamFactory } from "./exam.factory";
import { persistedQuestionFactory } from "./question.factory";
import { persistedResponseFactory } from "./response.factory";
import { type PersistParams, serviceOpts } from "./support";

function buildSubmission(
	sequence: number,
	params: Partial<SubmissionCreate>,
): SubmissionCreate {
	return {
		response: params.response ?? { id: 0 as schema.ResponseId },
		question: params.question ?? `question-${sequence}`,
		payload: params.payload ?? { answer: `answer-${sequence}` },
		status: params.status,
		automaticallyTriggered: params.automaticallyTriggered,
		startedAt: params.startedAt,
	};
}

/** Builds `SubmissionCreate` payloads, ready for `submissionService.create`. */
export const submissionFactory = Factory.define<
	SubmissionCreate,
	PersistParams,
	SubmissionCreate,
	Partial<SubmissionCreate>
>(({ sequence, params }) => buildSubmission(sequence, params));

/**
 * Builds a `SubmissionCreate` payload and persists it via `submissionService.create`.
 *
 * `response` is provisioned automatically when left unset: a fresh course, a
 * fresh published question in it, a fresh `ONGOING` exam carrying that
 * question, and a fresh open response against that exam (its own author
 * enrolled). `question` then defaults to that provisioned question's slug, so
 * R2 (the question must belong to the response's exam) holds by construction.
 */
export const persistedSubmissionFactory = Factory.define<
	SubmissionCreate,
	PersistParams,
	Submission,
	Partial<SubmissionCreate>
>(({ sequence, params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const opts = serviceOpts(transientParams);

		let response = params.response;
		let question = params.question;

		if (!response) {
			const course = await persistedCourseFactory.create(
				{},
				{ transient: transientParams },
			);
			const q = await persistedQuestionFactory.create(
				{ course: course.id },
				{ transient: transientParams },
			);
			const exam = await persistedExamFactory.create(
				{
					course: course.id,
					status: "ONGOING",
					type: "EXAM",
					questions: [{ slug: q.slug }],
				},
				{ transient: transientParams },
			);
			const created = await persistedResponseFactory.create(
				{ course: course.id, exam: exam.slug },
				{ transient: transientParams },
			);
			response = { publicId: created.publicId };
			question = question ?? q.slug;
		}

		return db.submission.create(
			{ ...input, response, question: question ?? input.question },
			opts,
		);
	});

	return buildSubmission(sequence, params);
});
