/**
 * Exams and the questions they are assembled from.
 *
 * An exam lives in exactly one course, so writes are ownership-gated
 * (`course.update-contents`) and reads follow `course.read-contents`, with a
 * `DRAFT` or `ARCHIVED` exam visible to its author alone.
 */

import type { Attachment } from "mdq";
import { z } from "zod";
import { accessError, examAccess, requireAccess } from "@/auth/access";
import { type Actor, SYSTEM } from "@/auth/actor";
import { ensurePerm, hasPerm } from "@/auth/permissions";
import {
	GradeReleaseRefused,
	InvalidData,
	NotAllowed,
	NotFound,
} from "@/core/error";
import type { CourseId, ExamId } from "@/core/schemas/base";
import { slug } from "@/core/schemas/base";
import {
	courseExamSchema,
	type examCreate,
	examFilter,
	examFilterByCourses,
	examFullSchema,
	examPK,
	type examUpdate,
	examWriteCreate,
	examWriteUpdate,
} from "@/core/schemas/exam";
import type { ServiceOpts, ServiceOptsWithoutTx } from "@/db/base-service";
import {
	checkExpectedUpdatedAt,
	checkVersion,
	guardedUpdate,
} from "@/db/conditional-write";
import { courseAccess } from "@/db/course-access";
import { defineService, op } from "@/db/define-service";
import { loadResultPolicy } from "@/db/result-policy";
import type { AttachmentService } from "@/db/services/attachment.service";
import type { BlobService } from "@/db/services/blob.service";
import { courseContentsWhere } from "@/db/services/course.service";
import {
	examTimingFromDb,
	examTimingSelect,
	freezeQuestionVersions,
	grantedDocument,
	grantViews,
	issueExamGrant,
	latestVersions,
	loadExceptionTiming,
	unsafePinnedDocument,
	unsafePinnedDocuments,
} from "@/db/services/exam-questions";
import { promoteFinalSends } from "@/db/services/grading-job-queue";
import {
	gradeExpiredObjectives,
	gradeObjectives,
} from "@/db/services/objective-grading";
import { m } from "@/i18n";
import { attachmentProblems } from "@/mdq";
import {
	type AttachmentFiles,
	assertBlobsMatch,
	assertFencedWithinLimit,
	filesColumn,
	resolveFiles,
	serveAttachmentFile,
	type WithAttachments,
} from "@/services/attachment-files";
import {
	type ExamResult,
	examResult,
	sanctionsByResponse,
} from "@/services/exam-result";
import {
	attachmentsOpen,
	type ExceptionTiming,
	examPhase,
	type GradeReleaseBlocker,
	hiddenExamStatuses,
	hiddenFromStudents,
	openExceptionCount,
	pendingAnswerCount,
	releaseBlocker,
	viewerTiming,
} from "@/services/exam-state";
import { activeAdjustmentsOf } from "../active-adjustments";
import {
	DbNull,
	type Prisma,
	type PrismaClient,
	type PrismaTx,
	prisma,
} from "../client";
import { realAttempt } from "../preview-filter";
import {
	courseRefWhere,
	exceptionSchedule,
	fromMs,
	invalidIfExists,
	toMs,
	valueOrNotFound,
} from "../utils";

export { examStatus, examType, textFormat } from "@/core/schemas/exam";
export type { ExamId };

//
// Type definitions
//
export type Exam = z.infer<typeof examFullSchema>;
export type ExamCreate = z.infer<typeof examCreate>;
export type ExamWriteCreate = z.infer<typeof examWriteCreate>;
export type ExamWriteUpdate = z.infer<typeof examWriteUpdate>;
export type ExamFilter = z.infer<typeof examFilter>;
export type ExamFilterByCourses = z.infer<typeof examFilterByCourses>;
export type CourseExam = z.infer<typeof courseExamSchema>;
export type ExamPK = z.infer<typeof examPK>;
export type ExamUpdate = z.infer<typeof examUpdate>;

/// The course shape the permission predicates need, plus the exam's own relations. With `enrolledUser`, only that user's enrollment is loaded: all the checks ask about the actor.
function examInclude(enrolledUser?: string) {
	return {
		course: {
			select: {
				instructor: { select: { username: true } },
				enrollments: {
					where: {
						status: "ACTIVE" as const,
						...(enrolledUser === undefined ? {} : { username: enrolledUser }),
					},
					select: { username: true },
				},
			},
		},
		examTags: { select: { tag: true } },
		questionsForExams: {
			select: {
				version: true,
				questionRef: { select: { id: true, slug: true, latestId: true } },
			},
			// Rows written before `position` existed all hold zero and keep their old order.
			orderBy: [
				{ position: "asc" as const },
				{ questionRefId: "asc" as const },
			],
		},
	} satisfies Prisma.ExamInclude;
}

type DbExam = Prisma.ExamGetPayload<{
	include: ReturnType<typeof examInclude>;
}>;

/// The CRUD shape of the exam service.
type ExamT = {
	entity: Exam;
	pkFilter: ExamPK;
	create: ExamWriteCreate;
	filter: ExamFilter;
	update: ExamWriteUpdate;
};

/// What the exam service needs besides the database: the ledger of attachments and the byte store.
type Deps = { attachments: AttachmentService; blob: BlobService };

const buildExamService = (deps: Deps) =>
	defineService<ExamT>()(() => {
		/**
		 * Creates an exam in a course, with its tags and its pinned questions.
		 *
		 * The questions are given by slug and must live in the same course; a slug
		 * that does not resolve there is refused rather than silently dropped.
		 */
		const create = op({
			args: [examWriteCreate],
			returns: examFullSchema,
			run: async (
				tx: PrismaTx,
				input: ExamWriteCreate,
				opts: ServiceOptsWithoutTx,
			): Promise<Exam> => {
				const course = await courseAccess(tx, input.course, opts, {
					perm: "course.update-contents",
				});
				const questions = await resolveQuestions(
					tx,
					course.id,
					input.questions,
				);
				const attachments = await prepareAttachments(tx, deps, input, opts);

				const row = await invalidIfExists(tx.exam.create.bind(tx.exam), {
					data: {
						courseId: course.id,
						slug: input.slug,
						type: input.type,
						status: input.status,
						title: input.title,
						description: input.description ?? null,
						preamble: input.preamble ?? null,
						format: input.format ?? "MARKDOWN",
						scheduledAt: input.scheduledAt ?? null,
						durationMs: toMs(input.duration) ?? null,
						allowCodeRun: input.allowCodeRun ?? null,
						rev: input.rev,
						authorId:
							opts.actor === SYSTEM
								? course.instructor.username
								: opts.actor.username,
						examTags: { create: (input.tags ?? []).map((tag) => ({ tag })) },
						questionsForExams: { create: questions },
						...(attachments && attachmentColumns(attachments)),
					},
					include: examInclude(),
				});
				if (attachments) {
					await deps.attachments.attachFiles(
						{ type: "EXAM", id: row.id as ExamId },
						attachments.files,
						input.blobs ?? {},
						{ ...opts, tx },
					);
				}

				return fromDb(
					row,
					"full",
					(await loadWeights(tx, [row])).get(row.id) ?? [],
				);
			},
		});

		/**
		 * Finds an exam by id or by its `(course, slug)` natural key.
		 *
		 * A `DRAFT` or `ARCHIVED` exam does not exist for anyone but whoever may
		 * write the course's contents.
		 */
		const findOne = op({
			transaction: false,
			args: [examPK],
			returns: examFullSchema.nullable(),
			run: async (
				tx: PrismaTx,
				filter: ExamPK,
				opts: ServiceOptsWithoutTx,
			): Promise<Exam | null> => {
				const row = await tx.exam.findFirst({
					where: examWhere(filter),
					// SYSTEM passes every check without enrollments, so it loads none.
					include: examInclude(
						opts.actor === SYSTEM ? "" : opts.actor.username,
					),
				});
				if (!row) return null;

				// An outsider is refused whatever the status, so a draft slug cannot be
				// told from a published one.
				const error = accessError(
					examAccess(opts.actor, row),
					"read",
					"exam.read",
				);
				if (error instanceof NotFound) return null;
				if (error) throw error;

				const views = await attachmentViews(tx, [row], opts.actor);
				const withQuestions = await questionsShown(
					tx,
					[row],
					views,
					opts.actor,
				);
				const weights = await loadWeights(tx, [row]);
				return fromDb(
					row,
					views.get(row.id) ?? "hidden",
					weights.get(row.id) ?? [],
					withQuestions.has(row.id),
				);
			},
		});

		/**
		 * Lists the exams of one course, narrowed to what `actor` may see.
		 *
		 * Drafts and archived exams are left out for anyone but whoever may write
		 * the course's contents.
		 */
		const findMany = op({
			transaction: false,
			args: [examFilter],
			returns: examFullSchema.array(),
			run: async (
				tx: PrismaTx,
				filter: ExamFilter,
				opts: ServiceOptsWithoutTx,
			): Promise<Exam[]> => {
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

				if (!hasPerm(opts.actor, "course.read-contents", course)) {
					throw new NotAllowed("exam.read");
				}
				const full = hasPerm(opts.actor, "course.update-contents", course);

				const rows = await tx.exam.findMany({
					where: {
						courseId: course.id,
						// Both conditions hold together: a status filter narrows what the
						// actor may see, it never widens it to drafts.
						AND: [
							full ? {} : { status: { notIn: [...hiddenExamStatuses] } },
							filter.statuses ? { status: { in: filter.statuses } } : {},
						],
						...(filter.exams ? { slug: { in: filter.exams } } : {}),
						...(filter.types ? { type: { in: filter.types } } : {}),
						...(filter.tags
							? { examTags: { some: { tag: { in: filter.tags } } } }
							: {}),
					},
					include: examInclude(),
					orderBy: { slug: "asc" },
				});

				const views = await attachmentViews(tx, rows, opts.actor);
				const withQuestions = await questionsShown(tx, rows, views, opts.actor);
				const weights = await loadWeights(tx, rows);
				return rows.map((row) =>
					fromDb(
						row,
						views.get(row.id) ?? "hidden",
						weights.get(row.id) ?? [],
						withQuestions.has(row.id),
					),
				);
			},
		});

		/**
		 * Lists the exams of several courses in one query, each paired with its course id and narrowed to what `actor` may see.
		 *
		 * Visibility is decided per course, as in `findMany`: drafts and archived
		 * exams only for whoever may write that course's contents. A course whose
		 * contents the actor may not read contributes no exams; it is not an error.
		 * An empty `courseIds` returns an empty list without querying.
		 */
		const findManyInCourses = op({
			transaction: false,
			args: [examFilterByCourses],
			returns: courseExamSchema.array(),
			run: async (
				tx: PrismaTx,
				filter: ExamFilterByCourses,
				opts: ServiceOptsWithoutTx,
			): Promise<CourseExam[]> => {
				if (filter.courseIds.length === 0) return [];
				const rows = await tx.exam.findMany({
					where: {
						courseId: { in: filter.courseIds },
						// Prunes courses the actor cannot read; the loop below enforces it again.
						course: courseContentsWhere(opts.actor),
						...(filter.statuses ? { status: { in: filter.statuses } } : {}),
						...(filter.exams ? { slug: { in: filter.exams } } : {}),
						...(filter.types ? { type: { in: filter.types } } : {}),
						...(filter.tags
							? { examTags: { some: { tag: { in: filter.tags } } } }
							: {}),
					},
					// SYSTEM passes every check without enrollments, so it loads none.
					include: examInclude(
						opts.actor === SYSTEM ? "" : opts.actor.username,
					),
					orderBy: [{ courseId: "asc" }, { slug: "asc" }],
				});

				const views = await attachmentViews(tx, rows, opts.actor);
				const withQuestions = await questionsShown(tx, rows, views, opts.actor);
				const weights = await loadWeights(tx, rows);
				const result: CourseExam[] = [];
				for (const row of rows) {
					if (!hasPerm(opts.actor, "course.read-contents", row.course))
						continue;
					const full = hasPerm(
						opts.actor,
						"course.update-contents",
						row.course,
					);
					if (!full && hiddenFromStudents(row.status)) {
						continue;
					}
					result.push({
						courseId: row.courseId as CourseId,
						exam: fromDb(
							row,
							views.get(row.id) ?? "hidden",
							weights.get(row.id) ?? [],
							withQuestions.has(row.id),
						),
					});
				}
				return result;
			},
		});

		/**
		 * Updates an exam's fields, its tag set, and the questions it pins.
		 *
		 * `tags` and `questions` are replaced wholesale when given, so a push always
		 * leaves the exam holding exactly what the caller sent.
		 */
		const update = op({
			args: [examPK, examWriteUpdate],
			returns: examFullSchema,
			run: async (
				tx: PrismaTx,
				filter: ExamPK,
				fields: ExamWriteUpdate,
				opts: ServiceOptsWithoutTx,
			): Promise<Exam> => {
				const exam = await writableExam(tx, filter, opts, "exam.update");
				// Before the validation: a stale caller changes nothing and sees no 400.
				await checkVersion(tx, "exam", { id: exam.id }, opts);
				const resolved = fields.questions
					? await resolveQuestions(tx, exam.courseId, fields.questions)
					: undefined;
				const attachments = await prepareAttachments(tx, deps, fields, opts);

				// A new date only makes sense in a window, so the duration stays while one exists.
				if (fields.duration === null) {
					const makeups = await tx.examException.count({
						where: { examId: exam.id, scheduledAt: { not: null } },
					});
					if (makeups > 0) {
						throw new InvalidData({
							duration: [
								{
									code: "invalid",
									message: m.errors_exam_duration_needed_by_exceptions(),
								},
							],
						});
					}
				}

				// Completing the exam freezes the versions before its questions are rewritten.
				if (fields.status === "COMPLETED") {
					await freezeQuestionVersions(tx, exam.id as ExamId);
				}
				const questions =
					resolved && (await keepPins(tx, exam.id as ExamId, resolved));

				// The tags and questions are owned children of the exam: replacing them
				// is part of this write, which moves the exam's version.
				const row = await guardedUpdate(
					tx,
					"exam",
					{ id: exam.id },
					{
						type: fields.type,
						status: fields.status,
						title: fields.title,
						description: fields.description,
						preamble: fields.preamble,
						format: fields.format,
						scheduledAt: fields.scheduledAt,
						durationMs: toMs(fields.duration),
						allowCodeRun: fields.allowCodeRun,
						rev: fields.rev,
						// The column is not nullable: no extra time is stored as zero.
						extraTimeMs: fields.extraTime === null ? 0 : toMs(fields.extraTime),
						...(fields.tags && {
							examTags: {
								deleteMany: {},
								create: fields.tags.map((tag) => ({ tag })),
							},
						}),
						...(questions && {
							questionsForExams: { deleteMany: {}, create: questions },
						}),
						...(attachments && attachmentColumns(attachments)),
					},
					opts,
					{ include: examInclude() },
				);
				// Completing the exam ends the attempts, whoever completes it.
				if (fields.status === "COMPLETED" && exam.status !== "COMPLETED") {
					await closeOpenAttempts(tx, exam.id as ExamId);
				}
				if (attachments) {
					const owner = { type: "EXAM" as const, id: exam.id as ExamId };
					await deps.attachments.attachFiles(
						owner,
						attachments.files,
						fields.blobs ?? {},
						{ ...opts, tx },
					);
					await deps.attachments.detachExcept(owner, attachments.files, {
						...opts,
						tx,
					});
				}

				return fromDb(
					row,
					"full",
					(await loadWeights(tx, [row])).get(row.id) ?? [],
				);
			},
		});

		/**
		 * Ends an exam now: completes it and closes the attempts still taking answers.
		 *
		 * The attempts close as if their time had run out: what was saved counts
		 * and the objective answers are graded. The instructor's simulation stays
		 * as it is, and so does the attempt of a student whose exception keeps
		 * their own window open. Closing a completed exam changes nothing.
		 * `update` with `status: "COMPLETED"` does the same.
		 *
		 * @throws {@link NotFound} If the exam does not exist or `actor` may not see it.
		 * @throws {@link NotAllowed} If `actor` may not write the course's contents.
		 * @throws {@link InvalidData} If the exam is a draft or archived.
		 */
		const close = op({
			args: [examPK],
			returns: examFullSchema,
			run: async (
				tx: PrismaTx,
				filter: ExamPK,
				opts: ServiceOptsWithoutTx,
			): Promise<Exam> => {
				const exam = await writableExam(tx, filter, opts, "exam.update");
				await checkVersion(tx, "exam", { id: exam.id }, opts);
				if (hiddenFromStudents(exam.status)) {
					throw new InvalidData({
						exam: [{ code: "invalid", message: m.errors_exam_close_hidden() }],
					});
				}

				await freezeQuestionVersions(tx, exam.id as ExamId);
				let row: DbExam;
				if (exam.status === "COMPLETED") {
					row = await tx.exam.findUniqueOrThrow({
						where: { id: exam.id },
						include: examInclude(),
					});
				} else {
					row = await guardedUpdate(
						tx,
						"exam",
						{ id: exam.id },
						{ status: "COMPLETED" },
						opts,
						{ include: examInclude() },
					);
					await closeOpenAttempts(tx, exam.id as ExamId);
				}
				return fromDb(
					row,
					"full",
					(await loadWeights(tx, [row])).get(row.id) ?? [],
				);
			},
		});

		/**
		 * Upserts an exam keyed on its `(course, slug)` natural key.
		 *
		 * An archived exam under that key takes the update branch, which revives it
		 * only if the caller sends a new `status`.
		 */
		const upsert = op({
			args: [examWriteCreate],
			returns: examFullSchema,
			run: async (
				tx: PrismaTx,
				input: ExamWriteCreate,
				opts: ServiceOptsWithoutTx,
			): Promise<Exam> => {
				// Checked up front so both branches refuse a non-author the same way,
				// without telling them whether the exam exists.
				const course = await courseAccess(tx, input.course, opts, {
					perm: "course.update-contents",
				});

				const existing = await tx.exam.findUnique({
					where: { courseId_slug: { courseId: course.id, slug: input.slug } },
					select: { id: true },
				});
				if (!existing) {
					checkExpectedUpdatedAt(null, opts.expectedUpdatedAt);
					return create(tx, { ...input, course: course.id }, opts);
				}

				const { slug: _slug, course: _course, ...fields } = input;
				return update(
					tx,
					{ course: course.id, slug: input.slug },
					fields,
					opts,
				);
			},
		});

		/**
		 * Releases an exam's grades to its students now.
		 *
		 * Sets `gradesReleasedAt` to the current time. Calling it again on a
		 * released exam returns it unchanged. Only a closed `EXAM` with no answer
		 * still waiting for a grade can be released: a `QUIZ` and a `PRACTICE`
		 * release on their own schedule.
		 *
		 * @throws {@link NotFound} If the exam does not exist or `actor` may not see it.
		 * @throws {@link NotAllowed}
		 * If `actor` may not write the course's contents, or authenticated with a BOT key.
		 * @throws {@link GradeReleaseRefused}
		 * If the exam is not an `EXAM`, is not closed, has a personal window still open, or has an answer waiting for a grade.
		 */
		const releaseGrades = op({
			args: [examPK],
			returns: examFullSchema,
			run: async (
				tx: PrismaTx,
				filter: ExamPK,
				opts: ServiceOptsWithoutTx,
			): Promise<Exam> => {
				const row = await tx.exam.findFirst({
					where: examWhere(filter),
					include: examInclude(),
				});
				if (!row) return missingExam(tx, filter, opts.expectedUpdatedAt);

				requireAccess(
					examAccess(opts.actor, row),
					"write",
					"exam.update",
					opts,
				);
				ensurePerm(opts.actor, "exam.release-grades", row.course);
				// An exam that is already released is returned as it is, but not to a stale caller.
				await checkVersion(tx, "exam", { id: row.id }, opts);

				const exam = fromDb(
					row,
					"full",
					(await loadWeights(tx, [row])).get(row.id) ?? [],
				);
				const now = new Date();
				const schedule = exceptionSchedule(
					exam,
					await tx.examException.findMany({
						where: { examId: row.id },
						select: { username: true, extraTimeMs: true, scheduledAt: true },
					}),
					row.course.enrollments.map((enrollment) => enrollment.username),
				);
				let blocker = releaseBlocker(schedule, [], now);
				let results: ExamResult[] = [];
				if (!blocker) {
					await gradeExpiredObjectives(tx, { examId: row.id });
					results = await attemptResults(tx, row);
					blocker = releaseBlocker(schedule, results, now);
				}
				if (blocker === "released") return exam;
				if (blocker) {
					throw new GradeReleaseRefused(blocker, releaseRefusals[blocker](), {
						pendingAnswers: pendingAnswerCount(results),
						openExceptions: openExceptionCount(schedule, now),
					});
				}

				await freezeQuestionVersions(tx, row.id as ExamId);
				const updated = await guardedUpdate(
					tx,
					"exam",
					{ id: row.id },
					{ gradesReleasedAt: new Date() },
					opts,
					{ include: examInclude() },
				);
				return fromDb(
					updated,
					"full",
					(await loadWeights(tx, [updated])).get(updated.id) ?? [],
				);
			},
		});

		/**
		 * Turns the recording of the edit history of an exam on or off.
		 *
		 * Stores an explicit `enabled`, which from then on wins over the default of
		 * the exam type. History already recorded stays where it is. Only whoever
		 * may write the course's contents can flip it, and it is not a field of
		 * `update`: the exam files a CLI pushes never carry it.
		 *
		 * @throws {@link NotFound} If the exam does not exist or `actor` may not see it.
		 * @throws {@link NotAllowed} If `actor` may not write the course's contents.
		 */
		const setAnswerHistory = op({
			args: [examPK, z.boolean()],
			returns: examFullSchema,
			run: async (
				tx: PrismaTx,
				filter: ExamPK,
				enabled: boolean,
				opts: ServiceOptsWithoutTx,
			): Promise<Exam> => {
				const exam = await writableExam(tx, filter, opts, "exam.update");
				const row = await guardedUpdate(
					tx,
					"exam",
					{ id: exam.id },
					{ answerHistory: enabled },
					opts,
					{ include: examInclude() },
				);
				return fromDb(
					row,
					"full",
					(await loadWeights(tx, [row])).get(row.id) ?? [],
				);
			},
		});

		/**
		 * Archives an exam rather than removing it.
		 *
		 * Responses point at the exam they were written for, so the row stays
		 * readable; `update` or `upsert` bring it back.
		 */
		const remove = op({
			args: [examPK],
			run: async (
				tx: PrismaTx,
				filter: ExamPK,
				opts: ServiceOptsWithoutTx,
			): Promise<void> => {
				const exam = await writableExam(tx, filter, opts, "exam.delete");
				// An archived exam stays as it is, but a stale caller is still refused.
				await checkVersion(tx, "exam", { id: exam.id }, opts);
				if (exam.status === "ARCHIVED") return;

				await guardedUpdate(
					tx,
					"exam",
					{ id: exam.id },
					{ status: "ARCHIVED" },
					opts,
				);
			},
		});

		/**
		 * The bytes, mime type and name of the attachment `name` of an exam.
		 *
		 * A student gets it once the exam is open for them, and after it closed;
		 * whoever writes the exam's contents always does. A fenced attachment is
		 * served from the document, a link from the blob of `files`.
		 *
		 * @throws {@link NotFound}
		 * If the exam or the attachment does not exist, or the actor may not download it yet.
		 */
		const attachment = op({
			transaction: false,
			args: [examPK, z.string()],
			run: async (
				tx: PrismaTx,
				filter: ExamPK,
				name: string,
				opts: ServiceOptsWithoutTx,
			): Promise<DownloadedAttachment> => {
				const row = await downloadableExam(tx, filter, opts.actor);
				return serveAttachmentFile(
					deps.blob,
					tx,
					row.attachments as Attachment[] | null,
					row.files as AttachmentFiles | null,
					name,
				);
			},
		});

		/**
		 * The bytes, mime type and name of the attachment `name` of a question of an exam.
		 *
		 * The author reads the version the exam pins, or the latest of a question
		 * pinned to none. A student needs an exam grant and reads the version the
		 * grant holds.
		 *
		 * @throws {@link NotFound}
		 * If the exam, the question in it or the attachment does not exist, or the
		 * actor holds no grant for the exam.
		 */
		const questionAttachment = op({
			transaction: false,
			args: [examPK, slug, z.string()],
			run: async (
				tx: PrismaTx,
				filter: ExamPK,
				questionSlug: string,
				name: string,
				opts: ServiceOptsWithoutTx,
			): Promise<DownloadedAttachment> => {
				const row = await tx.exam.findFirst({
					where: examWhere(filter),
					include: examInclude(),
				});
				const access = row && examAccess(opts.actor, row);
				if (!row || (access !== "write" && access !== "read")) {
					throw new NotFound("attachment");
				}

				if (access === "write") {
					const pinned = row.questionsForExams.find(
						(q) => q.questionRef.slug === questionSlug,
					);
					if (!pinned) throw new NotFound("attachment");
					const version = await unsafePinnedDocument(
						tx,
						{
							id: pinned.questionRef.id,
							latestId: pinned.questionRef.latestId,
							version: pinned.version,
						},
						{ privatePayload: true, files: true },
					);
					if (!version) throw new NotFound("attachment");
					const document = version.privatePayload as unknown as
						| WithAttachments
						| undefined;
					return serveAttachmentFile(
						deps.blob,
						tx,
						document?.attachments ?? null,
						version.files as AttachmentFiles | null,
						name,
					);
				}

				const grant = await issueExamGrant(
					tx,
					{ course: row.courseId as CourseId, exam: row.slug },
					opts.actor,
				);
				const granted = grant?.questions.find((q) => q.slug === questionSlug);
				if (!grant || !granted) throw new NotFound("attachment");
				const document = (await grantedDocument(
					tx,
					grant,
					opts.actor,
					questionSlug,
				)) as WithAttachments;
				const data = await tx.questionData.findUnique({
					where: { id: granted.dataId },
					select: { files: true },
				});
				return serveAttachmentFile(
					deps.blob,
					tx,
					document.attachments ?? null,
					(data?.files as AttachmentFiles | null) ?? null,
					name,
				);
			},
		});

		return {
			create,
			findOne,
			findMany,
			findManyInCourses,
			update,
			upsert,
			close,
			releaseGrades,
			setAnswerHistory,
			attachment,
			questionAttachment,
			delete: remove,
		};
	});

/**
 * The exam service of `client` (the shared client by default), storing the
 * bytes of link attachments through `blob` and recording their use in
 * `attachments`.
 */
export const makeExamService = (
	attachments: AttachmentService,
	blob: BlobService,
	client: PrismaClient = prisma,
) => buildExamService({ attachments, blob })(client);

/** The exam service, as built by {@link makeExamService}. */
export type ExamService = ReturnType<typeof makeExamService>;

//
// Auxiliary functions
//

/// Why `releaseGrades` refuses, for each blocker it reports.
const releaseRefusals: Record<
	Exclude<GradeReleaseBlocker, "released">,
	() => string
> = {
	"not-an-exam": m.errors_release_not_an_exam,
	"not-closed": m.errors_release_not_closed,
	"exception-open": m.errors_release_exception_open,
	pending: m.errors_release_pending,
};

/// Closes the real attempts of the exam `examId` still taking answers, as if their time had run out. The attempt of a student whose exception keeps their personal window open stays as it is.
async function closeOpenAttempts(tx: PrismaTx, examId: ExamId): Promise<void> {
	const exam = await tx.exam.findUniqueOrThrow({
		where: { id: examId },
		select: examTimingSelect,
	});
	const completed = { ...examTimingFromDb(exam), status: "COMPLETED" as const };
	const now = new Date();
	const attempts = await tx.response.findMany({
		where: { ...realAttempt, examId, acceptingSubmissions: true },
		select: { id: true, authorId: true },
		orderBy: { id: "asc" },
	});
	for (const attempt of attempts) {
		const exception = await loadExceptionTiming(tx, examId, attempt.authorId);
		const phase = examPhase(viewerTiming(completed, exception), now);
		if (phase === "open" || phase === "upcoming") continue;

		await promoteFinalSends(tx, {
			id: attempt.id,
			practice: completed.type === "PRACTICE",
		});
		await guardedUpdate(
			tx,
			"response",
			{ id: attempt.id },
			{ acceptingSubmissions: false, closedAt: now },
			{},
		);
		await gradeObjectives(tx, attempt.id);
	}
}

/// The result of every attempt at `exam`, with all feedback as the instructor sees it.
async function attemptResults(
	tx: PrismaTx,
	exam: DbExam,
): Promise<ExamResult[]> {
	const attempts = await tx.response.findMany({
		where: { examId: exam.id, ...realAttempt },
		select: {
			publicId: true,
			submissions: {
				select: {
					publicId: true,
					createdAt: true,
					kind: true,
					status: true,
					question: { select: { slug: true } },
					feedbacks: {
						select: { score: true, feedback: true, updatedAt: true },
					},
				},
			},
		},
	});
	const weights = (await loadWeights(tx, [exam])).get(exam.id) ?? [];
	const slugs = exam.questionsForExams.map((q, i) => ({
		slug: q.questionRef.slug,
		weight: weights[i] ?? 1,
	}));
	const policy = (await loadResultPolicy(exam.courseId, tx))(exam);
	const sanctions = sanctionsByResponse(
		await activeAdjustmentsOf(exam.courseId, [exam.id], tx),
	);
	return attempts.map(({ publicId, submissions }) =>
		examResult(
			slugs,
			submissions.map((s) => ({ ...s, question: s.question.slug })),
			submissions.flatMap((s) =>
				s.feedbacks.map((f) => ({ ...f, submission: s.publicId })),
			),
			sanctions.get(publicId) ?? [],
			policy,
		),
	);
}

/** The `where` matching whichever of the primary keys `filter` carries. */
function examWhere(filter: ExamPK): Prisma.ExamWhereInput {
	if ("id" in filter) return { id: filter.id };

	return {
		slug: filter.slug,
		course:
			typeof filter.course === "number"
				? { id: filter.course }
				: {
						disciplineSlug: filter.course.discipline,
						instructorId: filter.course.instructor,
						editionSlug: filter.course.edition,
					},
	};
}

/**
 * Finds the exam a write targets, refusing an actor who may not write to its course.
 *
 * A draft or archived exam is `NotFound` for a non-author, as on reads.
 */
async function writableExam(
	tx: PrismaTx,
	filter: ExamPK,
	opts: ServiceOpts,
	action: "exam.update" | "exam.delete",
) {
	const exam = await tx.exam.findFirst({
		where: examWhere(filter),
		select: {
			id: true,
			courseId: true,
			status: true,
			course: examInclude().course,
		},
	});
	if (!exam) return missingExam(tx, filter, opts.expectedUpdatedAt);

	requireAccess(examAccess(opts.actor, exam), "write", action, opts);
	return exam;
}

/**
 * Throws for an exam that does not exist: a 412 with no current version when
 * the caller expected one, a `NotFound` otherwise or when its course is missing.
 *
 * @throws {@link PreconditionFailed} If a `Date` was expected.
 * @throws {@link NotFound} If the exam or its course does not exist.
 */
async function missingExam(
	tx: PrismaTx,
	filter: ExamPK,
	expected: Date | null | undefined,
): Promise<never> {
	if (expected !== undefined) {
		if ("course" in filter) {
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
	throw new NotFound("exam");
}

/**
 * Resolves the question slugs of an exam into the rows of its join table.
 *
 * @throws {@link InvalidData}
 * If a slug has no question in `courseId`.
 */
async function resolveQuestions(
	tx: PrismaTx,
	courseId: number,
	questions: ExamCreate["questions"],
): Promise<
	{ questionRefId: number; version: string | null; position: number }[]
> {
	if (!questions?.length) return [];

	const slugs = questions.map((q) => q.slug);
	const rows = await tx.questionRef.findMany({
		where: { courseId, slug: { in: slugs } },
		select: { id: true, slug: true },
	});

	const bySlug = new Map(rows.map((r) => [r.slug, r.id]));
	const missing = slugs.filter((slug) => !bySlug.has(slug));
	if (missing.length > 0) {
		throw new InvalidData({
			questions: missing.map((slug) => ({
				code: "not-exists",
				message: m.errors_exam_question_missing({ slug }),
			})),
		});
	}

	return questions.map((q, position) => ({
		// Checked above: every slug resolved.
		questionRefId: bySlug.get(q.slug) as number,
		version: q.version ?? null,
		position,
	}));
}

/// `questions` as they are written to a frozen exam: a question that stays keeps its pin and the version sent is ignored, a new one is pinned to its latest version. An exam that is not frozen takes `questions` as they are.
async function keepPins(
	tx: PrismaTx,
	examId: ExamId,
	questions: Awaited<ReturnType<typeof resolveQuestions>>,
): ReturnType<typeof resolveQuestions> {
	const exam = await tx.exam.findUniqueOrThrow({
		where: { id: examId },
		select: { type: true, questionsFrozenAt: true },
	});
	if (exam.type === "PRACTICE" || !exam.questionsFrozenAt) return questions;

	const current = new Map(
		(
			await tx.questionsForExam.findMany({
				where: { examId },
				select: { questionRefId: true, version: true },
			})
		).map((row) => [row.questionRefId, row.version]),
	);
	const latest = await latestVersions(
		tx,
		questions.map((q) => q.questionRefId).filter((id) => !current.has(id)),
	);
	return questions.map((q) => ({
		...q,
		version: current.has(q.questionRefId)
			? (current.get(q.questionRefId) ?? null)
			: (latest.get(q.questionRefId) ?? null),
	}));
}

/** One of the four fixed groups the student exam list renders, empty groups omitted. */
export interface ExamGroup {
	key: "open" | "practice" | "upcoming" | "past";
	label: string;
	exams: Exam[];
}

/** Whether `exam` belongs to the group `key`, per the spec's status/type table. */
function belongsTo(key: ExamGroup["key"], exam: Exam, now: Date): boolean {
	const phase = examPhase(exam, now);
	switch (key) {
		case "open":
			return phase === "open" && exam.type !== "PRACTICE";
		case "practice":
			return exam.type === "PRACTICE" && phase !== "closed";
		case "upcoming":
			return phase === "upcoming" && exam.type !== "PRACTICE";
		case "past":
			return phase === "closed";
	}
}

/** Orders entries within a group by their personal timing, unscheduled exams sorted last. */
function sortGroup<T extends { personal: Exam }>(
	key: ExamGroup["key"],
	entries: T[],
): T[] {
	if (key === "practice") {
		return [...entries].sort((a, b) =>
			a.personal.title.localeCompare(b.personal.title),
		);
	}

	const dirMul = key === "past" ? -1 : 1;
	return [...entries].sort((a, b) => {
		const [x, y] = [a.personal.scheduledAt, b.personal.scheduledAt];
		if (x === null && y === null) return 0;
		if (x === null) return 1;
		if (y === null) return -1;
		return dirMul * (x.getTime() - y.getTime());
	});
}

/** Display order and label for each `ExamGroup` key — never authored, see the spec. */
const GROUP_ORDER: { key: ExamGroup["key"]; label: string }[] = [
	{ key: "open", label: m.exams_group_open() },
	{ key: "practice", label: m.exams_group_practice() },
	{ key: "upcoming", label: m.exams_group_upcoming() },
	{ key: "past", label: m.exams_group_past() },
];

/**
 * Groups exams into the four fixed sections the student exam list renders.
 *
 * Section order fixed (Open, Practice, Upcoming, Past exams and grades), each
 * ordered per the spec's table, empty sections absent. `DRAFT` and `ARCHIVED`
 * exams are dropped here too, not just by the service that narrows what an
 * actor may see, so a draft cannot leak into a student-shaped section if this
 * function is ever reused. Exported as a pure function so the grouping/
 * ordering is unit-testable independent of the database.
 *
 * Membership follows {@link examPhase} at `now`, not the stored status alone:
 * a `SCHEDULED` exam whose window has passed is in "Past", one inside its
 * window is in "Open".
 *
 * With `exceptions` (the viewing student's own, by exam slug), membership and
 * order follow `viewerTiming(exam, exception)`, while the groups still hold
 * the exams themselves.
 */
export function groupExamsForStudent(
	exams: Exam[],
	now: Date = new Date(),
	exceptions: ReadonlyMap<string, ExceptionTiming> = new Map(),
): ExamGroup[] {
	const visible = exams
		.filter((exam) => !hiddenFromStudents(exam.status))
		.map((exam) => ({
			exam,
			personal: viewerTiming(exam, exceptions.get(exam.slug)),
		}));

	const groups: ExamGroup[] = [];
	for (const { key, label } of GROUP_ORDER) {
		const inGroup = sortGroup(
			key,
			visible.filter(({ personal }) => belongsTo(key, personal, now)),
		);
		if (inGroup.length > 0) {
			groups.push({ key, label, exams: inGroup.map(({ exam }) => exam) });
		}
	}
	return groups;
}

/// What a reader of an exam sees of its contents: all of it with attachment `origin` and `files`, the attachment list without `origin`, or none of the attachments, the preamble and the questions.
type AttachmentView = "full" | "public" | "hidden";

/// A downloaded attachment: its bytes, its mime type and the name the author gave it.
type DownloadedAttachment = {
	bytes: Buffer;
	mimeType: string;
	filename: string;
};

/// What an exam write says about its attachments, once every rule on them holds.
type PreparedAttachments = { list: Attachment[]; files: AttachmentFiles };

/**
 * The attachment view of `actor` for each of `rows`, keyed by exam id.
 *
 * Whoever writes the course's contents sees everything. A student sees the
 * attachments, the preamble and the questions from the moment the exam opens
 * for them, which their own exception may postpone or bring forward.
 */
async function attachmentViews(
	tx: PrismaTx,
	rows: DbExam[],
	actor: Actor,
): Promise<Map<number, AttachmentView>> {
	const views = new Map<number, AttachmentView>();
	const students: DbExam[] = [];
	for (const row of rows) {
		if (hasPerm(actor, "course.update-contents", row.course)) {
			views.set(row.id, "full");
		} else {
			students.push(row);
		}
	}
	if (students.length === 0 || actor === SYSTEM) return views;

	const exceptions = await tx.examException.findMany({
		where: {
			examId: { in: students.map((row) => row.id) },
			username: actor.username,
		},
		select: { examId: true, extraTimeMs: true, scheduledAt: true },
	});
	const byExam = new Map(exceptions.map((e) => [e.examId, e]));
	const now = new Date();
	for (const row of students) {
		const exception = byExam.get(row.id);
		const open = attachmentsOpen(
			fromDb(row, "hidden", []),
			exception
				? {
						extraTime: fromMs(exception.extraTimeMs),
						scheduledAt: exception.scheduledAt,
					}
				: null,
			now,
		);
		views.set(row.id, open ? "public" : "hidden");
	}
	return views;
}

/// The ids of the `rows` whose questions `actor` reads: all of them for whoever writes the course's contents, the exams the student holds a grant on otherwise.
async function questionsShown(
	tx: PrismaTx,
	rows: DbExam[],
	views: Map<number, AttachmentView>,
	actor: Actor,
): Promise<Set<number>> {
	const shown = new Set<number>();
	const students: DbExam[] = [];
	for (const row of rows) {
		if (views.get(row.id) === "full") shown.add(row.id);
		else students.push(row);
	}
	if (students.length === 0) return shown;
	const granted = await grantViews(
		tx,
		students.map((row) => row.id as ExamId),
		actor,
	);
	for (const [id, view] of granted) if (view) shown.add(id);
	return shown;
}

/**
 * The exam `filter` addresses, once `actor` may download its attachments.
 *
 * @throws {@link NotFound} If the exam does not exist or the actor may not download from it yet.
 */
async function downloadableExam(
	tx: PrismaTx,
	filter: ExamPK,
	actor: Actor,
): Promise<DbExam> {
	const row = await tx.exam.findFirst({
		where: examWhere(filter),
		include: examInclude(),
	});
	const access = row && examAccess(actor, row);
	if (!row || (access !== "write" && access !== "read")) {
		throw new NotFound("attachment");
	}
	const views = await attachmentViews(tx, [row], actor);
	if (views.get(row.id) === "hidden") throw new NotFound("attachment");
	return row;
}

/// The `weight` a question document's public payload carries, 1 when it has none or it is negative or not finite.
function payloadWeight(payload: Prisma.JsonValue | undefined): number {
	const weight = (payload as { weight?: unknown } | null | undefined)?.weight;
	return typeof weight === "number" && Number.isFinite(weight) && weight >= 0
		? weight
		: 1;
}

/**
 * The weight of each question of each exam in `rows`, in exam order, by exam id.
 *
 * It is the `weight` of the version the exam pins, or of the question's
 * latest version when it pins none. One query serves all the rows.
 */
async function loadWeights(
	tx: PrismaTx,
	rows: readonly DbExam[],
): Promise<Map<number, number[]>> {
	const questions = rows.flatMap((row) => row.questionsForExams);
	if (questions.length === 0) return new Map();

	const versions = await unsafePinnedDocuments(
		tx,
		questions.map((q) => ({
			id: q.questionRef.id,
			latestId: q.questionRef.latestId,
			version: q.version,
		})),
		{ publicPayload: true },
	);
	let next = 0;
	return new Map(
		rows.map((row) => [
			row.id,
			row.questionsForExams.map(() =>
				payloadWeight(versions[next++]?.publicPayload),
			),
		]),
	);
}

/**
 * What the write says about the exam's attachments, or `undefined` when it
 * leaves them alone.
 *
 * `attachments` without `files` holds `files: {}`; `files` without
 * `attachments` is refused, and nothing is inherited. Each link needs a hash
 * that is a live blob or arrives in `blobs`.
 *
 * @throws {@link InvalidData}
 * @throws {@link NotFound} If a hash is neither stored nor sent.
 */
async function prepareAttachments(
	tx: PrismaTx,
	deps: Deps,
	fields: Pick<ExamWriteCreate, "attachments" | "files" | "blobs">,
	opts: ServiceOptsWithoutTx,
): Promise<PreparedAttachments | undefined> {
	const { attachments, files: given } = fields;
	if (attachments === undefined) {
		if (given === undefined) return undefined;
		throw new InvalidData(
			{
				files: [
					{ code: "invalid", message: "`files` needs the `attachments` list." },
				],
			},
			{ message: "`files` needs the `attachments` list." },
		);
	}

	assertAttachmentRules(attachments);
	assertFencedWithinLimit({ attachments }, "attachments");
	const files = resolveFiles({ attachments }, given ?? {}, null);
	const blobs = fields.blobs ?? {};
	assertBlobsMatch(blobs, files);

	await deps.attachments.assertBlobsAvailable(files, blobs, {
		tx,
		actor: opts.actor,
	});
	return { list: attachments, files };
}

/// The columns of an exam write that carries `prepared`: `DbNull` for an empty list or map, so create and update store the same.
function attachmentColumns(prepared: PreparedAttachments) {
	return {
		attachments:
			prepared.list.length > 0
				? (prepared.list as Prisma.InputJsonValue)
				: DbNull,
		files: filesColumn(prepared.files) ?? DbNull,
	};
}

/**
 * Refuses a list of attachments that breaks the mdq rules beyond its schema.
 *
 * @throws {@link InvalidData}
 */
function assertAttachmentRules(attachments: Attachment[]): void {
	const problems = attachmentProblems(attachments);
	if (problems.length === 0) return;
	throw new InvalidData(
		{
			attachments: problems.map((p) => ({
				code: "invalid",
				message: p.message,
			})),
		},
		{ message: problems.map((p) => `${p.code}: ${p.message}`).join("; ") },
	);
}

/// `attachments` without the `origin` a student must not see, which is also where the sha256 of a link would be derived from.
function publicAttachments(list: Attachment[]) {
	return list.map(({ origin: _origin, ...rest }) => rest);
}

/** Converts a database row into the exam entity, showing its contents as `view` says: a `hidden` view has no attachments and no preamble, and the questions come only with `withQuestions`. */
function fromDb(
	row: DbExam,
	view: AttachmentView,
	weights: readonly number[],
	withQuestions: boolean = view === "full",
): Exam {
	const list = (row.attachments as Attachment[] | null) ?? [];
	const files = row.files as AttachmentFiles | null;
	return {
		id: row.id as ExamId,
		slug: row.slug,
		type: row.type,
		status: row.status,
		title: row.title,
		description: row.description,
		preamble: view === "hidden" ? null : row.preamble,
		format: row.format,
		scheduledAt: row.scheduledAt,
		duration: fromMs(row.durationMs),
		allowCodeRun: row.allowCodeRun,
		answerHistory: row.answerHistory,
		extraTime: fromMs(row.extraTimeMs),
		author: row.authorId,
		gradesReleasedAt: row.gradesReleasedAt,
		questionsFrozenAt: row.questionsFrozenAt,
		rev: row.rev,
		tags: row.examTags.map((t) => t.tag),
		questions: !withQuestions
			? []
			: row.questionsForExams.map((q, i) => ({
					id: q.questionRef.id as Exam["questions"][number]["id"],
					slug: q.questionRef.slug,
					version: q.version,
					weight: weights[i] ?? 1,
				})),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		attachments:
			view === "full" ? list : view === "public" ? publicAttachments(list) : [],
		...(view === "full" && files && { files }),
	};
}
