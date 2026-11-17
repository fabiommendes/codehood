/**
 * Helpers that read the questions an exam carries and the timing an exam runs
 * under, shared by the services that grade, serve and edit them.
 *
 * Nothing here checks permissions and nothing here imports a service: the
 * callers do their own checks before reaching for these.
 */
import type { ExamId } from "@/core/schemas/base";
import type { ExamTiming, ExceptionTiming } from "@/services/exam-state";
import type { Prisma, PrismaTx } from "../client";
import { writeCache } from "../conditional-write";
import { fromMs } from "../utils";

/// The exam columns {@link examTimingFromDb} reads.
export const examTimingSelect = {
	status: true,
	type: true,
	scheduledAt: true,
	durationMs: true,
	extraTimeMs: true,
} satisfies Prisma.ExamSelect;

/** The {@link ExamTiming} of an exam row selected with {@link examTimingSelect}. */
export function examTimingFromDb(
	exam: Prisma.ExamGetPayload<{ select: typeof examTimingSelect }>,
): ExamTiming {
	return {
		type: exam.type,
		status: exam.status,
		scheduledAt: exam.scheduledAt,
		duration: fromMs(exam.durationMs),
		extraTime: fromMs(exam.extraTimeMs),
	};
}

/** The exception of `username` on the exam `examId` as far as timing goes, or `null` when there is none. */
export async function loadExceptionTiming(
	tx: PrismaTx,
	examId: number,
	username: string,
): Promise<ExceptionTiming | null> {
	const row = await tx.examException.findUnique({
		where: { examId_username: { examId: examId as ExamId, username } },
		select: { extraTimeMs: true, scheduledAt: true },
	});
	if (!row) return null;
	return {
		extraTime: fromMs(row.extraTimeMs),
		scheduledAt: row.scheduledAt,
	};
}

/// A question of an exam: its ref id, the id of its latest version, and the version the exam pins.
export interface PinnedQuestion {
	id: number;
	latestId: number | null;
	version: string | null;
}

/**
 * The version of a question that an exam pins, or its latest one, with the columns in `select`; `null` when it does not exist.
 *
 * It reads for the system, with no check of who may see the result.
 */
export async function unsafePinnedDocument<S extends Prisma.QuestionDataSelect>(
	tx: PrismaTx,
	question: PinnedQuestion,
	select: S,
): Promise<Prisma.QuestionDataGetPayload<{ select: S }> | null> {
	return tx.questionData.findFirst({
		where: question.version
			? { refId: question.id, versionHash: question.version }
			: { id: question.latestId ?? -1 },
		select,
	});
}

/**
 * The version of each question that its exam pins, or its latest one, in the order of `questions`, with the columns in `select`.
 *
 * It reads for the system, with one query for all the questions. A question whose version does not exist gives `null`.
 */
export async function unsafePinnedDocuments<
	S extends Prisma.QuestionDataSelect,
>(
	tx: PrismaTx,
	questions: readonly PinnedQuestion[],
	select: S,
): Promise<(Prisma.QuestionDataGetPayload<{ select: S }> | null)[]> {
	const latestIds = questions.flatMap((q) =>
		!q.version && q.latestId !== null ? [q.latestId] : [],
	);
	const pinned = questions.flatMap((q) =>
		q.version ? [{ refId: q.id, versionHash: q.version }] : [],
	);
	if (latestIds.length === 0 && pinned.length === 0) {
		return questions.map(() => null);
	}

	const rows = (await tx.questionData.findMany({
		// An empty `in` renders as `1=0 OR …`, which SQLite answers with a scan.
		where: {
			OR: [...(latestIds.length ? [{ id: { in: latestIds } }] : []), ...pinned],
		},
		select: { ...select, id: true, refId: true, versionHash: true },
	})) as unknown as {
		id: number;
		refId: number;
		versionHash: string;
	}[];
	const byId = new Map(rows.map((row) => [row.id, row]));
	const byHash = new Map(
		rows.map((row) => [`${row.refId}:${row.versionHash}`, row]),
	);
	return questions.map(
		(q) =>
			(q.version
				? byHash.get(`${q.id}:${q.version}`)
				: byId.get(q.latestId ?? -1)) ?? null,
	) as (Prisma.QuestionDataGetPayload<{ select: S }> | null)[];
}

/**
 * Pins the latest version on every unpinned question of the exam and sets `questionsFrozenAt`.
 *
 * It does nothing for a `PRACTICE` exam or one that is already frozen, and leaves a pinned question and a question with no version as they are. Each pin is written only where `version` is still null, so two concurrent calls agree. The stamp keeps the exam's `updatedAt`: freezing is a side effect of an attempt, not an edit that a client holding the old version should lose to.
 */
export async function freezeQuestionVersions(
	tx: PrismaTx,
	examId: ExamId,
): Promise<void> {
	const exam = await tx.exam.findUnique({
		where: { id: examId },
		select: { type: true, questionsFrozenAt: true },
	});
	if (!exam || exam.type === "PRACTICE" || exam.questionsFrozenAt) return;

	const unpinned = await tx.questionsForExam.findMany({
		where: { examId, version: null },
		select: {
			questionRefId: true,
			questionRef: { select: { latest: { select: { versionHash: true } } } },
		},
	});
	for (const row of unpinned) {
		const hash = row.questionRef.latest?.versionHash;
		if (!hash) continue;
		await tx.questionsForExam.updateMany({
			where: { examId, questionRefId: row.questionRefId, version: null },
			data: { version: hash },
		});
	}
	await writeCache(
		tx,
		"exam",
		{ id: examId },
		{
			questionsFrozenAt: new Date(),
		},
	);
}

/** The latest version of each question ref in `refIds`, by ref id; a question with no version is absent. */
export async function latestVersions(
	tx: PrismaTx,
	refIds: number[],
): Promise<Map<number, string>> {
	const refs = await tx.questionRef.findMany({
		where: { id: { in: refIds } },
		select: { id: true, latest: { select: { versionHash: true } } },
	});
	return new Map(
		refs.flatMap((ref) =>
			ref.latest ? [[ref.id, ref.latest.versionHash] as const] : [],
		),
	);
}
