/**
 * Helpers that read the questions an exam carries and the timing an exam runs
 * under, shared by the services that grade, serve and edit them.
 *
 * Nothing here checks permissions and nothing here imports a service: the
 * callers do their own checks before reaching for these.
 */
import { type Actor, SYSTEM } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import { PRACTICE_SESSION_WINDOW_MS } from "@/core/constants";
import { ImproperBehavior, NotFound } from "@/core/error";
import type {
	CourseId,
	ExamId,
	QuestionDataId,
	QuestionRefId,
	ResponseId,
	UserId,
} from "@/core/schemas/base";
import type { CourseRef } from "@/core/schemas/course";
import type { PublicQuestion, QuestionDocument } from "@/mdq";
import {
	type AttemptState,
	attemptOf,
	type ExamTiming,
	type ExceptionTiming,
	hiddenFromStudents,
	previewAttemptState,
	released,
} from "@/services/exam-state";
import type { Prisma, PrismaTx } from "../client";
import { writeCache } from "../conditional-write";
import { courseRefMatch, exceptionSchedule, fromMs } from "../utils";

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

/// A question's public half as the student reads it: `tags` stay out of the student's view.
type StudentQuestion = PublicQuestion extends infer Q
	? Q extends unknown
		? Omit<Q, "tags">
		: never
	: never;

/// A question of a grant as `grantedQuestions` reads it: the public half of the version the grant resolved.
export interface GrantedQuestion {
	slug: string;
	version: string;
	question: StudentQuestion;
}

/// How long a grant lasts after it is issued.
const GRANT_TTL_MS = 60_000;

/// Every grant `issueExamGrant` made. It proves where a grant came from and is not a cache.
const issued = new WeakSet<object>();

/// The columns of an exam that a standing is decided from.
const standingSelect = {
	id: true,
	courseId: true,
	gradesReleasedAt: true,
	questionsFrozenAt: true,
	course: { select: { instructor: { select: { username: true } } } },
	...examTimingSelect,
} satisfies Prisma.ExamSelect;

/// The columns of an attempt that a standing is decided from.
const attemptSelect = {
	id: true,
	publicId: true,
	examId: true,
	authorId: true,
	preview: true,
	slotKey: true,
	createdAt: true,
	acceptingSubmissions: true,
	createdById: true,
} satisfies Prisma.ResponseSelect;

type AttemptRow = Prisma.ResponseGetPayload<{ select: typeof attemptSelect }>;

/// What an actor may read on one exam, before any question version is resolved.
interface Standing {
	view: GrantView | null;
	answering: boolean;
	responseId: ResponseId | null;
	simulation: boolean;
	exam: Prisma.ExamGetPayload<{ select: typeof standingSelect }>;
}

/// The view and `answering` flag that an attempt in `state` gets, per the issuing table.
function viewOf(
	state: AttemptState,
	released: boolean,
): { view: GrantView | null; answering: boolean } {
	switch (state.kind) {
		case "in-progress":
			return { view: "answer", answering: true };
		case "submitted":
			return { view: "answer", answering: false };
		case "results":
			return { view: "review", answering: false };
		case "missed":
			return { view: released ? "answer" : null, answering: false };
		default:
			return { view: null, answering: false };
	}
}

/// The attempt the grant reads through: the simulation for the instructor, the one real slot, or for `PRACTICE` the newest within the session window.
function pickAttempt(
	own: readonly AttemptRow[],
	exam: { type: string },
	simulation: boolean,
	now: Date,
): AttemptRow | null {
	if (simulation) return own.find((a) => a.preview) ?? null;
	const real = own.filter((a) => !a.preview);
	if (exam.type !== "PRACTICE")
		return real.find((a) => a.slotKey === 0) ?? null;
	const windowStart = Math.floor(
		(now.getTime() - PRACTICE_SESSION_WINDOW_MS) / 1000,
	);
	return real.find((a) => a.slotKey >= windowStart) ?? null;
}

/// What `actor` stands to read on each exam of `examIds`, in a fixed number of queries and with no write.
async function standings(
	tx: PrismaTx,
	examIds: readonly ExamId[],
	actor: Actor,
	now: Date,
	explicit?: AttemptRow,
): Promise<Map<ExamId, Standing>> {
	const result = new Map<ExamId, Standing>();
	if (actor === SYSTEM || examIds.length === 0) return result;

	const ids = [...examIds];
	const exams = await tx.exam.findMany({
		where: { id: { in: ids } },
		select: standingSelect,
	});
	const exceptions = await tx.examException.findMany({
		where: { examId: { in: ids } },
		select: {
			examId: true,
			username: true,
			extraTimeMs: true,
			scheduledAt: true,
		},
	});
	const enrollments = await tx.enrollment.findMany({
		where: {
			courseId: { in: [...new Set(exams.map((e) => e.courseId))] },
			status: "ACTIVE",
			username: {
				in: [
					...new Set([actor.username, ...exceptions.map((e) => e.username)]),
				],
			},
		},
		select: { courseId: true, username: true },
	});
	const attempts = explicit
		? [explicit]
		: await tx.response.findMany({
				where: { examId: { in: ids }, authorId: actor.username },
				orderBy: { slotKey: "desc" },
				select: attemptSelect,
			});

	for (const exam of exams) {
		const examId = exam.id as ExamId;
		const standing = (
			view: GrantView | null,
			answering: boolean,
			simulation: boolean,
			attempt: AttemptRow | null,
		): Standing => ({
			exam,
			view,
			answering,
			simulation,
			responseId: view && attempt ? (attempt.id as ResponseId) : null,
		});
		const active = enrollments
			.filter((e) => e.courseId === exam.courseId)
			.map((e) => e.username);
		const course = {
			instructor: exam.course.instructor,
			enrollments: active.includes(actor.username)
				? [{ username: actor.username as UserId }]
				: [],
		};
		if (!hasPerm(actor, "course.read-contents", course)) {
			result.set(examId, standing(null, false, false, null));
			continue;
		}

		const simulation = hasPerm(actor, "course.update-contents", course);
		const own = attempts.filter((a) => a.examId === exam.id);
		const attempt = pickAttempt(own, exam, simulation, now);
		if (explicit && !attempt) {
			result.set(examId, standing(null, false, simulation, null));
			continue;
		}

		const timing = {
			...examTimingFromDb(exam),
			gradesReleasedAt: exam.gradesReleasedAt,
		};
		if (simulation) {
			const state = previewAttemptState(timing, attempt, now);
			const { view, answering } = viewOf(state, true);
			result.set(examId, standing(view, answering, true, attempt));
			continue;
		}
		if (hiddenFromStudents(exam.status)) {
			result.set(examId, standing(null, false, false, null));
			continue;
		}
		const schedule = exceptionSchedule(
			timing,
			exceptions.filter((e) => e.examId === exam.id),
			active,
		);
		const releasedNow = released(schedule, now);
		// An empty attempt made for the student is a miss until the grades are out.
		const counted = attempt?.createdById && !releasedNow ? null : attempt;
		const state = attemptOf(schedule, actor.username, counted, now);
		const { view, answering } = viewOf(state, releasedNow);
		result.set(examId, standing(view, answering, false, counted));
	}
	return result;
}

/**
 * Issues the grant of `actor` for their attempt at the exam, or `null` when they have none to read through.
 *
 * The first grant of an exam that is not `PRACTICE` freezes its question versions, except for the instructor's simulation.
 */
export async function issueExamGrant(
	tx: PrismaTx,
	target: { course: CourseRef; exam: string } | { response: string },
	actor: Actor,
	now: Date = new Date(),
): Promise<ExamGrant | null> {
	if (actor === SYSTEM) return null;

	let examId: ExamId;
	let explicit: AttemptRow | undefined;
	if ("response" in target) {
		const row = await tx.response.findUnique({
			where: { publicId: target.response },
			select: attemptSelect,
		});
		if (!row || row.authorId !== actor.username) return null;
		explicit = row;
		examId = row.examId as ExamId;
	} else {
		const exam = await tx.exam.findFirst({
			where: { slug: target.exam, course: courseRefMatch(target.course) },
			select: { id: true },
		});
		if (!exam) return null;
		examId = exam.id as ExamId;
	}

	const standing = (await standings(tx, [examId], actor, now, explicit)).get(
		examId,
	);
	if (!standing?.view) return null;

	const { exam } = standing;
	if (
		!standing.simulation &&
		exam.type !== "PRACTICE" &&
		!exam.questionsFrozenAt
	) {
		await freezeQuestionVersions(tx, examId);
	}
	const rows = await tx.questionsForExam.findMany({
		where: { examId },
		orderBy: { position: "asc" },
		select: {
			questionRefId: true,
			version: true,
			questionRef: { select: { slug: true, latestId: true } },
		},
	});
	const documents = await unsafePinnedDocuments(
		tx,
		rows.map((row) => ({
			id: row.questionRefId,
			latestId: row.questionRef.latestId,
			version: row.version,
		})),
		{ id: true, versionHash: true },
	);
	const questions = rows.flatMap((row, i) => {
		const document = documents[i];
		if (!document) return [];
		return [
			Object.freeze({
				refId: row.questionRefId as QuestionRefId,
				slug: row.questionRef.slug,
				dataId: document.id as QuestionDataId,
				version: document.versionHash,
			}),
		];
	});

	const grant = Object.freeze({
		username: actor.username,
		courseId: exam.courseId as CourseId,
		examId,
		responseId: standing.responseId,
		view: standing.view,
		answering: standing.answering,
		questions: Object.freeze(questions),
		expiresAt: new Date(now.getTime() + GRANT_TTL_MS),
	}) as unknown as ExamGrant;
	issued.add(grant);
	return grant;
}

/** What `actor` would be granted on each exam, by exam id, without resolving versions or writing anything. */
export async function grantViews(
	tx: PrismaTx,
	examIds: readonly ExamId[],
	actor: Actor,
	now: Date = new Date(),
): Promise<Map<ExamId, GrantView | null>> {
	const found = await standings(tx, examIds, actor, now);
	return new Map(examIds.map((id) => [id, found.get(id)?.view ?? null]));
}

/** @throws {@link ImproperBehavior} Not issued here, issued to someone else, or expired. */
export function assertExamGrant(
	grant: ExamGrant,
	actor: Actor,
	now: Date = new Date(),
): void {
	ImproperBehavior.assert(issued.has(grant), "the exam grant was not issued");
	ImproperBehavior.assert(
		actor !== SYSTEM && actor.username === grant.username,
		"the exam grant belongs to someone else",
	);
	ImproperBehavior.assert(now < grant.expiresAt, "the exam grant expired");
}

/** The public half of every question of the grant, in exam order, in one query. */
export async function grantedQuestions(
	tx: PrismaTx,
	grant: ExamGrant,
	actor: Actor,
): Promise<GrantedQuestion[]> {
	assertExamGrant(grant, actor);
	if (grant.questions.length === 0) return [];

	const rows = await tx.questionData.findMany({
		where: { id: { in: grant.questions.map((q) => q.dataId) } },
		select: { id: true, publicPayload: true },
	});
	const byId = new Map(rows.map((row) => [row.id, row.publicPayload]));
	return grant.questions.flatMap((q) => {
		const payload = byId.get(q.dataId);
		if (!payload) return [];
		const { tags: _tags, ...question } = payload as unknown as PublicQuestion;
		return [{ slug: q.slug, version: q.version, question } as GrantedQuestion];
	});
}

/// The private document of one question of the grant, for a sibling service that derives a student view from it.
export async function grantedDocument(
	tx: PrismaTx,
	grant: ExamGrant,
	actor: Actor,
	slug: string,
): Promise<QuestionDocument> {
	assertExamGrant(grant, actor);
	const granted = grant.questions.find((q) => q.slug === slug);
	if (!granted) throw new NotFound("question", slug);
	const row = await tx.questionData.findUnique({
		where: { id: granted.dataId },
		select: { privatePayload: true },
	});
	if (!row) throw new NotFound("question", slug);
	return row.privatePayload as unknown as QuestionDocument;
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
