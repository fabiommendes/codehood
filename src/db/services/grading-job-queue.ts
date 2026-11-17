/**
 * The grading queue as seen from the student's side: sending a `code` answer to
 * its worker, and what that costs.
 *
 * Shared by `response.submit` and the closing of an attempt. Never calls out of
 * the database, and an autosave never reaches it.
 */

import { generateToken } from "@/auth/token";
import { NotAllowed } from "@/core/error";
import type { QuestionRefId, ResponseId } from "@/core/schemas/base";
import { guardedUpdate } from "@/db/conditional-write";
import { m } from "@/i18n";
import { DEFAULT_CODE_ATTEMPTS, spentAttempts } from "@/services/code-grading";
import type { Prisma, PrismaTx } from "../client";
import { realAttemptSql } from "../preview-filter";
import {
	attemptTimedOut,
	examTimingSelect,
	loadExceptionTiming,
} from "./submission.service";

/// The (attempt, question) pair a send belongs to, with the question's send policy.
export interface SendTarget {
	responseId: ResponseId;
	questionId: QuestionRefId;
	/// The question's `attempts` column; null takes the default.
	attempts: number | null;
	/// A practice attempt has unlimited sends.
	practice: boolean;
}

/// What the new submission holds besides the ones the queue fixes.
export interface SendSubmission {
	kind: "SUBMIT" | "FINAL";
	payload: Prisma.InputJsonValue;
	startedAt?: Date | null;
	automaticallyTriggered?: boolean;
}

/**
 * How many sends the student has spent on a question in an attempt.
 *
 * A send is a `SUBMIT` or `FINAL` whose job is done, unless it failed its pretest.
 */
export async function countSpentSends(
	tx: PrismaTx,
	responseId: number,
	questionId: number,
): Promise<number> {
	const sent = await tx.submission.findMany({
		where: {
			responseId,
			questionId,
			kind: { in: ["SUBMIT", "FINAL"] },
		},
		select: {
			kind: true,
			status: true,
			gradingJob: { select: { state: true } },
		},
	});
	return spentAttempts(
		sent.map((row) => ({
			kind: row.kind,
			status: row.status,
			jobState: row.gradingJob?.state ?? null,
		})),
	);
}

/// The text of a payload in one stable form: object keys sorted at every depth, arrays kept in order.
function canonicalPayload(value: unknown): string {
	const sorted = (node: unknown): unknown => {
		if (Array.isArray(node)) return node.map(sorted);
		if (node !== null && typeof node === "object") {
			return Object.fromEntries(
				Object.entries(node)
					.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
					.map(([key, item]) => [key, sorted(item)]),
			);
		}
		return node;
	};
	return JSON.stringify(sorted(value)) ?? "null";
}

/**
 * The earlier send of the question whose code is the same as `payload`, if its job is still alive or finished.
 *
 * Any send of the attempt counts, not only the last. A send whose job `FAILED` (infrastructure) or was `CANCELLED` (replaced before it ran) has no result to show, so it never matches: sending again must queue a new job.
 */
async function findSentTwin(
	tx: PrismaTx,
	target: SendTarget,
	payload: Prisma.InputJsonValue,
): Promise<number | null> {
	const wanted = canonicalPayload(payload);
	const sent = await tx.submission.findMany({
		where: {
			responseId: target.responseId,
			questionId: target.questionId,
			kind: { in: ["SUBMIT", "FINAL"] },
			gradingJob: { state: { in: ["QUEUED", "CLAIMED", "DONE"] } },
		},
		select: { id: true, payload: true },
		orderBy: { id: "desc" },
	});
	return (
		sent.find((row) => canonicalPayload(row.payload) === wanted)?.id ?? null
	);
}

/**
 * Stores a `SUBMIT` or `FINAL` submission together with its queued job, and
 * cancels the job no worker holds for the same question: one still queued, or
 * one whose lease ran out.
 *
 * When an earlier send of the question carries the same code and its job is queued, running or done, nothing is stored or cancelled, no send is spent, and that send's id comes back with `duplicate`.
 *
 * Returns the id of the submission that stands for the send.
 *
 * @throws {@link NotAllowed} 409, when a worker holds the previous job or the sends are spent.
 */
export async function enqueueGradingJob(
	tx: PrismaTx,
	target: SendTarget,
	worker: string,
	submission: SendSubmission,
): Promise<{ id: number; duplicate: boolean }> {
	const twin = await findSentTwin(tx, target, submission.payload);
	if (twin !== null) return { id: twin, duplicate: true };

	const open = await tx.gradingJob.findMany({
		where: {
			state: { in: ["QUEUED", "CLAIMED"] },
			submission: {
				responseId: target.responseId,
				questionId: target.questionId,
			},
		},
		select: { id: true, state: true, leaseUntil: true },
	});
	const now = new Date();
	// A lease that ran out no longer holds the job: the worker is gone or late.
	const held = (job: (typeof open)[number]) =>
		job.state === "CLAIMED" && !(job.leaseUntil && job.leaseUntil <= now);
	if (open.some(held)) {
		throw new NotAllowed("response.submit", {
			status: 409,
			message: m.errors_code_send_waiting(),
		});
	}
	if (
		!target.practice &&
		(await countSpentSends(tx, target.responseId, target.questionId)) >=
			(target.attempts ?? DEFAULT_CODE_ATTEMPTS)
	) {
		throw new NotAllowed("response.submit", {
			status: 409,
			message: m.errors_code_sends_spent(),
		});
	}

	// The new rows first: whatever fails later leaves the older send standing.
	const created = await tx.submission.create({
		data: {
			publicId: generateToken(9),
			responseId: target.responseId,
			questionId: target.questionId,
			kind: submission.kind,
			payload: submission.payload,
			startedAt: submission.startedAt ?? null,
			automaticallyTriggered: submission.automaticallyTriggered ?? false,
			gradingJob: { create: { worker } },
		},
		select: { id: true },
	});
	for (const job of open) {
		await guardedUpdate(
			tx,
			"gradingJob",
			{ id: job.id },
			{ state: "CANCELLED" },
			{},
		);
	}
	return { id: created.id, duplicate: false };
}

/**
 * On closing an attempt, sends the last autosave of each worker-graded `code`
 * question that was typed after its last send.
 *
 * It never fails the close: a question that cannot be sent (job claimed, sends
 * spent) is skipped, and any other error is logged and skipped.
 */
export async function promoteFinalSends(
	tx: PrismaTx,
	response: { id: ResponseId; practice: boolean },
): Promise<void> {
	const questions = await tx.questionRef.findMany({
		where: {
			worker: { not: null },
			submissions: { some: { responseId: response.id, kind: "AUTOSAVE" } },
		},
		select: { id: true, worker: true, attempts: true },
	});
	for (const question of questions) {
		try {
			const newest = await tx.submission.findFirst({
				where: { responseId: response.id, questionId: question.id },
				orderBy: { id: "desc" },
				select: { kind: true, payload: true },
			});
			if (newest?.kind !== "AUTOSAVE" || typeof newest.payload !== "string") {
				continue;
			}
			const lastSent = await tx.submission.findFirst({
				where: {
					responseId: response.id,
					questionId: question.id,
					kind: { in: ["SUBMIT", "FINAL"] },
				},
				orderBy: { id: "desc" },
				select: { payload: true },
			});
			if (lastSent?.payload === newest.payload || !question.worker) continue;
			await enqueueGradingJob(
				tx,
				{
					responseId: response.id,
					questionId: question.id,
					attempts: question.attempts,
					practice: response.practice,
				},
				question.worker,
				{ kind: "FINAL", payload: newest.payload },
			);
		} catch (error) {
			if (error instanceof NotAllowed && error.status === 409) continue;
			// The send may have written its submission before the job failed: take it back.
			await tx.submission
				.deleteMany({
					where: {
						responseId: response.id,
						questionId: question.id,
						kind: "FINAL",
						gradingJob: null,
					},
				})
				.catch(() => undefined);
			console.error(
				`attempt ${response.id}: could not send the last autosave of question ${question.id}`,
				error,
			);
		}
	}
}

/// Which attempts {@link promoteExpiredSends} looks at.
export interface ExpiredScope {
	/// Only courses this user teaches.
	instructor: string;
	/// Only questions graded by one of these workers.
	workers: string[];
	/// Narrows the courses, e.g. by discipline or edition.
	course?: Prisma.CourseWhereInput;
	/// Only the exam with this slug.
	exam?: string;
	/// Narrows the questions by slug.
	questions?: string[];
}

/// A list of `count` SQL placeholders.
const placeholders = (count: number) => Array(count).fill("?").join(", ");

/// The SQL that finds the open attempts of some exams holding an unsent autosave: the newest submission of a worker's question is an autosave that differs from the last send.
///
/// It walks the attempts and probes the newest submission of each question through the index on `(responseId, questionId)`, so its cost follows the open attempts and not the size of `Submission`. Its parameters are the exam ids, the workers and then the question slugs.
export function unsentAutosaveSql(count: {
	exams: number;
	workers: number;
	questions?: number;
}): string {
	const questionFilter =
		count.questions === undefined
			? ""
			: `AND q.slug IN (${placeholders(count.questions)})`;
	return `
		SELECT r.id AS id
		FROM ResponseRef r
		WHERE r.acceptingSubmissions = 1
			AND ${realAttemptSql("r")}
			AND r.examId IN (${placeholders(count.exams)})
			AND EXISTS (
				SELECT 1
				FROM QuestionRef q
				JOIN Submission s ON s.id = (
					SELECT max(t.id) FROM Submission t
					WHERE t.responseId = r.id AND t.questionId = q.id
				)
				WHERE q.worker IN (${placeholders(count.workers)})
					${questionFilter}
					AND s.kind = 'AUTOSAVE'
					AND s.payload IS NOT (
						SELECT t.payload FROM Submission t
						WHERE t.responseId = r.id AND t.questionId = q.id
							AND t.kind IN ('SUBMIT', 'FINAL')
						ORDER BY t.id DESC LIMIT 1
					)
			)`;
}

/**
 * Sends the last autosave of every attempt whose time ran out and was never closed, so a student who did not press "send" still gets graded.
 *
 * Practice attempts and attempts that would still take an autosave are left alone. A failure on one attempt is logged and the others go on.
 */
export async function promoteExpiredSends(
	tx: PrismaTx,
	scope: ExpiredScope,
	now: Date = new Date(),
): Promise<void> {
	// An exam that is neither completed nor timed has no deadline to run out.
	const exams = await tx.exam.findMany({
		where: {
			...(scope.exam ? { slug: scope.exam } : {}),
			type: { not: "PRACTICE" },
			status: { in: ["ONGOING", "SCHEDULED", "COMPLETED"] },
			OR: [{ status: "COMPLETED" }, { durationMs: { not: null } }],
			course: { ...scope.course, instructorId: scope.instructor },
			questionsForExams: {
				some: {
					questionRef: {
						worker: { in: scope.workers },
						...(scope.questions ? { slug: { in: scope.questions } } : {}),
					},
				},
			},
		},
		select: { id: true, ...examTimingSelect },
	});
	if (exams.length === 0) return;

	const examIds = exams.map((exam) => exam.id);
	const candidates = await tx.$queryRawUnsafe<{ id: number | bigint }[]>(
		unsentAutosaveSql({
			exams: examIds.length,
			workers: scope.workers.length,
			...(scope.questions ? { questions: scope.questions.length } : {}),
		}),
		...examIds,
		...scope.workers,
		...(scope.questions ?? []),
	);
	if (candidates.length === 0) return;

	const responses = await tx.response.findMany({
		where: { id: { in: candidates.map((row) => Number(row.id)) } },
		select: {
			id: true,
			createdAt: true,
			examId: true,
			authorId: true,
			preview: true,
		},
	});
	const examOf = new Map(exams.map((exam) => [exam.id, exam]));
	for (const response of responses) {
		try {
			const exam = examOf.get(response.examId);
			if (!exam) continue;
			const exception = await loadExceptionTiming(
				tx,
				response.examId,
				response.authorId,
			);
			if (
				!attemptTimedOut(
					{ createdAt: response.createdAt, preview: response.preview, exam },
					now,
					exception,
				)
			) {
				continue;
			}
			await promoteFinalSends(tx, {
				id: response.id as ResponseId,
				practice: false,
			});
		} catch (error) {
			console.error(
				`attempt ${response.id}: could not send the last autosave of an expired attempt`,
				error,
			);
		}
	}
}
