/**
 * The grading queue as seen from the student's side: sending a `code` answer to
 * its worker, and what that costs.
 *
 * Shared by `response.submit` and the closing of an attempt. Never calls out of
 * the database, and an autosave never reaches it.
 */

import { generateToken } from "@/auth/token";
import { NotAllowed } from "@/core/error";
import type { QuestionRefId, ResponseId } from "@/core/schemas";
import { guardedUpdate } from "@/db/conditional-write";
import { m } from "@/i18n";
import { DEFAULT_CODE_ATTEMPTS, spentAttempts } from "@/services/code-grading";
import type { Prisma, PrismaTx } from "../client";

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

/**
 * Stores a `SUBMIT` or `FINAL` submission together with its queued job, and
 * cancels the job a worker has not claimed yet for the same question.
 *
 * Returns the id of the new submission.
 *
 * @throws {@link NotAllowed} 409, when a worker holds the previous job or the sends are spent.
 */
export async function enqueueGradingJob(
	tx: PrismaTx,
	target: SendTarget,
	worker: string,
	submission: SendSubmission,
): Promise<number> {
	const open = await tx.gradingJob.findMany({
		where: {
			state: { in: ["QUEUED", "CLAIMED"] },
			submission: {
				responseId: target.responseId,
				questionId: target.questionId,
			},
		},
		select: { id: true, state: true },
	});
	if (open.some((job) => job.state === "CLAIMED")) {
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
	return created.id;
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
			console.error(
				`attempt ${response.id}: could not send the last autosave of question ${question.id}`,
				error,
			);
		}
	}
}
