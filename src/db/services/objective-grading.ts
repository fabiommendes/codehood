/**
 * Grades the objective answers of an attempt: the score the mdq library gives,
 * stored as a grading pass with no grader.
 *
 * Shared by the closing of an attempt, `response.gradeObjectives` and `response.settleExpired`.
 */

import type { ExamId, ResponseId } from "@/core/schemas/base";
import { touch } from "@/db/conditional-write";
import { NotAutoGradable, ResponseError, scoreResponse } from "@/mdq";
import type { PrismaTx } from "../client";
import { realAttempt } from "../preview-filter";
import { examTimingSelect, loadExceptionTiming } from "./exam-questions";
import { privateDocument, scoreText } from "./grading-job.service";
import { attemptTimedOut } from "./submission.service";

/// The `ref` of the pass an automatic grade is stored under.
const AUTOMATIC_REF = "auto";

/**
 * Grades the counting submission of each objective question of an attempt
 * that has no grading pass yet, and returns how many it graded.
 *
 * The counting submission is the newest of its question. A question the
 * library cannot score alone (essay, code, a fill-in with a blank for the
 * instructor) is left as it is, and a response it refuses scores 0. With
 * `dryRun`, nothing is written.
 */
export async function gradeObjectives(
	tx: PrismaTx,
	responseId: ResponseId,
	options: { dryRun?: boolean } = {},
): Promise<number> {
	const response = await tx.response.findUnique({
		where: { id: responseId },
		select: {
			examId: true,
			submissions: {
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				select: {
					id: true,
					status: true,
					payload: true,
					createdById: true,
					question: { select: { id: true, latestId: true } },
				},
			},
		},
	});
	if (!response) return 0;

	const counting = new Map<number, (typeof response.submissions)[number]>();
	for (const submission of response.submissions) {
		// The instructor's grade for an unanswered question is never scored by the library.
		if (submission.createdById !== null) continue;
		if (!counting.has(submission.question.id)) {
			counting.set(submission.question.id, submission);
		}
	}

	// Read apart from the submissions: a `_count` of the relation makes Prisma
	// aggregate the whole `Feedback` table before joining.
	const passes = await tx.feedback.findMany({
		where: { submissionId: { in: [...counting.values()].map((s) => s.id) } },
		select: { submissionId: true },
	});
	const alreadyGraded = new Set(passes.map((pass) => pass.submissionId));

	let graded = 0;
	for (const submission of counting.values()) {
		if (alreadyGraded.has(submission.id)) continue;
		if (submission.status === "WILL_NOT_GRADE") continue;

		const score = objectiveScore(
			await privateDocument(tx, response.examId, submission.question),
			submission.payload,
		);
		if (score === null) continue;
		graded += 1;
		if (options.dryRun) continue;

		await tx.feedback.create({
			data: {
				submissionId: submission.id,
				ref: AUTOMATIC_REF,
				score: scoreText(score),
			},
		});
		await tx.submission.update({
			where: { id: submission.id },
			data: { status: "GRADED_AUTOMATICALLY" },
		});
	}
	if (graded > 0 && !options.dryRun)
		await touch(tx, "response", { id: responseId }, {});
	return graded;
}

/// What {@link gradeExpiredObjectives} did.
export interface ExpiredGrading {
	/// The closed or timed-out attempts it looked at.
	attempts: number;
	/// The answers it graded, or would grade on a dry run.
	graded: number;
}

/**
 * Grades the objective answers of the attempts of an exam that were closed or ran out of time, and returns what it did.
 *
 * It leaves `acceptingSubmissions` alone, so extra time granted later lets the student answer again; the new answer is graded on the next pass. An attempt still within its time is skipped. With `author`, only that student's attempt is looked at.
 */
export async function gradeExpiredObjectives(
	tx: PrismaTx,
	options: { examId: ExamId; author?: string; dryRun?: boolean },
): Promise<ExpiredGrading> {
	const exam = await tx.exam.findUnique({
		where: { id: options.examId },
		select: { id: true, ...examTimingSelect },
	});
	if (!exam) return { attempts: 0, graded: 0 };
	const responses = await tx.response.findMany({
		where: {
			...realAttempt,
			examId: exam.id,
			...(options.author ? { authorId: options.author } : {}),
		},
		select: {
			id: true,
			createdAt: true,
			authorId: true,
			preview: true,
			acceptingSubmissions: true,
		},
		orderBy: { id: "asc" },
	});
	const now = new Date();
	let attempts = 0;
	let graded = 0;
	for (const response of responses) {
		if (
			response.acceptingSubmissions &&
			!attemptTimedOut(
				{ createdAt: response.createdAt, preview: response.preview, exam },
				now,
				await loadExceptionTiming(tx, exam.id, response.authorId),
			)
		) {
			continue;
		}
		attempts += 1;
		graded += await gradeObjectives(tx, response.id, {
			dryRun: options.dryRun,
		});
	}
	return { attempts, graded };
}

/// The library's score of `payload`, 0 when it is blank or the library refuses it, or `null` when only an instructor can score it.
function objectiveScore(
	question: Parameters<typeof scoreResponse>[0],
	payload: unknown,
): number | null {
	// A code question is scored from a runner report, never from the response.
	if (question.type === "code") return null;
	if (isBlank(payload)) return 0;
	try {
		return scoreResponse(question, payload).score;
	} catch (error) {
		if (error instanceof ResponseError) return 0;
		if (error instanceof NotAutoGradable) return null;
		throw error;
	}
}

/// Whether `payload` is a skipped answer: `null`, or text with nothing but whitespace.
function isBlank(payload: unknown): boolean {
	return payload === null || (typeof payload === "string" && !payload.trim());
}
