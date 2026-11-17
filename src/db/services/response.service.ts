/**
 * A student's attempt at an exam, and the questions answered in it.
 *
 * A graded exam is answered once, so its attempt is keyed on `slotKey = 0`; a
 * practice exam may be attempted repeatedly, each attempt keyed on the unix
 * timestamp (seconds) it started at, and reused when the student comes back
 * within {@link PRACTICE_SESSION_WINDOW_MS}.
 */
import { z } from "zod";
import { requireAccess, responseAccess } from "@/auth/access";
import { type Actor, SYSTEM, type UserActor } from "@/auth/actor";
import {
	ensurePerm,
	hasPerm,
	type ResponseWithCourse,
	simplifyTarget,
} from "@/auth/permissions";
import { generateToken } from "@/auth/token";
import {
	EXAM_ANSWER_GRACE_MS,
	PRACTICE_SESSION_WINDOW_MS,
} from "@/core/constants";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import type { ResponseId } from "@/core/schemas/base";
import {
	responseAnswered,
	responseCreate,
	responseFilter,
	responseFinish,
	responseGradeObjectives,
	responsePK,
	responseRestartPreview,
	responseSchema,
	responseSettleExpired,
	responseSubmit,
	responseSubmitted,
	responseUpdate,
} from "@/core/schemas/response";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import {
	checkExpectedUpdatedAt,
	checkVersion,
	guardedDelete,
	guardedUpdate,
	touch,
} from "@/db/conditional-write";
import { enrollmentsOf } from "@/db/course-access";
import { defineService, op } from "@/db/define-service";
import { m } from "@/i18n";
import { effectiveAnswerHistory } from "@/services/answer-history";
import {
	canReopen,
	type ExceptionTiming,
	examSchedule,
	hiddenFromStudents,
} from "@/services/exam-state";
import type { Prisma, PrismaTx } from "../client";
import { realAttemptSql } from "../preview-filter";
import {
	courseRefMatch,
	courseRefWhere,
	invalidIfExists,
	valueOrNotFound,
} from "../utils";
import { loggingAnswerHistoryRemoval } from "./answer-edit.service";
import {
	examTimingFromDb,
	examTimingSelect,
	loadExceptionTiming,
} from "./exam-questions";
import { enqueueGradingJob, promoteFinalSends } from "./grading-job-queue";
import {
	gradeObjectives as gradeAttempt,
	gradeExpiredObjectives,
} from "./objective-grading";
import {
	assertAcceptingSubmissions,
	assertExamOpen,
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
export type ResponseRestartPreview = z.infer<typeof responseRestartPreview>;
export type ResponseGradeObjectives = z.infer<typeof responseGradeObjectives>;
export type ResponseSettleExpired = z.infer<typeof responseSettleExpired>;

/// What `gradeObjectives` did to the attempts of one exam.
export interface ObjectiveGradingLine {
	exam: string;
	/// The closed or timed-out attempts it looked at.
	attempts: number;
	/// The answers it graded, or would grade on a dry run.
	graded: number;
	/// Whether the exam had released its grades.
	released: boolean;
}
export type ResponsePK = z.infer<typeof responsePK>;
export type ResponseSubmit = z.infer<typeof responseSubmit>;
export type ResponseAnswered = z.infer<typeof responseAnswered>;
export type ResponseUpdate = z.infer<typeof responseUpdate>;

/// The course shape the permission predicates need for a response write: of its enrollments, only those of `actor` and `authors`.
function courseSelect(actor: Actor, ...authors: string[]) {
	return {
		id: true,
		instructor: { select: { username: true } },
		enrollments: enrollmentsOf(actor, ...authors),
	} satisfies Prisma.CourseSelect;
}

/**
 * The relations `fromDb` needs to shape a response entity, plus the course's
 * instructor and enrollments a permission check needs on the same row.
 */
function responseInclude(actor: Actor) {
	return {
		exam: {
			select: {
				...examTimingSelect,
				slug: true,
				courseId: true,
				course: { select: courseSelect(actor) },
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

/// An attempt with its exam and course but none of its submissions, which grow with every autosave.
type DbAttempt = Awaited<ReturnType<typeof resolveOrCreateAttempt>>["attempt"];

/// The CRUD shape of the response service.
type ResponseT = {
	entity: Response;
	pkFilter: ResponsePK;
	create: ResponseCreate;
	filter: ResponseFilter;
	update: ResponseUpdate;
};

/** The response service of `client` (the shared client by default). */
export const makeResponseService = defineService<ResponseT>()(() => {
	/**
	 * Opens an attempt for one student on one exam.
	 *
	 * Unlike `upsert`, this always inserts a fresh row: a second `create` for
	 * a graded exam collides with the unique index and comes back as
	 * `InvalidData`, and a second `create` for a practice exam opens a second
	 * attempt regardless of the reuse window.
	 *
	 * The course's instructor creating an attempt for themself opens their
	 * simulation of the exam instead, see {@link isSimulation}.
	 *
	 * @throws {@link NotFound} If the course or exam does not exist.
	 * @throws {@link InvalidData}
	 * If the author is not enrolled and is not opening a simulation, or a
	 * practice session is named on a graded exam.
	 * @throws {@link NotAllowed} If `actor` may not write the author's work.
	 */
	const create = op({
		args: [responseCreate],
		returns: responseSchema,
		run: async (
			tx: PrismaTx,
			input: ResponseCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<Response> => {
			const { exam, authorId, preview } = await prepareAttempt(
				tx,
				input,
				opts.actor,
				"response.create",
			);
			if (!preview) {
				assertExamOpen(
					exam,
					new Date(),
					await loadExceptionTiming(tx, exam.id, authorId),
				);
			}

			const slotKey =
				exam.type === "PRACTICE" && !preview
					? dateToSlotKey(input.practiceSession ?? new Date())
					: 0;

			const row = await invalidIfExists(tx.response.create, {
				data: {
					publicId: generateToken(9),
					authorId,
					examId: exam.id,
					slotKey,
					preview,
					acceptingSubmissions: input.acceptingSubmissions ?? true,
					closedAt: input.acceptingSubmissions === false ? new Date() : null,
				},
				include: responseInclude(opts.actor),
			});

			return fromDb(row);
		},
	});

	/**
	 * Finds an attempt by `id` or by its `publicId`, with every submission it holds.
	 *
	 * Visible to its author and to whoever teaches the course. An attempt the
	 * actor may not read is `null`, exactly as a missing one is, so an id is
	 * not a probe for whether somebody else answered.
	 */
	const findOne = op({
		transaction: false,
		args: [responsePK],
		returns: responseSchema.nullable(),
		run: async (
			tx: PrismaTx,
			filter: ResponsePK,
			opts: ServiceOptsWithoutTx,
		): Promise<Response | null> => {
			const row = await tx.response.findFirst({
				where: responseWhere(filter),
				include: responseInclude(opts.actor),
			});
			if (!row) return null;

			if (!hasReadAccess(opts.actor, row)) return null;
			return fromDb(row);
		},
	});

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
	const findMany = op({
		transaction: false,
		args: [responseFilter],
		returns: responseSchema.array(),
		run: async (
			tx: PrismaTx,
			filter: ResponseFilter,
			opts: ServiceOptsWithoutTx,
		): Promise<Response[]> => {
			const course = valueOrNotFound(
				"course",
				await tx.course.findUnique({
					where: courseRefWhere(filter.course),
					select: courseSelect(opts.actor),
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
					preview: filter.preview ?? false,
					...(restrictTo
						? { authorId: restrictTo }
						: filter.author
							? { authorId: filter.author }
							: {}),
				},
				include: responseInclude(opts.actor),
				orderBy: { createdAt: "asc" },
			});

			return rows.map(fromDb);
		},
	});

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
	 * Setting `acceptingSubmissions: true` on a graded attempt is refused once
	 * the author's personal window (the exam's timing with the author's exam
	 * exception applied) has closed: the instructor grants extra time or a new
	 * date first. Closing an attempt is always allowed. REST `PATCH` and the
	 * `exam.reopenAttempt` action both go through here.
	 *
	 * @throws {@link InvalidData}
	 * If reopening an attempt whose personal window has closed, keyed on
	 * `response` with `errors_response_window_closed`.
	 */
	const update = op({
		args: [responsePK, responseUpdate],
		returns: responseSchema,
		run: async (
			tx: PrismaTx,
			filter: ResponsePK,
			fields: ResponseUpdate,
			opts: ServiceOptsWithoutTx,
		): Promise<Response> => {
			const response = await writableResponse(
				tx,
				filter,
				opts.actor,
				"response.update",
				opts.expectedUpdatedAt,
			);
			// Before the reopen check: a stale caller sees no 400.
			await checkVersion(tx, "response", { id: response.id }, opts);

			if (fields.acceptingSubmissions === true) {
				await assertReopenable(tx, response);
			}
			if (
				fields.acceptingSubmissions === false &&
				response.acceptingSubmissions
			) {
				await promoteFinalSends(tx, sendsOf(response));
			}

			const row = await guardedUpdate(
				tx,
				"response",
				{ id: response.id },
				{
					acceptingSubmissions: fields.acceptingSubmissions,
					closedAt: closedAtAfter(response, fields.acceptingSubmissions),
				},
				opts,
				{ include: responseInclude(opts.actor) },
			);

			if (fields.acceptingSubmissions === false) {
				return fromDb(await gradeOnClose(tx, row));
			}
			return fromDb(row);
		},
	});

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
	const upsert = op({
		args: [responseCreate],
		returns: responseSchema,
		run: async (
			tx: PrismaTx,
			input: ResponseCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<Response> => {
			const { attempt: row } = await resolveOrCreateAttempt(
				tx,
				input,
				opts.actor,
				"response.create",
				opts.expectedUpdatedAt,
			);

			if (input.acceptingSubmissions === undefined) {
				return fromDb(
					await tx.response.findUniqueOrThrow({
						where: { id: row.id },
						include: responseInclude(opts.actor),
					}),
				);
			}

			// Only the course's instructor reopens a closed attempt, and only while the student can still answer.
			if (input.acceptingSubmissions && !row.acceptingSubmissions) {
				ensurePerm(opts.actor, "response.update", responseTarget(row));
				await assertReopenable(tx, row);
			}

			if (!input.acceptingSubmissions && row.acceptingSubmissions) {
				await promoteFinalSends(tx, sendsOf(row));
			}

			// The expectation was checked against this very row when it was resolved.
			const updated = await guardedUpdate(
				tx,
				"response",
				{ id: row.id },
				{
					acceptingSubmissions: input.acceptingSubmissions,
					closedAt: closedAtAfter(row, input.acceptingSubmissions),
				},
				{},
				{ include: responseInclude(opts.actor) },
			);
			return fromDb(
				input.acceptingSubmissions ? updated : await gradeOnClose(tx, updated),
			);
		},
	});

	/**
	 * Removes an attempt and every submission made in it.
	 *
	 * @throws {@link NotFound}
	 * If no attempt matches `filter`, or the actor may not read the one that
	 * does.
	 * @throws {@link NotAllowed}
	 * If `actor` may read the attempt but not write it, or the attempt has an
	 * active sanction (409).
	 */
	const remove = op({
		args: [responsePK],
		transaction: false,
		run: (
			tx: PrismaTx,
			filter: ResponsePK,
			opts: ServiceOptsWithoutTx,
		): Promise<void> =>
			loggingAnswerHistoryRemoval(
				tx,
				"response-delete",
				async (inner, measure) => {
					const response = await writableResponse(
						inner,
						filter,
						opts.actor,
						"response.delete",
						opts.expectedUpdatedAt,
					);
					// Before anything is measured or deleted: a stale caller loses nothing.
					await checkVersion(inner, "response", { id: response.id }, opts);
					// A sanction is a record of a decision: only a revoked one goes with the attempt.
					const sanctioned = await inner.examAdjustment.count({
						where: { responseId: response.id, revokedAt: null },
					});
					if (sanctioned > 0) {
						throw new NotAllowed("response.delete", { status: 409 });
					}

					await measure({ responseIds: [response.id] });
					await inner.submission.deleteMany({
						where: { responseId: response.id },
					});
					await guardedDelete(inner, "response", { id: response.id }, opts);
				},
			),
	});

	/**
	 * Closes the author's attempt at an exam to further answers.
	 *
	 * The student's "Submit exam". On a practice exam it is the newest attempt,
	 * the current session's; a simulation keeps its own slot. Calling it on an
	 * attempt that is already closed returns it unchanged. The author may close
	 * their own attempt; the course's instructor may close anyone's.
	 *
	 * @throws {@link NotFound}
	 * If the author has no attempt at the exam, or it belongs to someone the
	 * actor may not see.
	 */
	const finish = op({
		args: [responseFinish],
		returns: responseSchema,
		run: async (
			tx: PrismaTx,
			input: ResponseFinish,
			opts: ServiceOptsWithoutTx,
		): Promise<Response> => {
			const course = valueOrNotFound(
				"course",
				await tx.course.findUnique({
					where: courseRefWhere(input.course),
					select: courseSelect(opts.actor),
				}),
			);
			const authorId = resolveAuthorId(input.author, opts.actor);
			if (
				!hasPerm(opts.actor, "response.read", {
					author: { username: authorId },
					course,
				})
			) {
				throw new NotFound("response");
			}

			const exam = valueOrNotFound(
				"exam",
				await tx.exam.findUnique({
					where: { courseId_slug: { courseId: course.id, slug: input.exam } },
					select: { id: true, type: true },
				}),
			);
			const include = responseInclude(opts.actor);
			const row = valueOrNotFound(
				"response",
				exam.type === "PRACTICE" && !isSimulation(opts.actor, authorId, course)
					? await tx.response.findFirst({
							where: { authorId, examId: exam.id, preview: false },
							orderBy: { slotKey: "desc" },
							include,
						})
					: await tx.response.findUnique({
							where: {
								authorId_examId_slotKey: {
									authorId,
									examId: exam.id,
									slotKey: 0,
								},
							},
							include,
						}),
			);
			if (!row.acceptingSubmissions) return fromDb(row);

			await promoteFinalSends(tx, sendsOf(row));

			// The student's own call: it never carries an expectation, and must not fail on one.
			const updated = await guardedUpdate(
				tx,
				"response",
				{ id: row.id },
				{ acceptingSubmissions: false, closedAt: new Date() },
				{},
				{ include: responseInclude(opts.actor) },
			);
			return fromDb(await gradeOnClose(tx, updated));
		},
	});

	/**
	 * Grades the objective answers of the attempts that were closed, or ran out of time, without being graded.
	 *
	 * It is the catch-up for attempts closed before the server graded on closing. Exams whose grades were released are left out unless `released`, and an attempt still open is never touched. With `dryRun` nothing is written. Returns one line per exam that has such attempts.
	 *
	 * @throws {@link NotAllowed} When the actor lacks `system.manage`.
	 * @throws {@link NotFound} If the course does not exist.
	 */
	const gradeObjectives = op({
		args: [responseGradeObjectives],
		returns: z.array(
			z.object({
				exam: z.string(),
				attempts: z.number().int(),
				graded: z.number().int(),
				released: z.boolean(),
			}),
		),
		run: async (
			tx: PrismaTx,
			input: ResponseGradeObjectives,
			opts: ServiceOptsWithoutTx,
		): Promise<ObjectiveGradingLine[]> => {
			ensurePerm(opts.actor, "system.manage");
			const course = valueOrNotFound(
				"course",
				await tx.course.findUnique({
					where: courseRefWhere(input.course),
					select: { id: true },
				}),
			);
			const exams = await tx.exam.findMany({
				where: {
					courseId: course.id,
					...(input.exam ? { slug: input.exam } : {}),
					...(input.released ? {} : { gradesReleasedAt: null }),
				},
				select: { id: true, slug: true, gradesReleasedAt: true },
				orderBy: { id: "asc" },
			});
			const lines: ObjectiveGradingLine[] = [];
			for (const exam of exams) {
				const { attempts, graded } = await gradeExpiredObjectives(tx, {
					examId: exam.id,
					dryRun: input.dryRun,
				});
				if (attempts === 0) continue;
				lines.push({
					exam: exam.slug,
					attempts,
					graded,
					released: exam.gradesReleasedAt !== null,
				});
			}
			return lines;
		},
	});

	/**
	 * Grades the objective answers of the attempts of an exam whose time ran out, and returns how many answers it graded.
	 *
	 * It covers the attempts nobody delivered, which no flow closes by itself. An attempt still within its time is left alone, and `acceptingSubmissions` is never changed. It is idempotent: an answer that already has a grading pass is not graded again, and it returns early when no answer lacks one.
	 *
	 * @throws {@link NotFound} If the course or the exam does not exist.
	 * @throws {@link NotAllowed} If the actor is not the course's instructor and `author` is not the actor.
	 */
	const settleExpired = op({
		args: [responseSettleExpired],
		returns: z.number().int().nonnegative(),
		run: async (
			tx: PrismaTx,
			input: ResponseSettleExpired,
			opts: ServiceOptsWithoutTx,
		): Promise<number> => {
			const course = valueOrNotFound(
				"course",
				await tx.course.findUnique({
					where: courseRefWhere(input.course),
					select: courseSelect(
						opts.actor,
						...(input.author === undefined ? [] : [input.author]),
					),
				}),
			);
			if (input.author === undefined) {
				ensurePerm(opts.actor, "course.update-contents", course);
			} else {
				ensurePerm(opts.actor, "response.read", {
					author: { username: input.author },
					course,
				});
			}
			const exam = valueOrNotFound(
				"exam",
				await tx.exam.findUnique({
					where: { courseId_slug: { courseId: course.id, slug: input.exam } },
					select: { id: true },
				}),
			);
			// Raw SQL: Prisma's `feedbacks: { none: {} }` aggregates the whole
			// `Feedback` table, and this walks only the attempts of the exam.
			const waiting = await tx.$queryRawUnsafe<{ id: number | bigint }[]>(
				`SELECT s.id AS id
				FROM ResponseRef r
				CROSS JOIN Submission s ON s.responseId = r.id
				WHERE r.examId = ?
					AND ${realAttemptSql("r")}
					${input.author === undefined ? "" : "AND r.authorId = ?"}
					AND s.status <> 'WILL_NOT_GRADE'
					AND NOT EXISTS (
						SELECT 1 FROM Feedback f WHERE f.submissionId = s.id
					)
				LIMIT 1`,
				exam.id,
				...(input.author === undefined ? [] : [input.author]),
			);
			if (waiting.length === 0) return 0;
			const { graded } = await gradeExpiredObjectives(tx, {
				examId: exam.id,
				author: input.author,
			});
			return graded;
		},
	});

	/**
	 * Deletes the actor's simulation of an exam, with everything it holds, and opens another.
	 *
	 * The new simulation has a new `publicId`, so its shuffling seed changes with it. With no simulation to delete it only opens one.
	 *
	 * @throws {@link NotFound} If the course or exam does not exist.
	 * @throws {@link NotAllowed} If the actor does not teach the course.
	 */
	const restartPreview = op({
		args: [responseRestartPreview],
		returns: responseSchema,
		run: async (
			tx: PrismaTx,
			input: ResponseRestartPreview,
			opts: ServiceOptsWithoutTx,
		): Promise<Response> => {
			const { exam, authorId, preview } = await prepareAttempt(
				tx,
				input,
				opts.actor,
				"response.create",
			);
			if (!preview) throw new NotAllowed("response.create");

			const old = await tx.response.findFirst({
				where: { authorId, examId: exam.id, preview: true },
				select: { id: true },
			});
			if (old) {
				await tx.submission.deleteMany({ where: { responseId: old.id } });
				await guardedDelete(tx, "response", { id: old.id }, {});
			}
			return fromDb(
				await invalidIfExists(tx.response.create, {
					data: {
						publicId: generateToken(9),
						authorId,
						examId: exam.id,
						preview: true,
					},
					include: responseInclude(opts.actor),
				}),
			);
		},
	});

	/**
	 * Resolves the attempt and appends one submission to it, in one call.
	 *
	 * This is what a client answering a question actually does; `upsert` then
	 * `submission.create` is the same thing spelled out, minus the guarantee
	 * that both halves land together. Answering the same question again
	 * appends a second submission rather than replacing the first.
	 *
	 * A `SUBMIT` whose code equals an earlier send of the question in the
	 * attempt (see `enqueueGradingJob`) appends nothing and spends nothing; the
	 * answer carries `duplicate: true`.
	 *
	 * @throws {@link InvalidData}
	 * If the attempt is closed to new submissions, its exam is not open,
	 * its deadline has passed, or the question is not one the exam carries.
	 * @throws {@link NotAllowed} If `actor` may not write the author's work.
	 */
	const submit = op({
		args: [responseSubmit],
		returns: responseSubmitted,
		run: async (
			tx: PrismaTx,
			input: ResponseSubmit,
			opts: ServiceOptsWithoutTx,
		): Promise<Response & { duplicate: boolean }> => {
			const { row, duplicate } = await appendSubmission(tx, input, opts.actor);
			const updated = valueOrNotFound(
				"response",
				await tx.response.findUnique({
					where: { id: row.id },
					include: responseInclude(opts.actor),
				}),
			);
			return { ...fromDb(updated), duplicate };
		},
	});

	/**
	 * Appends a submission as `submit` does, answering only with what the exam page reads back instead of the whole attempt.
	 *
	 * @throws {@link NotFound} If the course, exam or question does not exist.
	 * @throws {@link InvalidData}
	 * If the attempt is closed, the exam is not open, the question is not in
	 * the exam, or the payload does not fit it.
	 * @throws {@link NotAllowed} If `actor` may not write the author's work.
	 */
	const answer = op({
		args: [responseSubmit],
		returns: responseAnswered,
		run: async (
			tx: PrismaTx,
			input: ResponseSubmit,
			opts: ServiceOptsWithoutTx,
		): Promise<ResponseAnswered> => {
			const { row, duplicate } = await appendSubmission(tx, input, opts.actor);
			return {
				response: row.publicId,
				answerHistory: effectiveAnswerHistory(row.exam),
				duplicate,
			};
		},
	});

	return {
		create,
		findOne,
		findMany,
		update,
		upsert,
		delete: remove,
		finish,
		gradeObjectives,
		settleExpired,
		restartPreview,
		submit,
		answer,
	};
});

/** The response service, as built by {@link makeResponseService}. */
export type ResponseService = ReturnType<typeof makeResponseService>;

// Private utilities -----------------------------------------------------------

/// Appends one submission of a question to the attempt it belongs to, opening the attempt when there is none, and returns that attempt.
async function appendSubmission(
	tx: PrismaTx,
	input: ResponseSubmit,
	actor: Actor,
): Promise<{ row: DbAttempt; duplicate: boolean }> {
	const { attempt: row, exception } = await resolveOrCreateAttempt(
		tx,
		{ course: input.course, exam: input.exam, author: input.author },
		actor,
		"response.submit",
		undefined,
	);

	assertAcceptingSubmissions(
		row,
		new Date(),
		exception === undefined
			? await loadExceptionTiming(tx, row.examId, row.authorId)
			: exception,
	);
	const question = await resolveExamQuestion(
		tx,
		row.exam.courseId,
		row.examId,
		input.question,
		input.payload,
	);

	let duplicate = false;
	if (input.kind === "SUBMIT") {
		if (question.type !== "CODE" || !question.worker) {
			throw new InvalidData({
				kind: [{ code: "invalid", message: m.errors_code_not_sendable() }],
			});
		}
		({ duplicate } = await enqueueGradingJob(
			tx,
			{
				responseId: row.id,
				questionId: question.id,
				attempts: question.attempts,
				practice: isPractice(row),
			},
			question.worker,
			{
				kind: "SUBMIT",
				payload: input.payload as Prisma.InputJsonValue,
				startedAt: input.startedAt,
				automaticallyTriggered: input.automaticallyTriggered,
			},
		));
	} else {
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
	}

	// The submissions are part of the response, so appending one moves its
	// version. A student's save carries no expectation and never fails on one.
	if (!duplicate) await touch(tx, "response", { id: row.id }, {});
	return { row, duplicate };
}

/// The attempt as {@link promoteFinalSends} reads it. A simulation sends as a practice attempt does.
function sendsOf(row: {
	id: ResponseId;
	preview: boolean;
	exam: { type: string };
}) {
	return { id: row.id, practice: isPractice(row) };
}

/// Whether the code sends of `row` are unlimited and its grades visible: a practice exam's attempt, or a simulation.
function isPractice(row: {
	preview: boolean;
	exam: { type: string };
}): boolean {
	return row.preview || row.exam.type === "PRACTICE";
}

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

/// Refuses to reopen `response` when its author's personal window closed or its deadline passed.
async function assertReopenable(
	tx: PrismaTx,
	response: Omit<DbResponse, "submissions">,
): Promise<void> {
	const exception = await loadExceptionTiming(
		tx,
		response.examId,
		response.authorId,
	);
	if (
		!canReopen(
			examSchedule(
				examTimingFromDb(response.exam),
				exception ? new Map([[response.authorId, exception]]) : undefined,
			),
			response.authorId,
			response,
			new Date(),
		)
	) {
		throw new InvalidData({
			response: [
				{ code: "invalid", message: m.errors_response_window_closed() },
			],
		});
	}
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

/// The `response.*` permission target of a row fetched with `responseInclude`.
function responseTarget(row: {
	id: number;
	authorId: string;
	exam: {
		course: {
			instructor: { username: string };
			enrollments: { username: string }[];
		};
	};
}): ResponseWithCourse {
	return {
		id: row.id,
		author: { username: row.authorId },
		course: row.exam.course,
	};
}

/// Whether `actor` may read a response row fetched with `responseInclude`.
function hasReadAccess(actor: Actor, row: DbResponse): boolean {
	return hasPerm(actor, "response.read", responseTarget(row));
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
	expected: Date | null | undefined,
): Promise<DbResponse> {
	const row = await tx.response.findFirst({
		where: responseWhere(filter),
		include: responseInclude(actor),
	});
	if (!row) {
		// A missing row is a 412 for a caller that expected one, unless its course is missing too.
		if (expected !== undefined) {
			if ("course" in filter && filter.course !== undefined) {
				valueOrNotFound(
					"course",
					await tx.course.findUnique({
						where: courseRefWhere(filter.course),
						select: { id: true },
					}),
				);
			}
			checkExpectedUpdatedAt(null, expected);
		}
		throw new NotFound("response");
	}

	const target = responseTarget(row);
	requireAccess(responseAccess(actor, target), "write", action, {
		target: simplifyTarget(action, target),
		expectedUpdatedAt: expected,
	});
	return row;
}

/// Resolves the author for a write, defaulting to the actor.
function resolveAuthorId(author: string | undefined, actor: Actor): string {
	if (author) return author;
	if (actor === SYSTEM) {
		throw new InvalidData({
			author: [
				{ code: "missing", message: m.errors_response_author_required() },
			],
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
 * the author holds an active enrollment (a simulation needs none), that a
 * practice session is never named on a graded exam, and the
 * `response.create`/`response.submit` permission.
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
			select: courseSelect(actor, ...(input.author ? [input.author] : [])),
		}),
	);

	const exam = valueOrNotFound(
		"exam",
		await tx.exam.findUnique({
			where: { courseId_slug: { courseId: course.id, slug: input.exam } },
			select: {
				id: true,
				slug: true,
				answerHistory: true,
				...examTimingSelect,
			},
		}),
	);

	if (
		!hasPerm(actor, "course.update-contents", course) &&
		hiddenFromStudents(exam.status)
	) {
		throw new NotFound("exam");
	}

	const authorId = resolveAuthorId(input.author, actor);

	ensurePerm(actor, perm, {
		author: { username: authorId },
		course,
	});

	const preview = isSimulation(actor, authorId, course);
	if (!preview && !course.enrollments.some((e) => e.username === authorId)) {
		throw new InvalidData({
			author: [
				{
					code: "invalid",
					message: m.errors_author_not_enrolled({ username: authorId }),
				},
			],
		});
	}

	if (exam.type !== "PRACTICE" && input.practiceSession !== undefined) {
		throw new InvalidData({
			practiceSession: [
				{
					code: "invalid",
					message: m.errors_practice_session_on_graded(),
				},
			],
		});
	}

	return { course, exam, authorId, preview };
}

/**
 * Whether an attempt `actor` writes as `authorId` is the instructor's simulation.
 *
 * It is when whoever teaches the course writes for themself: the instructor is never a student of their own course, so no other attempt of theirs exists. SYSTEM, an admin who does not teach it, and the instructor writing for a student are not simulating.
 */
function isSimulation(
	actor: Actor,
	authorId: string,
	course: { instructor: { username: string } },
): boolean {
	return (
		actor !== SYSTEM &&
		actor.username === authorId &&
		hasPerm(actor, "course.update-contents", course)
	);
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
	expected: Date | null | undefined,
) {
	const { course, exam, authorId, preview } = await prepareAttempt(
		tx,
		input,
		actor,
		perm,
	);
	// Read once here; `undefined` when the actor writes the course and no clock applies.
	let exception: ExceptionTiming | null | undefined;
	if (!hasPerm(actor, "course.update-contents", course)) {
		exception = await loadExceptionTiming(tx, exam.id, authorId);
		assertExamOpen(
			exam,
			new Date(),
			exception,
			perm === "response.submit" ? EXAM_ANSWER_GRACE_MS : 0,
		);
	}
	// The exam and course are already loaded, so the attempt is read as a bare row.
	const withExam = <Row extends { updatedAt: Date }>(row: Row) => ({
		attempt: { ...row, exam: { ...exam, courseId: course.id, course } },
		exception,
	});

	// A simulation has one slot on any exam, and no session window.
	if (exam.type !== "PRACTICE" || preview) {
		const existing = await tx.response.findUnique({
			where: {
				authorId_examId_slotKey: { authorId, examId: exam.id, slotKey: 0 },
			},
		});
		if (existing) {
			checkExpectedUpdatedAt(existing.updatedAt, expected);
			return withExam(existing);
		}

		checkExpectedUpdatedAt(null, expected);
		return withExam(
			await invalidIfExists(tx.response.create, {
				data: {
					publicId: generateToken(9),
					authorId,
					examId: exam.id,
					preview,
				},
			}),
		);
	}

	const windowStart = dateToSlotKey(
		new Date(Date.now() - PRACTICE_SESSION_WINDOW_MS),
	);
	const existing = await tx.response.findFirst({
		where: { authorId, examId: exam.id, slotKey: { gte: windowStart } },
		orderBy: { slotKey: "desc" },
	});
	if (existing) {
		checkExpectedUpdatedAt(existing.updatedAt, expected);
		return withExam(existing);
	}

	checkExpectedUpdatedAt(null, expected);
	return withExam(
		await invalidIfExists(tx.response.create, {
			data: {
				publicId: generateToken(9),
				authorId,
				examId: exam.id,
				slotKey: dateToSlotKey(input.practiceSession ?? new Date()),
			},
		}),
	);
}

/// The `closedAt` to write when `row` is set to `accepting`: now on closing an open attempt, `null` on reopening, and `undefined` (untouched) otherwise, so a second close keeps the first instant.
function closedAtAfter(
	row: { acceptingSubmissions: boolean },
	accepting: boolean | undefined,
): Date | null | undefined {
	if (accepting === undefined) return undefined;
	if (accepting) return null;
	return row.acceptingSubmissions ? new Date() : undefined;
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
		closedAt: row.closedAt,
		preview: row.preview,
		createdBy: row.createdById,
		submissions: row.submissions.map(submissionFromDb),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/// Grades the objective answers of the attempt `row` just closed, and returns the row as it reads afterwards.
async function gradeOnClose(
	tx: PrismaTx,
	row: DbResponse,
): Promise<DbResponse> {
	if ((await gradeAttempt(tx, row.id)) === 0) return row;
	return valueOrNotFound(
		"response",
		await tx.response.findUnique({
			where: { id: row.id },
			// The caller already checked the write, so no enrollment is read.
			include: responseInclude(SYSTEM),
		}),
	);
}
