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
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import type { FeedbackId } from "@/core/schemas";
import {
	feedbackCreate,
	feedbackFilter,
	feedbackPK,
	feedbackSchema,
	feedbackUpdate,
} from "@/core/schemas";
import { CrudBase, type ServiceOptsWithoutTx } from "@/db/base-service";
import { Validate } from "@/utils/validate";
import type { Prisma, PrismaTx } from "../client";
import { examEndsAt } from "../util.exam-link";
import { courseRefWhere, invalidIfExists, valueOrNotFound } from "../utils";

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
function examReleaseSelect() {
	return {
		type: true,
		status: true,
		scheduledAt: true,
		durationMs: true,
		extraTimeMs: true,
		gradesReleasedAt: true,
		courseId: true,
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
/// "has the exam released it".
function feedbackInclude() {
	return {
		submission: { include: submissionReleaseInclude() },
	} satisfies Prisma.FeedbackInclude;
}

type DbFeedback = Prisma.FeedbackGetPayload<{
	include: ReturnType<typeof feedbackInclude>;
}>;

type ExamRelease = DbFeedback["submission"]["response"]["exam"];

export class FeedbackService extends CrudBase<{
	entity: Feedback;
	pkFilter: FeedbackPK;
	create: FeedbackCreate;
	filter: FeedbackFilter;
	update: FeedbackUpdate;
}> {
	/**
	 * Records a grading pass against a submission, under `input.ref`.
	 *
	 * The grader is the actor unless a `botId` says a bot graded; exactly one
	 * of the two identifies it.
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
	@Validate({
		service: true,
		returns: feedbackSchema,
		args: [undefined, feedbackCreate],
	})
	protected async createTx(
		tx: PrismaTx,
		input: FeedbackCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<Feedback> {
		const submission = await resolveGradableSubmission(
			tx,
			input.submission,
			opts.actor,
		);

		const { graderId, botId } = resolveGrader(input, opts.actor);

		const row = await invalidIfExists(tx.feedback.create, {
			data: {
				submissionId: submission.id,
				ref: input.ref,
				score: input.score,
				graderId,
				botId,
				feedback: input.feedback ?? null,
			},
			include: feedbackInclude(),
		});

		return fromDb(row);
	}

	/**
	 * Finds a grading pass by `id`, or by the submission it grades and its
	 * `ref`.
	 *
	 * Visible to whoever teaches the course at any time, and to the graded
	 * student once the exam releases it. A pass the actor may not read is
	 * `null`, exactly as a missing one is.
	 */
	@Validate({
		service: true,
		returns: feedbackSchema.nullable(),
		args: [undefined, feedbackPK],
	})
	protected async findOneTx(
		tx: PrismaTx,
		filter: FeedbackPK,
		opts: ServiceOptsWithoutTx,
	): Promise<Feedback | null> {
		const row = await tx.feedback.findFirst({
			where: feedbackWhere(filter),
			include: feedbackInclude(),
		});
		if (!row) return null;

		if (!canReadFeedback(opts.actor, row, new Date())) return null;
		return fromDb(row);
	}

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
	@Validate({
		service: true,
		returns: feedbackSchema.array(),
		args: [undefined, feedbackFilter],
	})
	protected async findManyTx(
		tx: PrismaTx,
		filter: FeedbackFilter,
		opts: ServiceOptsWithoutTx,
	): Promise<Feedback[]> {
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
			.map(fromDb);
	}

	/**
	 * Revises a grading pass in place, moving its score, its comment or both.
	 *
	 * Who graded it never changes: a different grader records their own pass.
	 *
	 * @throws {@link NotFound}
	 * If no pass matches `filter`, or the actor may not read the one that does.
	 * @throws {@link NotAllowed} If `actor` may read the pass but not write it.
	 */
	@Validate({
		service: true,
		returns: feedbackSchema,
		args: [undefined, feedbackPK, feedbackUpdate],
	})
	protected async updateTx(
		tx: PrismaTx,
		filter: FeedbackPK,
		fields: FeedbackUpdate,
		opts: ServiceOptsWithoutTx,
	): Promise<Feedback> {
		const feedback = await writableFeedback(
			tx,
			filter,
			opts.actor,
			"feedback.update",
		);

		const row = await tx.feedback.update({
			where: { id: feedback.id },
			data: {
				...(fields.score !== undefined ? { score: fields.score } : {}),
				...(fields.feedback !== undefined ? { feedback: fields.feedback } : {}),
			},
			include: feedbackInclude(),
		});

		return fromDb(row);
	}

	/**
	 * Writes the pass named by `input.ref`, revising it when it is already there.
	 *
	 * Keyed on `(submission, ref)`, never on `id`.
	 *
	 * @throws {@link NotFound}
	 * If no submission matches `input.submission`, or `actor` may not even read
	 * the one that does.
	 * @throws {@link InvalidData}
	 * If neither or both of `graderId` and `botId` are given, when writing a
	 * new pass.
	 * @throws {@link NotAllowed}
	 * If `actor` may read the submission but not grade it.
	 */
	@Validate({
		service: true,
		returns: feedbackSchema,
		args: [undefined, feedbackCreate],
	})
	protected async upsertTx(
		tx: PrismaTx,
		input: FeedbackCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<Feedback> {
		const submission = await resolveGradableSubmission(
			tx,
			input.submission,
			opts.actor,
		);

		const existing = await tx.feedback.findUnique({
			where: {
				submissionId_ref: { submissionId: submission.id, ref: input.ref },
			},
		});

		if (existing) {
			const row = await tx.feedback.update({
				where: { id: existing.id },
				data: {
					score: input.score,
					feedback: input.feedback ?? null,
				},
				include: feedbackInclude(),
			});
			return fromDb(row);
		}

		const { graderId, botId } = resolveGrader(input, opts.actor);
		const row = await invalidIfExists(tx.feedback.create, {
			data: {
				submissionId: submission.id,
				ref: input.ref,
				score: input.score,
				graderId,
				botId,
				feedback: input.feedback ?? null,
			},
			include: feedbackInclude(),
		});

		return fromDb(row);
	}

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
	@Validate({ service: true, args: [undefined, feedbackPK] })
	protected async deleteTx(
		tx: PrismaTx,
		filter: FeedbackPK,
		opts: ServiceOptsWithoutTx,
	): Promise<void> {
		const feedback = await writableFeedback(
			tx,
			filter,
			opts.actor,
			"feedback.delete",
		);

		await tx.feedback.delete({ where: { id: feedback.id } });
	}
}

// Private utilities -----------------------------------------------------------

/**
 * Whether `exam` has released its grades to its students as of `now`.
 *
 * A `PRACTICE` releases a score the moment it is written, a `QUIZ` once its
 * window has closed, and an `EXAM` only when its instructor says so. A `QUIZ`
 * with no `scheduledAt` has no window to close, so it falls back to the exam
 * being `COMPLETED`.
 */
export function releasedToStudents(exam: ExamRelease, now: Date): boolean {
	switch (exam.type) {
		case "PRACTICE":
			return true;
		case "QUIZ": {
			const endsAt = examEndsAt(exam);
			return endsAt ? endsAt <= now : exam.status === "COMPLETED";
		}
		default:
			return exam.gradesReleasedAt !== null && exam.gradesReleasedAt <= now;
	}
}

/// Whether `actor` teaches the course the graded work belongs to, or is SYSTEM.
export function isCourseOwner(
	actor: Actor,
	course: { instructor: { username: string } },
): boolean {
	if (actor === SYSTEM) return true;
	return actor.username === course.instructor.username;
}

/// The `where` matching whichever of a submission ref's primary keys `ref` carries.
function submissionRefWhere(
	ref: { id: number } | { publicId: string },
): Prisma.SubmissionWhereInput {
	return "id" in ref ? { id: ref.id } : { publicId: ref.publicId };
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
	response: {
		authorId: string;
		exam: {
			course: {
				instructor: { username: string };
				enrollments: { username: string }[];
			};
		};
	},
): boolean {
	if (isCourseOwner(actor, response.exam.course)) return true;
	return actor !== SYSTEM && actor.username === response.authorId;
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
	ref: { id: number } | { publicId: string },
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

/**
 * Resolves who graded a new pass: exactly one of `grader`/`bot`.
 *
 * `grader` defaults to a user actor's own username when neither is given.
 * Naming a different grader is refused for anyone but SYSTEM.
 *
 * @throws {@link NotAllowed} If a non-SYSTEM actor names a different grader.
 * @throws {@link InvalidData} If neither or both of `grader`/`bot` are set.
 */
function resolveGrader(
	input: { grader?: string | null; bot?: string | null },
	actor: Actor,
): { graderId: string | null; botId: string | null } {
	let graderId = input.grader ?? null;
	const botId = input.bot ?? null;

	if (actor !== SYSTEM) {
		if (graderId !== null && graderId !== actor.username) {
			throw new NotAllowed("feedback.create", {
				message: "Only SYSTEM may name a different grader",
			});
		}
		if (graderId === null && botId === null) graderId = actor.username;
	}

	if ((graderId === null) === (botId === null)) {
		throw new InvalidData({
			grader: [
				{
					code: "invalid",
					message: "Exactly one of `grader` or `bot` is required",
				},
			],
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
	actor: Actor,
	action: "feedback.update" | "feedback.delete",
): Promise<DbFeedback> {
	const row = await tx.feedback.findFirst({
		where: feedbackWhere(filter),
		include: feedbackInclude(),
	});
	if (!row) throw new NotFound("feedback");

	if (isCourseOwner(actor, row.submission.response.exam.course)) return row;
	if (!canReadFeedback(actor, row, new Date())) throw new NotFound("feedback");
	throw new NotAllowed(action);
}

/// The minimal relation `fromDb` needs to fill in the pass's public reference
/// to the submission it grades.
type FeedbackFromDbRow = Prisma.FeedbackGetPayload<{
	include: { submission: { select: { publicId: true } } };
}>;

/** Converts a database row into the feedback entity. */
export function fromDb(row: FeedbackFromDbRow): Feedback {
	return {
		id: row.id as Feedback["id"],
		ref: row.ref as Feedback["ref"],
		submissionId: row.submissionId as Feedback["submissionId"],
		submission: row.submission.publicId,
		score: row.score,
		grader: row.graderId as Feedback["grader"],
		bot: row.botId,
		feedback: row.feedback,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}
