import { Factory } from "fishery";
import type { Duration } from "@/core/schemas";
import {
	db,
	type ExamCreate,
	type Feedback,
	type FeedbackCreate,
	type schema,
} from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "./course.factory";
import { persistedExamFactory } from "./exam.factory";
import { persistedQuestionFactory } from "./question.factory";
import { persistedResponseFactory } from "./response.factory";
import { persistedSubmissionFactory } from "./submission.factory";
import { type PersistParams, serviceOpts } from "./support";

/** Transient params `persistedFeedbackFactory` accepts on top of `PersistParams`. */
export interface FeedbackPersistParams extends PersistParams {
	/// Overrides on the exam provisioned when `submission` is left unset,
	/// since the release matrix (F4) needs to drive all five.
	examType?: ExamCreate["type"];
	examStatus?: ExamCreate["status"];
	scheduledAt?: Date | null;
	duration?: Duration | null;
	gradesReleasedAt?: Date | null;
}

function buildFeedback(
	_sequence: number,
	params: Partial<FeedbackCreate>,
): FeedbackCreate {
	// A pass needs exactly one grader, and the default actor is SYSTEM, which
	// has no username to fall back on — so an unattributed pass is a bot's.
	const unattributed = !params.grader && !params.bot;

	return {
		submission: params.submission ?? { id: 0 as schema.SubmissionId },
		ref: params.ref ?? `pass-${_sequence}`,
		score: params.score ?? "1",
		grader: params.grader,
		bot: params.bot ?? (unattributed ? "fixture-bot" : undefined),
		feedback: params.feedback,
	};
}

/** Builds `FeedbackCreate` payloads, ready for `feedbackService.create`. */
export const feedbackFactory = Factory.define<
	FeedbackCreate,
	FeedbackPersistParams,
	FeedbackCreate,
	Partial<FeedbackCreate>
>(({ sequence, params }) => buildFeedback(sequence, params));

/**
 * Builds a `FeedbackCreate` payload and persists it via `feedbackService.create`.
 *
 * `submission` is provisioned automatically when left unset: a fresh course, a
 * fresh published question in it, a fresh exam carrying that question, a fresh
 * open response against that exam (its own student enrolled), and a fresh
 * submission against it — so the default create always satisfies the service's
 * preconditions.
 *
 * The provisioned exam's `type`, `status`, `scheduledAt`, `duration` and
 * `gradesReleasedAt` are driven through the matching transient params
 * (`examType`, `examStatus`, `scheduledAt`, `duration`, `gradesReleasedAt`),
 * so a caller can place it anywhere on the release matrix. `gradesReleasedAt`
 * is written directly through `prisma`, since no public schema exposes it yet
 * (out of scope per the spec — writing it belongs with the exam's own
 * management surface). They are ignored when `submission` is given directly,
 * since there is then no exam to shape.
 */
export const persistedFeedbackFactory = Factory.define<
	FeedbackCreate,
	FeedbackPersistParams,
	Feedback,
	Partial<FeedbackCreate>
>(({ sequence, params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const opts = serviceOpts(transientParams);

		let submission = params.submission;

		if (!submission) {
			const course = await persistedCourseFactory.create(
				{},
				{ transient: transientParams },
			);
			const question = await persistedQuestionFactory.create(
				{ course: course.id },
				{ transient: transientParams },
			);
			// Answered first, closed afterwards, in that order: a submission is
			// only accepted against an `ONGOING` exam, so an exam wanted in any
			// other state reaches it the way a real one does.
			const exam = await persistedExamFactory.create(
				{
					course: course.id,
					status: "ONGOING",
					type: transientParams.examType ?? "EXAM",
					scheduledAt: transientParams.scheduledAt,
					duration: transientParams.duration,
					questions: [{ slug: question.slug }],
				},
				{ transient: transientParams },
			);
			const response = await persistedResponseFactory.create(
				{ course: course.id, exam: exam.slug },
				{ transient: transientParams },
			);
			const created = await persistedSubmissionFactory.create(
				{
					response: { publicId: response.publicId },
					question: question.slug,
				},
				{ transient: transientParams },
			);

			// Written through `prisma`: `status` is moved past what the service
			// allows once answered, and no public schema exposes
			// `gradesReleasedAt` yet (out of scope per the spec).
			const examStatus = transientParams.examStatus ?? "ONGOING";
			if (
				examStatus !== "ONGOING" ||
				transientParams.gradesReleasedAt !== undefined
			) {
				await prisma.exam.update({
					where: { id: exam.id },
					data: {
						status: examStatus,
						...(transientParams.gradesReleasedAt !== undefined
							? { gradesReleasedAt: transientParams.gradesReleasedAt }
							: {}),
					},
				});
			}

			submission = { id: created.id };
		}

		return db.feedback.create({ ...input, submission }, opts);
	});

	return buildFeedback(sequence, params);
});
