/**
 * Helpers that read the questions an exam carries and the timing an exam runs
 * under, shared by the services that grade, serve and edit them.
 *
 * Nothing here checks permissions and nothing here imports a service: the
 * callers do their own checks before reaching for these.
 */
import type { Actor } from "@/auth/actor";
import type {
	CourseId,
	ExamId,
	QuestionDataId,
	QuestionRefId,
	ResponseId,
} from "@/core/schemas/base";
import type { CourseRef } from "@/core/schemas/course";
import type { PublicQuestion, QuestionDocument } from "@/mdq";
import type { ExamTiming, ExceptionTiming } from "@/services/exam-state";
import type { Prisma, PrismaTx } from "../client";
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

declare const grantBrand: unique symbol;

/// `answer`: the public half. `review`: the public half plus what the review derives from the key.
export type GrantView = "answer" | "review";

/** Proof that `username` may read the questions of one exam, through one attempt or after its release. */
export interface ExamGrant {
	readonly [grantBrand]: true;
	readonly username: string;
	readonly courseId: CourseId;
	readonly examId: ExamId;
	/// `null` only for a student who missed the exam.
	readonly responseId: ResponseId | null;
	readonly view: GrantView;
	/// Whether the attempt still takes answers; pretest sources leave only then.
	readonly answering: boolean;
	/// Each question at the version resolved when the grant was issued, in exam order.
	readonly questions: readonly {
		refId: QuestionRefId;
		slug: string;
		dataId: QuestionDataId;
		version: string;
	}[];
	readonly expiresAt: Date;
}

/// A question of a grant as `grantedQuestions` reads it: the public half of the version the grant resolved.
export interface GrantedQuestion {
	slug: string;
	version: string;
	question: PublicQuestion;
}

/** Issues the grant of `actor` for their attempt at the exam, or `null` when they have none to read through. */
export async function issueExamGrant(
	_tx: PrismaTx,
	_target: { course: CourseRef; exam: string } | { response: string },
	_actor: Actor,
	_now?: Date,
): Promise<ExamGrant | null> {
	throw new Error("not implemented");
}

/** What `actor` would be granted on each exam, by exam id, without resolving versions or writing anything. */
export async function grantViews(
	_tx: PrismaTx,
	_examIds: readonly ExamId[],
	_actor: Actor,
	_now?: Date,
): Promise<Map<ExamId, GrantView | null>> {
	throw new Error("not implemented");
}

/** @throws {@link ImproperBehavior} Not issued here, issued to someone else, or expired. */
export function assertExamGrant(
	_grant: ExamGrant,
	_actor: Actor,
	_now?: Date,
): void {
	throw new Error("not implemented");
}

/** The public half of every question of the grant, in exam order, in one query. */
export async function grantedQuestions(
	_tx: PrismaTx,
	_grant: ExamGrant,
	_actor: Actor,
): Promise<GrantedQuestion[]> {
	throw new Error("not implemented");
}

/// The private document of one question of the grant, for a sibling service that derives a student view from it.
export async function grantedDocument(
	_tx: PrismaTx,
	_grant: ExamGrant,
	_actor: Actor,
	_slug: string,
): Promise<QuestionDocument> {
	throw new Error("not implemented");
}

/** Stamps the latest version on every unpinned question of the exam and sets `questionsFrozenAt`. */
export async function freezeQuestionVersions(
	_tx: PrismaTx,
	_examId: number,
): Promise<void> {
	throw new Error("not implemented");
}
