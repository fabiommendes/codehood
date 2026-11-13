/**
 * One grading pass over one submission: a score, an optional comment, and
 * whoever produced it.
 *
 * Passes accumulate rather than replace. Each carries a `ref` its writer
 * chose, unique within the submission, so `(submission, ref)` addresses one
 * pass and the newest is the current verdict. A pass is written by the course's instructor
 * or by a bot acting as SYSTEM; the graded student reads it only once the exam
 * releases it.
 */
import type { z } from "zod";
import { type Actor, SYSTEM } from "@/auth/actor";
import type { FeedbackTarget, ResponseWithCourse } from "@/auth/permissions";
import { ensurePerm, hasPerm } from "@/auth/permissions";
import {
	ImproperBehavior,
	InvalidData,
	NotAllowed,
	NotFound,
} from "@/core/error";
import type { CourseRef, FeedbackId } from "@/core/schemas";
import {
	feedbackCreate,
	feedbackFilter,
	feedbackPK,
	feedbackSchema,
	feedbackUpdate,
} from "@/core/schemas";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import {
	checkExpectedUpdatedAt,
	checkVersion,
	guardedDelete,
	guardedUpdate,
	touch,
} from "@/db/conditional-write";
import { defineService, op } from "@/db/define-service";
import { m } from "@/i18n";
import { released } from "@/services/exam-state";
import { needsReview } from "@/services/rubric";
import { DbNull, type Prisma, type PrismaTx } from "../client";
import {
	courseRefMatch,
	courseRefWhere,
	exceptionSchedule,
	invalidIfExists,
	valueOrNotFound,
} from "../utils";
import { gradeWithRubric } from "./rubric-store";
import { examTimingFromDb, examTimingSelect } from "./submission.service";

export type { FeedbackId };

//
// Type definitions
//
export type Feedback = z.infer<typeof feedbackSchema>;
export type FeedbackCreate = z.infer<typeof feedbackCreate>;
export type FeedbackFilter = z.infer<typeof feedbackFilter>;
export type FeedbackPK = z.infer<typeof feedbackPK>;
export type FeedbackUpdate = z.infer<typeof feedbackUpdate>;

/// The relations needed to compute the exam's release, shared by every query
/// that has to resolve a submission's course and release rule.
export function examReleaseSelect() {
	return {
		...examTimingSelect,
		gradesReleasedAt: true,
		courseId: true,
		exceptions: {
			select: { username: true, extraTimeMs: true, scheduledAt: true },
		},
		course: {
			select: {
				instructor: { select: { username: true } },
				enrollments: {
					where: { status: "ACTIVE" as const },
					select: { username: true },
				},
			},
		},
	} satisfies Prisma.ExamSelect;
}

/// The relations needed to resolve a submission's author, course and release rule.
function submissionReleaseInclude() {
	return {
		response: {
			include: {
				exam: { select: examReleaseSelect() },
			},
		},
	} satisfies Prisma.SubmissionInclude;
}

type DbSubmission = Prisma.SubmissionGetPayload<{
	include: ReturnType<typeof submissionReleaseInclude>;
}>;

/// The relations a feedback row needs to answer both "who may read this" and
/// "has the exam released it", plus the rubric items it applies.
function feedbackInclude() {
	return {
		submission: { include: submissionReleaseInclude() },
		rubricItems: { include: { item: true } },
	} satisfies Prisma.FeedbackInclude;
}

type DbFeedback = Prisma.FeedbackGetPayload<{
	include: ReturnType<typeof feedbackInclude>;
}>;

type ExamRelease = DbFeedback["submission"]["response"]["exam"];

/// The CRUD shape of the service.
type FeedbackT = {
	entity: Feedback;
	pkFilter: FeedbackPK;
	create: FeedbackCreate;
	filter: FeedbackFilter;
	update: FeedbackUpdate;
};

/** The service of `client` (the shared client by default). */
export const makeFeedbackService = defineService<FeedbackT>()(() => {
	/**
	 * Records a grading pass against a submission, under `input.ref`.
	 *
	 * The grader is the actor unless a `botId` says a bot graded; exactly one
	 * of the two identifies it.
	 *
	 * The submission's status becomes `GRADED_MANUALLY` when a user graded and
	 * `GRADED_AUTOMATICALLY` when a bot did, whatever it was before, in the same
	 * transaction as the pass. A refused write leaves it untouched.
	 *
	 * @throws {@link NotFound}
	 * If no submission matches `input.submission`, or `actor` may not even read
	 * the one that does.
	 * @throws {@link InvalidData}
	 * If neither or both of `graderId` and `botId` are given, or if the
	 * submission already carries a pass under `input.ref`.
	 * @throws {@link NotAllowed}
	 * If `actor` may read the submission but not grade it.
	 */
	const create = op({
		args: [feedbackCreate],
		returns: feedbackSchema,
		run: async (
			tx: PrismaTx,
			input: FeedbackCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<Feedback> => {
			const submission = await resolveGradableSubmission(
				tx,
				input.submission,
				opts.actor,
			);

			const { graderId, botId } = resolveGrader(input, opts.actor);
			const grade = await resolveNewGrade(tx, submission, input);

			const row = await invalidIfExists(tx.feedback.create, {
				data: {
					submissionId: submission.id,
					ref: input.ref,
					...newGradeData(grade),
					graderId,
					botId,
					feedback: input.feedback ?? null,
					notes: input.notes ?? null,
					blanks: input.blanks ?? DbNull,
				},
				include: feedbackInclude(),
			});
			await markGraded(tx, submission, graderId);

			return present(opts.actor, row);
		},
	});

	/**
	 * Finds a grading pass by `id`, or by the submission it grades and its
	 * `ref`.
	 *
	 * Visible to whoever teaches the course at any time, and to the graded
	 * student once the exam releases it. A pass the actor may not read is
	 * `null`, exactly as a missing one is.
	 */
	const findOne = op({
		transaction: false,
		args: [feedbackPK],
		returns: feedbackSchema.nullable(),
		run: async (
			tx: PrismaTx,
			filter: FeedbackPK,
			opts: ServiceOptsWithoutTx,
		): Promise<Feedback | null> => {
			const row = await tx.feedback.findFirst({
				where: feedbackWhere(filter),
				include: feedbackInclude(),
			});
			if (!row) return null;

			if (!canReadFeedback(opts.actor, row, new Date())) return null;
			return present(opts.actor, row);
		},
	});

	/**
	 * Lists the grading passes made in one course, narrowed to what `actor` may
	 * see.
	 *
	 * A student is narrowed in the database query to released passes over their
	 * own submissions. An `author` filter naming somebody else is refused
	 * rather than quietly emptied.
	 *
	 * @throws {@link NotAllowed}
	 * If `actor` may not read the course's contents at all, or names another
	 * author in `filter` while narrowed to their own rows.
	 */
	const findMany = op({
		transaction: false,
		args: [feedbackFilter],
		returns: feedbackSchema.array(),
		run: async (
			tx: PrismaTx,
			filter: FeedbackFilter,
			opts: ServiceOptsWithoutTx,
		): Promise<Feedback[]> => {
			const course = valueOrNotFound(
				"course",
				await tx.course.findUnique({
					where: courseRefWhere(filter.course),
					select: {
						id: true,
						instructor: { select: { username: true } },
						enrollments: {
							where: { status: "ACTIVE" as const },
							select: { username: true },
						},
					},
				}),
			);

			ensurePerm(opts.actor, "course.read-contents", course);

			const owner = isCourseOwner(opts.actor, course);
			const restrictTo = restrictToAuthor(opts.actor, owner, filter.author);

			const rows = await tx.feedback.findMany({
				where: {
					submission: {
						response: {
							exam: {
								courseId: course.id,
								...(filter.exam ? { slug: filter.exam } : {}),
							},
							...(restrictTo
								? { authorId: restrictTo }
								: filter.author
									? { authorId: filter.author }
									: {}),
						},
						...(filter.question ? { question: { slug: filter.question } } : {}),
						...(filter.submission ? submissionRefWhere(filter.submission) : {}),
					},
					...(filter.grader ? { graderId: filter.grader } : {}),
					...(filter.bot ? { botId: filter.bot } : {}),
					...(filter.automated !== undefined
						? filter.automated
							? { botId: { not: null } }
							: { graderId: { not: null } }
						: {}),
				},
				include: feedbackInclude(),
				orderBy: [{ submissionId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
			});

			const now = new Date();
			return rows
				.filter((row) => canReadFeedback(opts.actor, row, now))
				.map((row) => present(opts.actor, row));
		},
	});

	/**
	 * Revises a grading pass in place, moving its score, its comment or both.
	 *
	 * Who graded it never changes: a different grader records their own pass.
	 *
	 * @throws {@link NotFound}
	 * If no pass matches `filter`, or the actor may not read the one that does.
	 * @throws {@link NotAllowed} If `actor` may read the pass but not write it.
	 */
	const update = op({
		args: [feedbackPK, feedbackUpdate],
		returns: feedbackSchema,
		run: async (
			tx: PrismaTx,
			filter: FeedbackPK,
			fields: FeedbackUpdate,
			opts: ServiceOptsWithoutTx,
		): Promise<Feedback> => {
			const feedback = await writableFeedback(
				tx,
				filter,
				opts,
				"feedback.update",
			);
			await checkVersion(tx, "feedback", { id: feedback.id }, opts);

			const grade = await resolveGrade(
				tx,
				feedback.submission,
				fields,
				feedback,
			);

			const row = await guardedUpdate(
				tx,
				"feedback",
				{ id: feedback.id },
				{
					...(grade ? gradeData(grade) : {}),
					...(fields.feedback !== undefined
						? { feedback: fields.feedback }
						: {}),
					...(fields.notes !== undefined ? { notes: fields.notes } : {}),
					...(fields.blanks !== undefined
						? { blanks: fields.blanks ?? DbNull }
						: {}),
				},
				opts,
				{ include: feedbackInclude() },
			);

			return present(opts.actor, row);
		},
	});

	/**
	 * Writes the pass named by `input.ref`, revising it when it is already there.
	 *
	 * Keyed on `(submission, ref)`, never on `id`.
	 *
	 * Writing a new pass moves the submission's status as `create`
	 * does. Revising an existing pass leaves it as it is.
	 *
	 * @throws {@link NotFound}
	 * If no submission matches `input.submission`, or `actor` may not even read
	 * the one that does.
	 * Revising keeps the pass's original grader or bot; a grader or bot named
	 * in `input` must still be one the actor may write as.
	 *
	 * @throws {@link InvalidData}
	 * If both `graderId` and `botId` are given, or neither when writing a new
	 * pass.
	 * @throws {@link NotAllowed}
	 * If `actor` may read the submission but not grade it, or names a grader
	 * or bot it may not write as.
	 */
	const upsert = op({
		args: [feedbackCreate],
		returns: feedbackSchema,
		run: async (
			tx: PrismaTx,
			input: FeedbackCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<Feedback> => {
			const submission = await resolveGradableSubmission(
				tx,
				input.submission,
				opts.actor,
			);

			const existing = await tx.feedback.findUnique({
				where: {
					submissionId_ref: { submissionId: submission.id, ref: input.ref },
				},
				include: feedbackInclude(),
			});

			checkExpectedUpdatedAt(
				existing?.updatedAt ?? null,
				opts.expectedUpdatedAt,
			);

			if (existing) {
				// The pass keeps its grader, but naming one still has to be allowed.
				if (input.grader != null || input.bot != null) {
					resolveGrader(input, opts.actor);
				}
				if (input.score === undefined && input.rubric === undefined) {
					throw invalidGrade("score", m.errors_feedback_score_required());
				}
				const grade = await resolveGrade(
					tx,
					submission,
					{ ...input, adjustment: input.adjustment ?? null },
					existing,
				);
				const row = await guardedUpdate(
					tx,
					"feedback",
					{ id: existing.id },
					{
						...(grade ? gradeData(grade) : {}),
						feedback: input.feedback ?? null,
						notes: input.notes ?? null,
						blanks: input.blanks ?? DbNull,
					},
					opts,
					{ include: feedbackInclude() },
				);
				return present(opts.actor, row);
			}

			const { graderId, botId } = resolveGrader(input, opts.actor);
			const grade = await resolveNewGrade(tx, submission, input);
			const row = await invalidIfExists(tx.feedback.create, {
				data: {
					submissionId: submission.id,
					ref: input.ref,
					...newGradeData(grade),
					graderId,
					botId,
					feedback: input.feedback ?? null,
					notes: input.notes ?? null,
					blanks: input.blanks ?? DbNull,
				},
				include: feedbackInclude(),
			});
			await markGraded(tx, submission, graderId);

			return present(opts.actor, row);
		},
	});

	/**
	 * Removes a grading pass.
	 *
	 * The refs already written do not move, and the one deleted becomes free
	 * again.
	 *
	 * @throws {@link NotFound}
	 * If no pass matches `filter`, or the actor may not read the one that does.
	 * @throws {@link NotAllowed} If `actor` may read the pass but not write it.
	 */
	const remove = op({
		args: [feedbackPK],
		run: async (
			tx: PrismaTx,
			filter: FeedbackPK,
			opts: ServiceOptsWithoutTx,
		): Promise<void> => {
			const feedback = await writableFeedback(
				tx,
				filter,
				opts,
				"feedback.delete",
			);
			await checkVersion(tx, "feedback", { id: feedback.id }, opts);

			// The request that this pass accepted loses its `feedbackId` to the
			// cascade, which its read model shows.
			const accepted = await tx.regradeRequest.findUnique({
				where: { feedbackId: feedback.id },
				select: { id: true },
			});
			if (accepted) await touch(tx, "regradeRequest", { id: accepted.id }, {});
			await guardedDelete(tx, "feedback", { id: feedback.id }, opts);
		},
	});

	return { create, findOne, findMany, update, upsert, delete: remove };
});

/** The service, as built by {@link makeFeedbackService}. */
export type FeedbackService = ReturnType<typeof makeFeedbackService>;

// Private utilities -----------------------------------------------------------

/// Whether `exam` has released its grades to its students as of `now`, see {@link released}.
export function releasedToStudents(exam: ExamRelease, now: Date): boolean {
	return released(
		exceptionSchedule(
			{ ...examTimingFromDb(exam), gradesReleasedAt: exam.gradesReleasedAt },
			exam.exceptions,
			exam.course.enrollments.map((enrollment) => enrollment.username),
		),
		now,
	);
}

/// Whether `actor` teaches the course the graded work belongs to, or is SYSTEM.
export function isCourseOwner(
	actor: Actor,
	course: { instructor: { username: string } },
): boolean {
	if (actor === SYSTEM) return true;
	return actor.username === course.instructor.username;
}

/// The `where` matching whichever of a submission ref's primary keys `ref` carries, within its course if it names one.
function submissionRefWhere(
	ref: { id: number } | { publicId: string; course?: CourseRef },
): Prisma.SubmissionWhereInput {
	if ("id" in ref) return { id: ref.id };
	return {
		publicId: ref.publicId,
		...(ref.course !== undefined && {
			response: { exam: { course: courseRefMatch(ref.course) } },
		}),
	};
}

/// The `where` matching whichever of the primary keys `filter` carries.
function feedbackWhere(filter: FeedbackPK): Prisma.FeedbackWhereInput {
	if ("id" in filter) return { id: filter.id };
	return {
		submission: submissionRefWhere(filter.submission),
		ref: filter.ref,
	};
}

/// The permission target a response's row builds for `feedback.*`, minus release.
function responseTargetFrom(response: {
	authorId: string;
	exam: {
		course: {
			instructor: { username: string };
			enrollments: { username: string }[];
		};
	};
}): ResponseWithCourse {
	return {
		author: { username: response.authorId },
		course: response.exam.course,
	};
}

/// The full `feedback.read` target for one loaded feedback row, as of `now`.
function feedbackTarget(row: DbFeedback, now: Date): FeedbackTarget {
	const response = row.submission.response;
	return {
		...responseTargetFrom(response),
		released: releasedToStudents(response.exam, now),
	};
}

/// Whether `actor` may read `row` as of `now`.
function canReadFeedback(actor: Actor, row: DbFeedback, now: Date): boolean {
	return hasPerm(actor, "feedback.read", feedbackTarget(row, now));
}

/// Whether `actor` may read a submission whose response resolved to `response`.
function hasSubmissionReadAccess(
	actor: Actor,
	response: Parameters<typeof responseTargetFrom>[0],
): boolean {
	return hasPerm(actor, "submission.read", responseTargetFrom(response));
}

/**
 * The `authorId` a non-owner is narrowed to, or `undefined` for an owner.
 *
 * @throws {@link NotAllowed}
 * If a non-owner names a different author in the filter: the row set is
 * refused, not quietly emptied.
 */
function restrictToAuthor(
	actor: Actor,
	owner: boolean,
	requestedAuthor: string | undefined,
): string | undefined {
	if (owner) return undefined;

	// `owner` is only false for a UserActor: SYSTEM is always an owner.
	const username = (actor as { username: string }).username;
	if (requestedAuthor !== undefined && requestedAuthor !== username) {
		throw new NotAllowed("feedback.read");
	}
	return username;
}

/**
 * Finds the submission a grading write targets, resolving its release
 * relations and refusing an actor who may not even read it.
 *
 * @throws {@link NotFound}
 * If no submission matches `ref`, or `actor` may not read the one that does.
 * @throws {@link NotAllowed} If `actor` may read the submission but not grade it.
 */
async function resolveGradableSubmission(
	tx: PrismaTx,
	ref: { id: number } | { publicId: string; course?: CourseRef },
	actor: Actor,
): Promise<DbSubmission> {
	const submission = valueOrNotFound(
		"submission",
		await tx.submission.findFirst({
			where: submissionRefWhere(ref),
			include: submissionReleaseInclude(),
		}),
	);

	if (!hasSubmissionReadAccess(actor, submission.response)) {
		throw new NotFound("submission");
	}

	ensurePerm(actor, "feedback.create", responseTargetFrom(submission.response));
	return submission;
}

/// Sets a submission's status to reflect who graded it last: a user or a bot, moving the version of the response that shows it, and closes its open grading job when a user graded.
async function markGraded(
	tx: PrismaTx,
	submission: Pick<DbSubmission, "id" | "responseId" | "status">,
	graderId: string | null,
): Promise<void> {
	const status = graderId !== null ? "GRADED_MANUALLY" : "GRADED_AUTOMATICALLY";
	await tx.submission.update({
		where: { id: submission.id },
		data: { status },
	});
	if (status !== submission.status) {
		await touch(tx, "response", { id: submission.responseId }, {});
	}
	// A person's grade settles the submission: a worker's report would arrive late.
	if (graderId !== null) {
		await tx.gradingJob.updateMany({
			where: {
				submissionId: submission.id,
				state: { in: ["QUEUED", "CLAIMED"] },
			},
			data: { state: "DONE", leaseUntil: null },
		});
	}
}

/**
 * Resolves who graded a new pass: exactly one of `grader`/`bot`.
 *
 * `grader` defaults to a user actor's own username when neither is given.
 * Naming a different grader, or any bot, is refused for anyone but SYSTEM.
 * An actor authenticated by a BOT key writes as that bot instead: it never
 * grades as a human, and may only name its own bot.
 *
 * @throws {@link NotAllowed}
 * If a non-SYSTEM actor names a different grader or a bot, or a bot actor
 * names a grader or another bot.
 * @throws {@link InvalidData} If neither or both of `grader`/`bot` are set.
 */
function resolveGrader(
	input: { grader?: string | null; bot?: string | null },
	actor: Actor,
): { graderId: string | null; botId: string | null } {
	if (actor !== SYSTEM && actor.bot !== undefined) {
		if (input.grader != null) {
			throw new NotAllowed("feedback.create", {
				message: m.errors_feedback_bot_key_no_grader(),
			});
		}
		if (input.bot != null && input.bot !== actor.bot) {
			throw new NotAllowed("feedback.create", {
				message: m.errors_feedback_bot_key_own_name(),
			});
		}
		return { graderId: null, botId: actor.bot };
	}

	let graderId = input.grader ?? null;
	const botId = input.bot ?? null;

	if (actor !== SYSTEM) {
		if (graderId !== null && graderId !== actor.username) {
			throw new NotAllowed("feedback.create", {
				message: m.errors_feedback_grader_system_only(),
			});
		}
		if (graderId === null && botId === null) graderId = actor.username;
	}

	if ((graderId === null) === (botId === null)) {
		throw new InvalidData({
			grader: [
				{
					code: "invalid",
					message: m.errors_feedback_grader_xor_bot(),
				},
			],
		});
	}

	if (actor !== SYSTEM && botId !== null) {
		throw new NotAllowed("feedback.create", {
			message: m.errors_feedback_bot_system_only(),
		});
	}

	return { graderId, botId };
}

/**
 * Finds the pass a write targets, refusing an actor who may not write it.
 *
 * A pass the actor may not even read is `NotFound`; one they may read but not
 * write is `NotAllowed`.
 */
async function writableFeedback(
	tx: PrismaTx,
	filter: FeedbackPK,
	{ actor, expectedUpdatedAt }: ServiceOptsWithoutTx,
	action: "feedback.update" | "feedback.delete",
): Promise<DbFeedback> {
	const row = await tx.feedback.findFirst({
		where: feedbackWhere(filter),
		include: feedbackInclude(),
	});
	if (!row) {
		// A pass the caller expected to be there is a 412, unless the submission
		// that makes up its key is missing or unreadable too.
		if (
			expectedUpdatedAt instanceof Date &&
			(await keyHolderReadable(tx, filter, actor))
		) {
			checkExpectedUpdatedAt(null, expectedUpdatedAt);
		}
		throw new NotFound("feedback");
	}

	const target = responseTargetFrom(row.submission.response);
	if (
		!hasPerm(actor, action, target) &&
		!canReadFeedback(actor, row, new Date())
	) {
		// Hidden answers as missing: the version check must not reveal the pass.
		checkExpectedUpdatedAt(null, expectedUpdatedAt);
		throw new NotFound("feedback");
	}
	ensurePerm(actor, action, target);
	return row;
}

/// Whether the submission in the key of `filter` exists and `actor` may read it; true for a filter by `id`, which has no such part.
async function keyHolderReadable(
	tx: PrismaTx,
	filter: FeedbackPK,
	actor: Actor,
): Promise<boolean> {
	if ("id" in filter) return true;
	const submission = await tx.submission.findFirst({
		where: submissionRefWhere(filter.submission),
		include: submissionReleaseInclude(),
	});
	return (
		submission !== null && hasSubmissionReadAccess(actor, submission.response)
	);
}

/// The score of a pass and the rubric bookkeeping that goes with it.
interface Grade {
	score: string;
	rubricId: number | null;
	adjustment: string | null;
	/// Ids of the rubric items the pass applies; none for a score set by hand.
	itemIds: number[];
}

/// The `data` fields that write `grade` on a new pass.
function newGradeData(grade: Grade) {
	return {
		score: grade.score,
		rubricId: grade.rubricId,
		adjustment: grade.adjustment,
		rubricItems: { create: grade.itemIds.map((itemId) => ({ itemId })) },
	};
}

/// The `data` fields that write `grade` over an existing pass, replacing the items it applied.
function gradeData(grade: Grade) {
	const { rubricItems, ...fields } = newGradeData(grade);
	return { ...fields, rubricItems: { deleteMany: {}, ...rubricItems } };
}

/// The fields of a write that decide the score.
interface GradeFields {
	score?: string;
	rubric?: string[];
	adjustment?: string | null;
}

/// Refuses a grade whose fields contradict each other, keyed on `field`.
function invalidGrade(field: string, message: string): InvalidData {
	return new InvalidData({ [field]: [{ code: "invalid", message }] });
}

/// The grade of a new pass, which `resolveGrade` always decides.
async function resolveNewGrade(
	tx: PrismaTx,
	submission: Pick<DbSubmission, "questionId" | "response">,
	fields: GradeFields,
): Promise<Grade> {
	const grade = await resolveGrade(tx, submission, fields, null);
	if (grade === null) throw new ImproperBehavior("a new pass has no grade");
	return grade;
}

/**
 * Decides the score of a write: set by hand, computed from the rubric items,
 * or (for a revision of `existing` that only moves other fields) left alone,
 * in which case the result is `null`.
 *
 * Revising with only `adjustment` recomputes the items the pass already
 * applies; a retired item is accepted only if the pass already applied it.
 *
 * @throws {@link InvalidData}
 * If `score` comes with `rubric`, a new pass has neither, `adjustment` goes
 * to a pass not graded with the rubric, or the rubric refuses the items.
 */
async function resolveGrade(
	tx: PrismaTx,
	submission: Pick<DbSubmission, "questionId" | "response">,
	fields: GradeFields,
	existing: DbFeedback | null,
): Promise<Grade | null> {
	if (fields.score !== undefined && fields.rubric !== undefined) {
		throw invalidGrade("score", m.errors_feedback_score_and_rubric());
	}

	const adjustment = fields.adjustment ?? null;
	if (fields.rubric === undefined && fields.score !== undefined) {
		if (adjustment !== null) {
			throw invalidGrade(
				"adjustment",
				m.errors_feedback_adjustment_needs_rubric(),
			);
		}
		return {
			score: fields.score,
			rubricId: null,
			adjustment: null,
			itemIds: [],
		};
	}

	const applied = existing?.rubricItems ?? [];
	const target = {
		examId: submission.response.examId,
		questionRefId: submission.questionId,
	};
	if (fields.rubric !== undefined) {
		return gradeWithRubric(tx, target, {
			keys: fields.rubric,
			adjustment:
				fields.adjustment !== undefined
					? adjustment
					: (existing?.adjustment ?? null),
			alreadyApplied: new Set(applied.map((link) => link.itemId)),
		});
	}

	if (existing !== null && fields.adjustment === undefined) return null;
	if (existing === null || existing.rubricId === null) {
		throw existing === null
			? invalidGrade("score", m.errors_feedback_score_required())
			: invalidGrade("adjustment", m.errors_feedback_adjustment_needs_rubric());
	}
	return gradeWithRubric(tx, target, {
		keys: applied.map((link) => link.item.key),
		adjustment,
		alreadyApplied: new Set(applied.map((link) => link.itemId)),
	});
}

/// The minimal relation `fromDb` needs to fill in the pass's public reference
/// to the submission it grades, and the rubric items it applies.
type FeedbackFromDbRow = Prisma.FeedbackGetPayload<{
	include: {
		submission: { select: { publicId: true } };
		rubricItems: { include: { item: true } };
	};
}>;

/// The entity `actor` may see: whoever can grade the submission reads it whole;
/// anybody else loses `notes`, the rubric keys, `review` and the private comment of each item.
function present(actor: Actor, row: DbFeedback): Feedback {
	const feedback = fromDb(row);
	const canGrade = hasPerm(
		actor,
		"feedback.create",
		responseTargetFrom(row.submission.response),
	);
	if (canGrade) return feedback;

	const {
		notes: _notes,
		rubric: _rubric,
		review: _review,
		...visible
	} = feedback;
	return {
		...visible,
		rubricItems:
			feedback.rubricItems?.map(({ group, text, value, feedback }) => ({
				group,
				text,
				value,
				feedback,
			})) ?? null,
	};
}

/** Converts a database row into the feedback entity, notes and private rubric fields included. */
export function fromDb(row: FeedbackFromDbRow): Feedback {
	const applied =
		row.rubricId === null
			? null
			: [...row.rubricItems]
					.map((link) => link.item)
					.sort((a, b) => a.position - b.position);
	return {
		id: row.id as Feedback["id"],
		ref: row.ref as Feedback["ref"],
		submissionId: row.submissionId as Feedback["submissionId"],
		submission: row.submission.publicId,
		score: row.score,
		adjustment: row.adjustment,
		rubric: applied?.map((item) => item.key) ?? null,
		review: applied !== null && needsReview(applied),
		rubricItems:
			applied?.map((item) => ({
				key: item.key,
				group: item.group,
				text: item.text,
				value: item.value,
				comment: item.comment,
				feedback: item.feedback,
			})) ?? null,
		grader: row.graderId as Feedback["grader"],
		bot: row.botId,
		feedback: row.feedback,
		notes: row.notes,
		blanks: (row.blanks ?? null) as Feedback["blanks"],
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}
