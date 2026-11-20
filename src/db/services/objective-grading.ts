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
import { fromMs } from "../utils";
import { examTimingSelect } from "./exam-questions";
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
		select: { examId: true },
	});
	if (!response) return 0;
	return gradeAttempts(tx, response.examId, [responseId], options);
}

/// Grades the attempts `responseIds` of one exam as {@link gradeObjectives} does, with the same statements whatever their number.
async function gradeAttempts(
	tx: PrismaTx,
	examId: number,
	responseIds: ResponseId[],
	options: { dryRun?: boolean },
): Promise<number> {
	if (responseIds.length === 0) return 0;

	// Chosen in SQL through the index on `(responseId, questionId, kind, createdAt)`, so only the counting submissions are read. The instructor's grade for an unanswered question is never scored by the library.
	const newest = await tx.$queryRawUnsafe<{ id: number | bigint }[]>(
		`WITH pairs AS (
			SELECT DISTINCT s.responseId AS r, s.questionId AS q, s.kind AS k
			FROM json_each(?) a
			CROSS JOIN Submission s ON s.responseId = a.value
		)
		SELECT id FROM (
			SELECT s.id AS id, ROW_NUMBER() OVER (
				PARTITION BY s.responseId, s.questionId
				ORDER BY s.createdAt DESC, s.id DESC
			) AS position
			FROM pairs
			JOIN Submission s ON s.id = (
				SELECT t.id FROM Submission t
				WHERE t.responseId = r AND t.questionId = q AND t.kind = k
					AND t.createdById IS NULL
				ORDER BY t.createdAt DESC, t.id DESC LIMIT 1
			)
		) WHERE position = 1`,
		JSON.stringify(responseIds),
	);
	// No `orderBy`: with one, Prisma cannot split a long `in` list into
	// batches, and an exam with about 1000 answers exceeds SQLite's parameter
	// limit. Each submission is graded on its own, so the order does not matter.
	const counting = await tx.submission.findMany({
		where: { id: { in: newest.map((row) => Number(row.id)) } },
		select: {
			id: true,
			status: true,
			payload: true,
			responseId: true,
			question: { select: { id: true, latestId: true } },
		},
	});

	// Read apart from the submissions: a `_count` of the relation makes Prisma
	// aggregate the whole `Feedback` table before joining.
	const passes = await tx.feedback.findMany({
		where: { submissionId: { in: counting.map((s) => s.id) } },
		select: { submissionId: true },
	});
	const alreadyGraded = new Set(passes.map((pass) => pass.submissionId));

	// Every attempt answers the same questions: each document is read once.
	const documents = new Map<
		number,
		Awaited<ReturnType<typeof privateDocument>>
	>();
	const touched = new Set<ResponseId>();
	let graded = 0;
	for (const submission of counting) {
		if (alreadyGraded.has(submission.id)) continue;
		if (submission.status === "WILL_NOT_GRADE") continue;

		let document = documents.get(submission.question.id);
		if (!document) {
			document = await privateDocument(tx, examId, submission.question);
			documents.set(submission.question.id, document);
		}
		const score = objectiveScore(document, submission.payload);
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
		touched.add(submission.responseId);
	}
	for (const id of touched) await touch(tx, "response", { id }, {});
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
	const exceptions = new Map(
		(
			await tx.examException.findMany({
				where: { examId: exam.id },
				select: { username: true, extraTimeMs: true, scheduledAt: true },
			})
		).map((row) => [
			row.username,
			{ extraTime: fromMs(row.extraTimeMs), scheduledAt: row.scheduledAt },
		]),
	);
	const expired: ResponseId[] = [];
	for (const response of responses) {
		if (
			response.acceptingSubmissions &&
			!attemptTimedOut(
				{ createdAt: response.createdAt, preview: response.preview, exam },
				now,
				exceptions.get(response.authorId) ?? null,
			)
		) {
			continue;
		}
		expired.push(response.id);
	}
	const graded = await gradeAttempts(tx, exam.id, expired, {
		dryRun: options.dryRun,
	});
	return { attempts: expired.length, graded };
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
