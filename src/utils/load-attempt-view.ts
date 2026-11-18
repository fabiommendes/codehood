import type { UserActor } from "@/auth/actor";
import type { AnswerPayload } from "@/components/exam/answer-payload";
import { type CodeSends, sendsOf } from "@/components/exam/code-sends";
import type { QuestionRegrade } from "@/components/exam/RegradeControls";
import type { CourseId } from "@/core/schemas/base";
import { db, type Exam, type Response } from "@/db";
import { loadResultPolicy } from "@/db/result-policy";
import type { AttemptQuestions } from "@/db/services/exam-question.service";
import { shufflePool } from "@/mdq/shuffle";
import { DEFAULT_CODE_PENALTY } from "@/services/code-grading";
import {
	adjustmentsByResponse,
	type ExamResult,
	examResult,
	reducesGrade,
} from "@/services/exam-result";
import type { AttemptState, ExamSchedule } from "@/services/exam-state";
import { regradeBlocker } from "@/services/regrade";
import type { ReviewResult } from "@/services/review";
import type { CodeBlocksHtml } from "./code-blocks";
import {
	answerSnippets,
	highlightQuestionCodeBlocks,
} from "./highlight-code-blocks";
import { highlightExamples } from "./highlight-examples";
import type { PretestSource } from "./pretest-sources";

/// What `ExamAttempt` takes from the server besides the state: the questions as the attempt shows them, the saved answers and, once it may be seen, the review.
export interface AttemptView {
	/// The questions in exam order, shuffled by the attempt's seed, each with the exam's weight for it; none until the author is in the attempt.
	questions: {
		slug: string;
		weight: number;
		question: AttemptQuestions["questions"][number]["question"];
	}[];
	/// The latest saved answer per question slug.
	answers: Record<string, AnswerPayload>;
	/// When the server saved each answer, by question slug (ISO).
	answeredAt: Record<string, string>;
	/// The outcome of the exam, once the state is `results`.
	result: ExamResult | undefined;
	reviews: Record<string, ReviewResult> | undefined;
	/// What the author may do about each answer's grade; empty for a simulation.
	regrades: Record<string, QuestionRegrade>;
	pretests: Record<string, PretestSource[]>;
	exampleHtml: Record<string, string[]>;
	/// The highlighted fenced blocks of every question in `questions`.
	codeBlocks: CodeBlocksHtml;
	codeSends: Record<string, CodeSends>;
	/// Whether the instructor created the attempt for a student who did not take the exam.
	empty: boolean;
}

export interface AttemptViewInput {
	course: CourseId;
	exam: Exam;
	actor: UserActor;
	schedule: ExamSchedule;
	/// The author's attempt, or `null` before they start.
	attempt: Response | null;
	state: AttemptState;
	/// What `db.examQuestion.forAttempt` granted the author, or `null` when it granted nothing.
	granted: AttemptQuestions | null;
	now: Date;
}

/**
 * Loads what the page of an attempt hands to `ExamAttempt`, for the student's attempt and for the instructor's simulation alike.
 *
 * The questions are the ones the author's grant covers; with no grant there are none.
 * A simulation has no regrade requests, so none are read for it.
 */
export async function loadAttemptView(
	input: AttemptViewInput,
): Promise<AttemptView> {
	const { course, exam, actor, schedule, attempt, state, now } = input;
	const author = actor.username;
	const preview = attempt?.preview ?? false;
	const policy = (await loadResultPolicy(course))(exam);

	const sanctions =
		state.kind === "results" && attempt && !preview
			? adjustmentsByResponse(
					await db.examAdjustment.findMany(
						{ course, exam: exam.slug, author },
						{ actor },
					),
				).get(attempt.publicId)
			: undefined;
	const result =
		state.kind === "results" && attempt
			? examResult(
					exam.questions,
					attempt.submissions,
					await db.feedback.findMany(
						{ course, exam: exam.slug, author, preview },
						{ actor },
					),
					sanctions ?? [],
					policy,
				)
			: undefined;

	const reviews =
		result && attempt
			? await db.examQuestion.reviews(
					{ course, exam: exam.slug },
					result.questions.flatMap((outcome) =>
						(outcome.status === "graded" ||
							outcome.status === "pending" ||
							outcome.status === "sanctioned") &&
						outcome.submission
							? [
									{
										question: outcome.question,
										submission: outcome.submission,
										score: outcome.score,
										blanks: outcome.blanks ?? null,
									},
								]
							: [],
					),
					{ actor },
				)
			: undefined;

	const requests =
		result && attempt && !preview
			? await db.regradeRequest.findMany(
					{ course, exam: exam.slug, author },
					{ actor },
				)
			: [];
	const regrades: Record<string, QuestionRegrade> = {};
	for (const outcome of preview ? [] : (result?.questions ?? [])) {
		if (!outcome.submission || !attempt) continue;
		const request =
			requests.find((entry) => entry.submission === outcome.submission) ?? null;
		regrades[outcome.question] = {
			submission: outcome.submission,
			canRequest:
				regradeBlocker(
					{
						schedule,
						author,
						attempt,
						outcome,
						examReduced: result?.adjustments?.some(reducesGrade) ?? false,
						submission: outcome.submission,
						requested: request !== null,
					},
					now,
				) === null,
			request: request && {
				publicId: request.publicId,
				status: request.status,
				message: request.message,
				reply: request.reply,
			},
		};
	}

	const empty = attempt?.createdBy != null;
	// A student who never took the exam reads the questions once the grades are out, which the grant decides; an empty attempt, which only carries the instructor's adjustments, lists none.
	const granted = empty ? [] : (input.granted?.questions ?? []);
	const questions = granted.map(({ slug, weight, question }) => ({
		slug,
		weight,
		question: shufflePool(question, `${attempt?.publicId ?? author}:${slug}`),
	}));

	// The pretest sources of each code question, only while the author can answer.
	const pretests: Record<string, PretestSource[]> = {};
	const exampleHtml: Record<string, string[]> = {};
	// The sends of each code question that goes to a worker, while answering and in the review.
	const codeSends: Record<string, CodeSends> = {};
	const penalties = policy.codePenalty ?? {};
	const answering = state.kind === "in-progress";
	if (answering || (state.kind === "results" && attempt)) {
		await Promise.all(
			granted.map(async ({ slug, question, code }) => {
				if (question.type !== "code" || !code) return;
				if (answering) {
					pretests[slug] = code.pretests;
					exampleHtml[slug] = await highlightExamples(question);
				}
				if (!code.sendable || !attempt) return;
				const sent = await db.gradingJob.forStudent(
					{ response: attempt.publicId, question: slug },
					{ actor },
				);
				codeSends[slug] = sendsOf(
					sent,
					penalties[slug] ?? DEFAULT_CODE_PENALTY,
				);
			}),
		);
	}

	const answers: Record<string, AnswerPayload> = {};
	const answeredAt: Record<string, string> = {};
	for (const submission of attempt?.submissions ?? []) {
		answers[submission.question] = submission.payload as AnswerPayload;
		answeredAt[submission.question] = submission.createdAt.toISOString();
	}

	return {
		questions,
		answers,
		answeredAt,
		result,
		reviews,
		regrades,
		pretests,
		exampleHtml,
		codeBlocks: await highlightQuestionCodeBlocks(
			questions.map((entry) => entry.question),
			questions.flatMap(({ slug, question }) =>
				answerSnippets(question, [answers[slug]]),
			),
		),
		codeSends,
		empty,
	};
}
