/**
 * A student's attempt at an exam, and the questions answered in it.
 *
 * A graded exam is answered once, so its attempt is keyed on `slotKey = 0`; a
 * practice exam may be attempted repeatedly, each attempt keyed on the unix
 * timestamp (seconds) it started at, and reused when the student comes back
 * within {@link PRACTICE_SESSION_WINDOW_MS}.
 */
import type { z } from "zod";
import { type Actor, SYSTEM, type UserActor } from "@/auth/actor";
import { ensurePerm, hasPerm } from "@/auth/permissions";
import { generateToken } from "@/auth/token";
import { PRACTICE_SESSION_WINDOW_MS } from "@/core/constants";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import type { ResponseId } from "@/core/schemas";
import {
	responseCreate,
	responseFilter,
	responseFinish,
	responsePK,
	responseSchema,
	responseSubmit,
	responseUpdate,
} from "@/core/schemas";
import {
	CrudBase,
	type ServiceOpts,
	type ServiceOptsWithoutTx,
} from "@/db/base-service";
import { Validate } from "@/utils/validate";
import type { Prisma, PrismaTx } from "../client";
import {
	courseRefMatch,
	courseRefWhere,
	invalidIfExists,
	valueOrNotFound,
} from "../utils";
import {
	assertAcceptingSubmissions,
	assertExamOpen,
	examTimingSelect,
	resolveExamQuestion,
	fromDb as submissionFromDb,
} from "./submission.service";

export type { ResponseId };
export { PRACTICE_SESSION_WINDOW_MS };

//
// Type definitions
//
export type Response = z.infer<typeof responseSchema>;
export type ResponseCreate = z.infer<typeof responseCreate>;
export type ResponseFilter = z.infer<typeof responseFilter>;
export type ResponseFinish = z.infer<typeof responseFinish>;
export type ResponsePK = z.infer<typeof responsePK>;
export type ResponseSubmit = z.infer<typeof responseSubmit>;
export type ResponseUpdate = z.infer<typeof responseUpdate>;

/// The course shape the permission predicates need for a response write.
function courseSelect() {
	return {
		id: true,
		instructor: { select: { username: true } },
		enrollments: {
			where: { status: "ACTIVE" as const },
			select: { username: true },
		},
	} satisfies Prisma.CourseSelect;
}

/**
 * The relations `fromDb` needs to shape a response entity, plus the course's
 * instructor and enrollments a permission check needs on the same row.
 */
function responseInclude() {
	return {
		exam: {
			select: {
				...examTimingSelect,
				slug: true,
				courseId: true,
				course: { select: courseSelect() },
			},
		},
		submissions: {
			orderBy: { createdAt: "asc" as const },
			include: {
				question: { select: { slug: true } },
				response: { select: { publicId: true } },
			},
		},
	} satisfies Prisma.ResponseInclude;
}

type DbResponse = Prisma.ResponseGetPayload<{
	include: ReturnType<typeof responseInclude>;
}>;

export class ResponseService extends CrudBase<{
	entity: Response;
	pkFilter: ResponsePK;
	create: ResponseCreate;
	filter: ResponseFilter;
	update: ResponseUpdate;
}> {
	/**
	 * Opens an attempt for one student on one exam.
	 *
	 * Unlike `upsert`, this always inserts a fresh row: a second `create` for
	 * a graded exam collides with the unique index and comes back as
	 * `InvalidData`, and a second `create` for a practice exam opens a second
	 * attempt regardless of the reuse window.
	 *
	 * @throws {@link NotFound} If the course or exam does not exist.
	 * @throws {@link InvalidData}
	 * If the author is not enrolled, or a practice session is named on a
	 * graded exam.
	 * @throws {@link NotAllowed} If `actor` may not write the author's work.
	 */
	@Validate({
		service: true,
		returns: responseSchema,
		args: [undefined, responseCreate],
	})
	protected async createTx(
		tx: PrismaTx,
		input: ResponseCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<Response> {
		const { exam, authorId } = await prepareAttempt(
			tx,
			input,
			opts.actor,
			"response.create",
		);
		assertExamOpen(exam, new Date());

		const slotKey =
			exam.type === "PRACTICE"
				? dateToSlotKey(input.practiceSession ?? new Date())
				: 0;

		const row = await invalidIfExists(tx.response.create, {
			data: {
				publicId: generateToken(9),
				authorId,
				examId: exam.id,
				slotKey,
				acceptingSubmissions: input.acceptingSubmissions ?? true,
			},
			include: responseInclude(),
		});

		return fromDb(row);
	}

	/**
	 * Finds an attempt by `id` or by its `publicId`, with every submission it holds.
	 *
	 * Visible to its author and to whoever teaches the course. An attempt the
	 * actor may not read is `null`, exactly as a missing one is, so an id is
	 * not a probe for whether somebody else answered.
	 */
	@Validate({
		service: true,
		returns: responseSchema.nullable(),
		args: [undefined, responsePK],
	})
	protected async findOneTx(
		tx: PrismaTx,
		filter: ResponsePK,
		opts: ServiceOptsWithoutTx,
	): Promise<Response | null> {
		const row = await tx.response.findFirst({
			where: responseWhere(filter),
			include: responseInclude(),
		});
		if (!row) return null;

		if (!hasReadAccess(opts.actor, row)) return null;
		return fromDb(row);
	}

	/**
	 * Lists the attempts of one course, narrowed to what `actor` may see.
	 *
	 * A student is narrowed to their own attempts in the database query, not
	 * after the fact. An `author` filter naming somebody else is refused rather
	 * than quietly emptied.
	 *
	 * @throws {@link NotAllowed}
	 * If `actor` may not read the course's contents at all, or names another
	 * author in `filter` while narrowed to their own rows.
	 */
	@Validate({
		service: true,
		returns: responseSchema.array(),
		args: [undefined, responseFilter],
	})
	protected async findManyTx(
		tx: PrismaTx,
		filter: ResponseFilter,
		opts: ServiceOptsWithoutTx,
	): Promise<Response[]> {
		const course = valueOrNotFound(
			"course",
			await tx.course.findUnique({
				where: courseRefWhere(filter.course),
				select: courseSelect(),
			}),
		);

		ensurePerm(opts.actor, "course.read-contents", course);

		const owner = isCourseOwner(opts.actor, course);
		const restrictTo = restrictToAuthor(opts.actor, owner, filter.author);

		const rows = await tx.response.findMany({
			where: {
				exam: {
					courseId: course.id,
					...(filter.exam ? { slug: filter.exam } : {}),
				},
				...(filter.practice !== undefined
					? filter.practice
						? { slotKey: { not: 0 } }
						: { slotKey: 0 }
					: {}),
				...(filter.acceptingSubmissions !== undefined
					? { acceptingSubmissions: filter.acceptingSubmissions }
					: {}),
				...(restrictTo
					? { authorId: restrictTo }
					: filter.author
						? { authorId: filter.author }
						: {}),
			},
			include: responseInclude(),
			orderBy: { createdAt: "asc" },
		});

		return rows.map(fromDb);
	}

	/**
	 * Opens or closes an attempt to further submissions.
	 *
	 * Which exam or student an attempt belongs to is fixed when it is created:
	 * moving it to another exam would rewrite history.
	 *
	 * @throws {@link NotFound}
	 * If no attempt matches `filter`, or the actor may not read the one that
	 * does.
	 * @throws {@link NotAllowed} If `actor` may read the attempt but not write it.
	 */
	@Validate({
		service: true,
		returns: responseSchema,
		args: [undefined, responsePK, responseUpdate],
	})
	protected async updateTx(
		tx: PrismaTx,
		filter: ResponsePK,
		fields: ResponseUpdate,
		opts: ServiceOptsWithoutTx,
	): Promise<Response> {
		const response = await writableResponse(
			tx,
			filter,
			opts.actor,
			"response.update",
		);

		const row = await tx.response.update({
			where: { id: response.id },
			data: { acceptingSubmissions: fields.acceptingSubmissions },
			include: responseInclude(),
		});

		return fromDb(row);
	}

	/**
	 * Resolves the attempt an exam write belongs to, creating it when absent.
	 *
	 * Keyed on the graded exam's single slot, or the open practice session, so
	 * a client that does not know whether it has started the exam already
	 * still lands on one row. The course's instructor may do so on an exam
	 * that is not open, to backfill an attempt; anyone else may not.
	 *
	 * @throws {@link InvalidData}
	 * If the exam is not open and `actor` is not the course's instructor.
	 * @throws {@link NotAllowed} If `actor` may not write the author's work.
	 */
	@Validate({
		service: true,
		returns: responseSchema,
		args: [undefined, responseCreate],
	})
	protected async upsertTx(
		tx: PrismaTx,
		input: ResponseCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<Response> {
		const row = await resolveOrCreateAttempt(
			tx,
			input,
			opts.actor,
			"response.create",
		);

		if (input.acceptingSubmissions === undefined) return fromDb(row);

		const updated = await tx.response.update({
			where: { id: row.id },
			data: { acceptingSubmissions: input.acceptingSubmissions },
			include: responseInclude(),
		});
		return fromDb(updated);
	}

	/**
	 * Removes an attempt and every submission made in it.
	 *
	 * @throws {@link NotFound}
	 * If no attempt matches `filter`, or the actor may not read the one that
	 * does.
	 * @throws {@link NotAllowed} If `actor` may read the attempt but not write it.
	 */
	@Validate({ service: true, args: [undefined, responsePK] })
	protected async deleteTx(
		tx: PrismaTx,
		filter: ResponsePK,
		opts: ServiceOptsWithoutTx,
	): Promise<void> {
		const response = await writableResponse(
			tx,
			filter,
			opts.actor,
			"response.delete",
		);

		await tx.submission.deleteMany({ where: { responseId: response.id } });
		await tx.response.delete({ where: { id: response.id } });
	}

	//
	// Additional public methods
	//

	/**
	 * Closes the author's graded attempt at an exam to further answers.
	 *
	 * The student's "Submit exam". Calling it on an attempt that is already
	 * closed returns it unchanged. The author may close their own attempt; the
	 * course's instructor may close anyone's.
	 *
	 * @throws {@link NotFound}
	 * If the author has no attempt at the exam, or it belongs to someone the
	 * actor may not see.
	 */
	@Validate({
		service: true,
		returns: responseSchema,
		args: [responseFinish],
	})
	finish<Opt extends ServiceOpts>(
		input: ResponseFinish,
		opts: Opt,
	): Promise<Response> {
		return this.$transaction(opts, async (tx, scoped) => {
			const course = valueOrNotFound(
				"course",
				await tx.course.findUnique({
					where: courseRefWhere(input.course),
					select: courseSelect(),
				}),
			);
			const authorId = resolveAuthorId(input.author, scoped.actor);
			if (
				!isCourseOwner(scoped.actor, course) &&
				(scoped.actor === SYSTEM || scoped.actor.username !== authorId)
			) {
				throw new NotFound("response");
			}

			const exam = valueOrNotFound(
				"exam",
				await tx.exam.findUnique({
					where: { courseId_slug: { courseId: course.id, slug: input.exam } },
					select: { id: true },
				}),
			);
			const row = valueOrNotFound(
				"response",
				await tx.response.findUnique({
					where: {
						authorId_examId_slotKey: { authorId, examId: exam.id, slotKey: 0 },
					},
					include: responseInclude(),
				}),
			);
			if (!row.acceptingSubmissions) return fromDb(row);

			const updated = await tx.response.update({
				where: { id: row.id },
				data: { acceptingSubmissions: false },
				include: responseInclude(),
			});
			return fromDb(updated);
		});
	}

	/**
	 * Resolves the attempt and appends one submission to it, in one call.
	 *
	 * This is what a client answering a question actually does; `upsert` then
	 * `submission.create` is the same thing spelled out, minus the guarantee
	 * that both halves land together. Answering the same question again
	 * appends a second submission rather than replacing the first.
	 *
	 * @throws {@link InvalidData}
	 * If the attempt is closed to new submissions, its exam is not open,
	 * its deadline has passed, or the question is not one the exam carries.
	 * @throws {@link NotAllowed} If `actor` may not write the author's work.
	 */
	@Validate({
		service: true,
		returns: responseSchema,
		args: [responseSubmit],
	})
	submit<Opt extends ServiceOpts>(
		input: ResponseSubmit,
		opts: Opt,
	): Promise<Response> {
		return this.$transaction(opts, async (tx, scoped) => {
			const row = await resolveOrCreateAttempt(
				tx,
				{
					course: input.course,
					exam: input.exam,
					author: input.author,
				},
				scoped.actor,
				"response.submit",
			);

			assertAcceptingSubmissions(row, new Date());
			const question = await resolveExamQuestion(
				tx,
				row.exam.courseId,
				row.examId,
				input.question,
			);

			await invalidIfExists(tx.submission.create, {
				data: {
					publicId: generateToken(9),
					responseId: row.id,
					questionId: question.id,
					payload: input.payload as Prisma.InputJsonValue,
					startedAt: input.startedAt ?? null,
					automaticallyTriggered: input.automaticallyTriggered ?? false,
				},
			});

			const updated = valueOrNotFound(
				"response",
				await tx.response.findUnique({
					where: { id: row.id },
					include: responseInclude(),
				}),
			);
			return fromDb(updated);
		});
	}
}

// Private utilities -----------------------------------------------------------

/// The `where` matching whichever of the primary keys `filter` carries, within its course if it names one.
function responseWhere(filter: ResponsePK): Prisma.ResponseWhereInput {
	if ("id" in filter) return { id: filter.id };
	return {
		publicId: filter.publicId,
		...(filter.course !== undefined && {
			exam: { course: courseRefMatch(filter.course) },
		}),
	};
}

/// Whether `actor` teaches the course the attempt belongs to, or is SYSTEM.
function isCourseOwner(
	actor: Actor,
	course: { instructor: { username: string } },
): boolean {
	if (actor === SYSTEM) return true;
	return actor.username === course.instructor.username;
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
		throw new NotAllowed("response.read");
	}
	return username;
}

/// Whether `actor` may read a response row fetched with `responseInclude`.
function hasReadAccess(
	actor: Actor,
	row: {
		authorId: string;
		exam: {
			course: {
				instructor: { username: string };
				enrollments: { username: string }[];
			};
		};
	},
): boolean {
	if (isCourseOwner(actor, row.exam.course)) return true;
	return actor !== SYSTEM && actor.username === row.authorId;
}

/**
 * Finds the attempt a write targets, refusing an actor who may not write it.
 *
 * An attempt the actor may not even read is `NotFound`; one they may read but
 * not write is `NotAllowed`.
 */
async function writableResponse(
	tx: PrismaTx,
	filter: ResponsePK,
	actor: Actor,
	action: "response.update" | "response.delete",
): Promise<DbResponse> {
	const row = await tx.response.findFirst({
		where: responseWhere(filter),
		include: responseInclude(),
	});
	if (!row) throw new NotFound("response");

	if (isCourseOwner(actor, row.exam.course)) return row;
	if (!hasReadAccess(actor, row)) throw new NotFound("response");
	throw new NotAllowed(action);
}

/// Resolves the author for a write, defaulting to the actor.
function resolveAuthorId(author: string | undefined, actor: Actor): string {
	if (author) return author;
	if (actor === SYSTEM) {
		throw new InvalidData({
			author: [{ code: "missing", message: "`author` is required for SYSTEM" }],
		});
	}
	return actor.username;
}

/// Input shared by `create`, `upsert` and `submit` to resolve an attempt.
interface AttemptInput {
	course: ResponseCreate["course"];
	exam: string;
	author?: string;
	practiceSession?: Date | null;
}

/**
 * Resolves the course, exam and author of an attempt write, enforcing that
 * the author holds an active enrollment, that a practice session is never
 * named on a graded exam, and the `response.create`/`response.submit`
 * permission.
 *
 * A `DRAFT` or `ARCHIVED` exam does not exist for anyone but whoever may
 * write the course's contents, exactly as in `exam.service.ts`: an attempt
 * cannot be opened against an exam the author cannot even see, and the error
 * for one gives no sign of it, matching a slug nobody ever used.
 */
async function prepareAttempt(
	tx: PrismaTx,
	input: AttemptInput,
	actor: Actor,
	perm: "response.create" | "response.submit",
) {
	const course = valueOrNotFound(
		"course",
		await tx.course.findUnique({
			where: courseRefWhere(input.course),
			select: courseSelect(),
		}),
	);

	const exam = valueOrNotFound(
		"exam",
		await tx.exam.findUnique({
			where: { courseId_slug: { courseId: course.id, slug: input.exam } },
			select: { id: true, slug: true, ...examTimingSelect },
		}),
	);

	if (
		!hasPerm(actor, "course.update-contents", course) &&
		(exam.status === "DRAFT" || exam.status === "ARCHIVED")
	) {
		throw new NotFound("exam");
	}

	const authorId = resolveAuthorId(input.author, actor);

	ensurePerm(actor, perm, {
		author: { username: authorId },
		course,
	});

	if (!course.enrollments.some((e) => e.username === authorId)) {
		throw new InvalidData({
			author: [
				{
					code: "invalid",
					message: `"${authorId}" does not hold an active enrollment in this course`,
				},
			],
		});
	}

	if (exam.type !== "PRACTICE" && input.practiceSession !== undefined) {
		throw new InvalidData({
			practiceSession: [
				{
					code: "invalid",
					message: "A practice session cannot be named on a graded exam",
				},
			],
		});
	}

	return { course, exam, authorId };
}

/**
 * Resolves the attempt for `upsert` and `submit`: a graded exam's single
 * `slotKey = 0` row is found or created; a practice exam reuses the newest
 * attempt still within {@link PRACTICE_SESSION_WINDOW_MS} of now, or opens a
 * fresh one otherwise. Only the course's instructor may reach an exam that is
 * not open.
 */
async function resolveOrCreateAttempt(
	tx: PrismaTx,
	input: AttemptInput,
	actor: Actor,
	perm: "response.create" | "response.submit",
): Promise<DbResponse> {
	const { course, exam, authorId } = await prepareAttempt(
		tx,
		input,
		actor,
		perm,
	);
	if (!hasPerm(actor, "course.update-contents", course)) {
		assertExamOpen(exam, new Date());
	}

	if (exam.type !== "PRACTICE") {
		const existing = await tx.response.findUnique({
			where: {
				authorId_examId_slotKey: { authorId, examId: exam.id, slotKey: 0 },
			},
			include: responseInclude(),
		});
		if (existing) return existing;

		return invalidIfExists(tx.response.create, {
			data: { publicId: generateToken(9), authorId, examId: exam.id },
			include: responseInclude(),
		});
	}

	const windowStart = dateToSlotKey(
		new Date(Date.now() - PRACTICE_SESSION_WINDOW_MS),
	);
	const existing = await tx.response.findFirst({
		where: { authorId, examId: exam.id, slotKey: { gte: windowStart } },
		orderBy: { slotKey: "desc" },
		include: responseInclude(),
	});
	if (existing) return existing;

	return invalidIfExists(tx.response.create, {
		data: {
			publicId: generateToken(9),
			authorId,
			examId: exam.id,
			slotKey: dateToSlotKey(input.practiceSession ?? new Date()),
		},
		include: responseInclude(),
	});
}

/// `0` for a graded exam's slot, otherwise a unix timestamp in seconds.
function dateToSlotKey(date: Date): number {
	return Math.floor(date.getTime() / 1000);
}

/// The inverse of `dateToSlotKey`: `0` surfaces as `null`, on a graded exam's slot.
function slotKeyToDate(slotKey: number): Date | null {
	return slotKey === 0 ? null : new Date(slotKey * 1000);
}

/** Converts a database row into the response entity. */
function fromDb(row: DbResponse): Response {
	return {
		id: row.id as Response["id"],
		publicId: row.publicId,
		courseId: row.exam.courseId as Response["courseId"],
		examId: row.examId as Response["examId"],
		exam: row.exam.slug,
		author: row.authorId,
		practiceSession: slotKeyToDate(row.slotKey),
		acceptingSubmissions: row.acceptingSubmissions,
		submissions: row.submissions.map(submissionFromDb),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}
