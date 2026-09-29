/**
 * One answer to one question inside a response.
 *
 * A submission is append-only: it records what a student sent and when.
 * Answering the same question twice appends a second submission rather than
 * replacing the first. Only its grading status moves afterwards, and only by
 * whoever teaches the course.
 */
import type { z } from "zod";
import { type Actor, SYSTEM, type UserActor } from "@/auth/actor";
import { ensurePerm } from "@/auth/permissions";
import { generateToken } from "@/auth/token";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import type { SubmissionId } from "@/core/schemas";
import {
	submissionCreate,
	submissionFilter,
	submissionPK,
	submissionSchema,
	submissionUpdate,
} from "@/core/schemas";
import { CrudBase, type ServiceOptsWithoutTx } from "@/db/base-service";
import { toDuration } from "@/utils/schedule-time";
import { Validate } from "@/utils/validate";
import type { Prisma, PrismaTx } from "../client";
import { attemptDeadline, type ExamTiming, examPhase } from "../exam-state";
import { courseRefWhere, invalidIfExists, valueOrNotFound } from "../utils";

export { submissionStatus } from "@/core/schemas";
export type { SubmissionId };

//
// Type definitions
//
export type Submission = z.infer<typeof submissionSchema>;
export type SubmissionCreate = z.infer<typeof submissionCreate>;
export type SubmissionFilter = z.infer<typeof submissionFilter>;
export type SubmissionPK = z.infer<typeof submissionPK>;
export type SubmissionUpdate = z.infer<typeof submissionUpdate>;

/// The exam columns {@link examTimingFromDb} reads.
export const examTimingSelect = {
	status: true,
	type: true,
	scheduledAt: true,
	durationMs: true,
	extraTimeMs: true,
} satisfies Prisma.ExamSelect;

/// Stored milliseconds as a {@link Duration}, a missing or zero length read as `null`.
function msToDuration(ms: number | null): ExamTiming["duration"] {
	return ms ? toDuration(Math.round(ms / 60_000)) : null;
}

/** The {@link ExamTiming} of an exam row selected with {@link examTimingSelect}. */
export function examTimingFromDb(
	exam: Prisma.ExamGetPayload<{ select: typeof examTimingSelect }>,
): ExamTiming {
	return {
		type: exam.type,
		status: exam.status,
		scheduledAt: exam.scheduledAt,
		duration: msToDuration(exam.durationMs),
		extraTime: msToDuration(exam.extraTimeMs),
	};
}

/// The relations needed to build a permission target from a response row.
function responseTargetInclude() {
	return {
		exam: {
			select: {
				...examTimingSelect,
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
			},
		},
	} satisfies Prisma.ResponseInclude;
}

type ResponseTarget = Prisma.ResponseGetPayload<{
	include: ReturnType<typeof responseTargetInclude>;
}>;

/// The relations needed to build a permission target from a submission row,
/// plus the response and question its public references are read from.
function submissionInclude() {
	return {
		response: { include: responseTargetInclude() },
		question: { select: { slug: true } },
	} satisfies Prisma.SubmissionInclude;
}

type DbSubmission = Prisma.SubmissionGetPayload<{
	include: ReturnType<typeof submissionInclude>;
}>;

export class SubmissionService extends CrudBase<{
	entity: Submission;
	pkFilter: SubmissionPK;
	create: SubmissionCreate;
	filter: SubmissionFilter;
	update: SubmissionUpdate;
	// An attempt is never revised in place: every answer is a new row.
	upsert: false;
}> {
	/**
	 * Appends an answer to a response.
	 *
	 * The response must still be accepting submissions, its exam must be
	 * open and within the response's deadline, and the question must be one the exam carries.
	 *
	 * @throws {@link NotFound}
	 * If no response matches `input.response`, or `actor` may not even read
	 * the one that does.
	 * @throws {@link InvalidData} If the response is closed to new attempts.
	 * @throws {@link NotAllowed}
	 * If `actor` may read the response but not write the author's work.
	 */
	@Validate({
		service: true,
		returns: submissionSchema,
		args: [undefined, submissionCreate],
	})
	protected async createTx(
		tx: PrismaTx,
		input: SubmissionCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<Submission> {
		const response = valueOrNotFound(
			"response",
			await tx.response.findFirst({
				where: responseRefWhere(input.response),
				include: responseTargetInclude(),
			}),
		);

		// A response the actor may not even read is `NotFound`, so a publicId
		// cannot be used to probe whether another student answered; one they
		// may read but not write to (e.g. its author, no longer enrolled) is
		// `NotAllowed`.
		if (!hasReadAccess(opts.actor, response)) throw new NotFound("response");
		ensurePerm(opts.actor, "submission.create", {
			author: { username: response.authorId },
			course: response.exam.course,
		});

		assertAcceptingSubmissions(response, new Date());
		const question = await resolveExamQuestion(
			tx,
			response.exam.courseId,
			response.examId,
			input.question,
		);

		const row = await invalidIfExists(tx.submission.create, {
			data: {
				publicId: generateToken(9),
				responseId: response.id,
				questionId: question.id,
				payload: input.payload as Prisma.InputJsonValue,
				status: input.status ?? "PENDING_GRADE",
				automaticallyTriggered: input.automaticallyTriggered ?? false,
				startedAt: input.startedAt ?? null,
			},
			include: submissionInclude(),
		});

		return fromDb(row);
	}

	/**
	 * Finds an answer by `id` or by its `publicId`.
	 *
	 * Visible to its author and to whoever teaches the course. An answer the
	 * actor may not read is `null`, exactly as a missing one is, so an id is
	 * not a probe for whether somebody else answered.
	 */
	@Validate({
		service: true,
		returns: submissionSchema.nullable(),
		args: [undefined, submissionPK],
	})
	protected async findOneTx(
		tx: PrismaTx,
		filter: SubmissionPK,
		opts: ServiceOptsWithoutTx,
	): Promise<Submission | null> {
		const row = await tx.submission.findFirst({
			where: submissionWhere(filter),
			include: submissionInclude(),
		});
		if (!row) return null;

		if (!hasReadAccess(opts.actor, row.response)) return null;
		return fromDb(row);
	}

	/**
	 * Lists the answers made in one course, narrowed to what `actor` may see.
	 *
	 * A student is narrowed to their own answers in the database query, not
	 * after the fact. An `author` filter naming somebody else is refused rather
	 * than quietly emptied.
	 *
	 * @throws {@link NotAllowed}
	 * If `actor` may not read the course's contents at all, or names another
	 * author in `filter` while narrowed to their own rows.
	 */
	@Validate({
		service: true,
		returns: submissionSchema.array(),
		args: [undefined, submissionFilter],
	})
	protected async findManyTx(
		tx: PrismaTx,
		filter: SubmissionFilter,
		opts: ServiceOptsWithoutTx,
	): Promise<Submission[]> {
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

		const rows = await tx.submission.findMany({
			where: {
				response: {
					exam: {
						courseId: course.id,
						...(filter.exam ? { slug: filter.exam } : {}),
					},
					...(filter.practice !== undefined
						? filter.practice
							? { slotKey: { not: 0 } }
							: { slotKey: 0 }
						: {}),
					...(restrictTo
						? { authorId: restrictTo }
						: filter.author
							? { authorId: filter.author }
							: {}),
					...(filter.response ? responseRefWhere(filter.response) : {}),
				},
				...(filter.question ? { question: { slug: filter.question } } : {}),
				...(filter.statuses ? { status: { in: filter.statuses } } : {}),
				...(filter.automaticallyTriggered !== undefined
					? { automaticallyTriggered: filter.automaticallyTriggered }
					: {}),
			},
			include: submissionInclude(),
			orderBy: { createdAt: "asc" },
		});

		return rows.map(fromDb);
	}

	/**
	 * Moves an answer's grading status.
	 *
	 * The payload is the record of what the student sent and never changes.
	 *
	 * @throws {@link NotFound}
	 * If no answer matches `filter`, or the actor may not read the one that
	 * does.
	 * @throws {@link NotAllowed} If `actor` may read the answer but not write it.
	 */
	@Validate({
		service: true,
		returns: submissionSchema,
		args: [undefined, submissionPK, submissionUpdate],
	})
	protected async updateTx(
		tx: PrismaTx,
		filter: SubmissionPK,
		fields: SubmissionUpdate,
		opts: ServiceOptsWithoutTx,
	): Promise<Submission> {
		const submission = await writableSubmission(
			tx,
			filter,
			opts.actor,
			"submission.update",
		);

		const row = await tx.submission.update({
			where: { id: submission.id },
			data: { status: fields.status },
			include: submissionInclude(),
		});

		return fromDb(row);
	}

	/**
	 * Removes an answer.
	 *
	 * Deleting the last answer leaves the response standing: the attempt
	 * exists independently of what was answered in it.
	 *
	 * @throws {@link NotFound}
	 * If no answer matches `filter`, or the actor may not read the one that
	 * does.
	 * @throws {@link NotAllowed} If `actor` may read the answer but not write it.
	 */
	@Validate({ service: true, args: [undefined, submissionPK] })
	protected async deleteTx(
		tx: PrismaTx,
		filter: SubmissionPK,
		opts: ServiceOptsWithoutTx,
	): Promise<void> {
		const submission = await writableSubmission(
			tx,
			filter,
			opts.actor,
			"submission.delete",
		);

		await tx.submission.delete({ where: { id: submission.id } });
	}
}

// Private utilities -----------------------------------------------------------

/// The `where` matching whichever of the primary keys `ref` carries.
function responseRefWhere(
	ref: { id: number } | { publicId: string },
): Prisma.ResponseWhereInput {
	return "id" in ref ? { id: ref.id } : { publicId: ref.publicId };
}

/// The `where` matching whichever of the primary keys `filter` carries.
function submissionWhere(filter: SubmissionPK): Prisma.SubmissionWhereInput {
	return "id" in filter ? { id: filter.id } : { publicId: filter.publicId };
}

/// Whether `actor` teaches the course the response belongs to, or is SYSTEM.
function isCourseOwner(
	actor: Actor,
	course: { instructor: { username: string } },
): boolean {
	if (actor === SYSTEM) return true;
	return actor.username === course.instructor.username;
}

/// Whether `actor` may read a submission whose response resolved to `response`.
function hasReadAccess(actor: Actor, response: ResponseTarget): boolean {
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
	const username = (actor as UserActor).username;
	if (requestedAuthor !== undefined && requestedAuthor !== username) {
		throw new NotAllowed("submission.read");
	}
	return username;
}

/**
 * Finds the answer a write targets, refusing an actor who may not write it.
 *
 * An answer the actor may not even read is `NotFound`; one they may read but
 * not write is `NotAllowed`.
 */
async function writableSubmission(
	tx: PrismaTx,
	filter: SubmissionPK,
	actor: Actor,
	action: "submission.update" | "submission.delete",
): Promise<DbSubmission> {
	const row = await tx.submission.findFirst({
		where: submissionWhere(filter),
		include: submissionInclude(),
	});
	if (!row) throw new NotFound("submission");

	if (isCourseOwner(actor, row.response.exam.course)) return row;
	if (!hasReadAccess(actor, row.response)) throw new NotFound("submission");
	throw new NotAllowed(action);
}

/**
 * Refuses a write against an exam that is not open at `now`.
 *
 * @throws {@link InvalidData} Unless the exam's phase is `open`.
 */
export function assertExamOpen(
	exam: Prisma.ExamGetPayload<{ select: typeof examTimingSelect }>,
	now: Date,
): void {
	if (examPhase(examTimingFromDb(exam), now) !== "open") {
		throw new InvalidData({
			exam: [{ code: "invalid", message: "This exam is not currently open" }],
		});
	}
}

/**
 * Refuses a submission against a closed response, an exam that is not open,
 * or a response whose deadline has passed.
 *
 * @throws {@link InvalidData}
 */
export function assertAcceptingSubmissions(
	response: {
		acceptingSubmissions: boolean;
		createdAt: Date;
		exam: Prisma.ExamGetPayload<{ select: typeof examTimingSelect }>;
	},
	now: Date,
): void {
	if (!response.acceptingSubmissions) {
		throw new InvalidData({
			response: [
				{
					code: "invalid",
					message: "This response is not accepting new submissions",
				},
			],
		});
	}
	assertExamOpen(response.exam, now);

	const deadline = attemptDeadline(examTimingFromDb(response.exam), response);
	if (deadline && now > deadline) {
		throw new InvalidData({
			response: [
				{
					code: "invalid",
					message: "The time to answer this exam has run out",
				},
			],
		});
	}
}

/**
 * Resolves a question slug to the question ref it names, refusing one the
 * exam does not carry.
 *
 * Shared with `ResponseService.submit`, which appends a submission the same
 * way `SubmissionService.create` does.
 *
 * @throws {@link NotFound} If no question in the course has this slug.
 * @throws {@link InvalidData} If the question is not one of the exam's questions.
 */
export async function resolveExamQuestion(
	tx: PrismaTx,
	courseId: number,
	examId: number,
	slug: string,
) {
	const question = valueOrNotFound(
		"question",
		await tx.questionRef.findFirst({
			where: { courseId, slug },
			select: { id: true, slug: true },
		}),
	);

	const inExam = await tx.questionsForExam.findUnique({
		where: { examId_questionRefId: { examId, questionRefId: question.id } },
	});
	if (!inExam) {
		throw new InvalidData({
			question: [
				{
					code: "not-exists",
					message: `"${question.slug}" is not one of this exam's questions`,
				},
			],
		});
	}

	return question;
}

/// The minimal relations `fromDb` needs to fill in the submission's public
/// references: the response's `publicId` and the question's `slug`.
type SubmissionFromDbRow = Prisma.SubmissionGetPayload<{
	include: {
		response: { select: { publicId: true } };
		question: { select: { slug: true } };
	};
}>;

/** Converts a database row into the submission entity. */
export function fromDb(row: SubmissionFromDbRow): Submission {
	return {
		id: row.id as Submission["id"],
		publicId: row.publicId,
		responseId: row.responseId as Submission["responseId"],
		questionId: row.questionId as Submission["questionId"],
		response: row.response.publicId,
		question: row.question.slug,
		status: row.status,
		automaticallyTriggered: row.automaticallyTriggered,
		payload: row.payload as Submission["payload"],
		startedAt: row.startedAt,
		createdAt: row.createdAt,
	};
}
