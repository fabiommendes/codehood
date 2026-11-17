/**
 * An instructor's adjustments of a student's score: replacing, multiplying or
 * adding to the exam total of one attempt, or multiplying one of its questions.
 *
 * Writes and the full read need the course's instructor (`exam-adjustment.*`).
 * The adjusted student reads their own active adjustments, without the
 * private fields, once the exam has released its grades; before that, and for
 * anyone else, an adjustment does not exist.
 *
 * An attempt has at most one active `SET` and, per question, one active
 * adjustment; the exam total takes any number of `FACTOR` and `OFFSET`.
 */
import { randomBytes } from "node:crypto";
import type { z } from "zod";
import type { Actor, UserActor } from "@/auth/actor";
import { ensurePerm, hasPerm } from "@/auth/permissions";
import { InvalidData, NotAllowed } from "@/core/error";
import type { CourseId } from "@/core/schemas/base";
import type { CourseRef } from "@/core/schemas/course";
import {
	adjustmentValueError,
	type ExamAdjustmentOp,
	examAdjustmentCreate,
	examAdjustmentFilter,
	examAdjustmentPK,
	examAdjustmentPublicSchema,
	examAdjustmentSchema,
	examAdjustmentUpdate,
} from "@/core/schemas/exam-adjustment";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import {
	checkExpectedUpdatedAt,
	checkVersion,
	guardedUpdate,
} from "@/db/conditional-write";
import { defineService, op } from "@/db/define-service";
import { m } from "@/i18n";
import type { Prisma, PrismaTx } from "../client";
import { realAttempt } from "../preview-filter";
import { courseRefWhere, valueOrNotFound } from "../utils";
import { examReleaseSelect, releasedToStudents } from "./feedback.service";

//
// Type definitions
//
export type ExamAdjustment = z.infer<typeof examAdjustmentSchema>;
export type ExamAdjustmentPublic = z.infer<typeof examAdjustmentPublicSchema>;
/// What a read returns: the whole row to the instructor, the public half to its student.
export type ExamAdjustmentView = ExamAdjustment | ExamAdjustmentPublic;
/// The input of `create`, before the defaults apply.
export type ExamAdjustmentCreate = Omit<
	z.input<typeof examAdjustmentCreate>,
	"course"
> & { course: CourseRef };
export type ExamAdjustmentUpdate = z.input<typeof examAdjustmentUpdate>;
export type ExamAdjustmentPK = z.infer<typeof examAdjustmentPK>;
/// The input of `findMany`, before the defaults apply.
export type ExamAdjustmentFilter = Omit<
	z.input<typeof examAdjustmentFilter>,
	"course"
> & { course: CourseRef };

/// The attempt and the question an adjustment row is read with.
const adjustmentInclude = {
	response: {
		select: {
			publicId: true,
			authorId: true,
			examId: true,
			exam: { select: { slug: true } },
		},
	},
	questionRef: { select: { slug: true } },
} satisfies Prisma.ExamAdjustmentInclude;

type DbExamAdjustment = Prisma.ExamAdjustmentGetPayload<{
	include: typeof adjustmentInclude;
}>;

const examAdjustmentView = examAdjustmentSchema.or(examAdjustmentPublicSchema);

/** The service of `client` (the shared client by default). */
export const makeExamAdjustmentService = defineService()(() => {
	/**
	 * Adjusts each student of `input.usernames` on the exam, or on one of its questions.
	 *
	 * One adjustment per student, all or none, in the order of `usernames`. The
	 * adjustment hits the attempt, so every student needs a real one (a
	 * simulation does not count) and the exam cannot be a practice one.
	 *
	 * @throws {@link NotFound} If the course or the exam does not exist.
	 * @throws {@link NotAllowed} If `actor` is not the course's instructor.
	 * @throws {@link InvalidData}
	 * Keyed on `exam` for a practice exam, `question` for one the exam does not
	 * have, `op` and `value` for a value the operation refuses, and `usernames`
	 * (`invalid`) for a repeated student or one without a real attempt, or
	 * (`not-unique`) one that already has an active `SET`, or an active
	 * adjustment on the same question.
	 */
	const create = op({
		args: [examAdjustmentCreate],
		returns: examAdjustmentSchema.array(),
		run: async (
			tx: PrismaTx,
			input: ExamAdjustmentCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<ExamAdjustment[]> => {
			const course = await loadCourse(tx, input.course);
			ensurePerm(opts.actor, "exam-adjustment.create", course);
			const exam = valueOrNotFound(
				"exam",
				await tx.exam.findUnique({
					where: { courseId_slug: { courseId: course.id, slug: input.exam } },
					select: { id: true, type: true },
				}),
			);
			if (exam.type === "PRACTICE") {
				throw new InvalidData({
					exam: [
						{ code: "invalid", message: m.errors_exam_adjustment_practice() },
					],
				});
			}

			let questionRefId: number | null = null;
			if (input.question !== undefined) {
				const pinned = await tx.questionsForExam.findFirst({
					where: {
						examId: exam.id,
						questionRef: { slug: input.question, courseId: course.id },
					},
					select: { questionRefId: true },
				});
				if (!pinned) {
					throw new InvalidData({
						question: [
							{
								code: "invalid",
								message: m.errors_exam_adjustment_question({
									question: input.question,
								}),
							},
						],
					});
				}
				questionRefId = pinned.questionRefId;
			}

			const responses = await attemptsOf(
				tx,
				exam.id,
				questionRefId,
				input.op,
				input.usernames,
			);
			const createdBy = (opts.actor as UserActor).username;
			const rows: DbExamAdjustment[] = [];
			for (const response of responses) {
				rows.push(
					await tx.examAdjustment.create({
						data: {
							publicId: newPublicId(),
							responseId: response,
							questionRefId,
							op: input.op,
							value: input.value,
							reason: input.reason ?? null,
							notes: input.notes ?? null,
							createdById: createdBy,
						},
						include: adjustmentInclude,
					}),
				);
			}
			return rows.map(fromDb);
		},
	});

	/**
	 * Finds one adjustment.
	 *
	 * The course's instructor gets any, whole. The adjusted student gets their
	 * own, active and released, as `ExamAdjustmentPublic`. Anyone else, and the
	 * student before the release, gets `null`, the same answer as for an
	 * adjustment that does not exist.
	 *
	 * @throws {@link NotFound} If the course does not exist.
	 */
	const findOne = op({
		transaction: false,
		args: [examAdjustmentPK],
		returns: examAdjustmentView.nullable(),
		run: async (
			tx: PrismaTx,
			pk: ExamAdjustmentPK,
			opts: ServiceOptsWithoutTx,
		): Promise<ExamAdjustmentView | null> => {
			const course = await loadCourse(tx, pk.course);
			const full = hasPerm(opts.actor, "exam-adjustment.read", course);
			if (!full && !(await isReader(tx, opts.actor, course.id))) return null;

			const row = await tx.examAdjustment.findFirst({
				where: {
					publicId: pk.publicId,
					...(full ? {} : { revokedAt: null }),
					response: {
						exam: { slug: pk.exam, courseId: course.id },
						...(full ? {} : { authorId: (opts.actor as UserActor).username }),
					},
				},
				include: adjustmentInclude,
			});
			if (!row) return null;
			if (!full && (await releasedExams(tx, [row])).size === 0) return null;
			return toView(row, full);
		},
	});

	/**
	 * Lists the adjustments of a course, narrowed to one exam or student, in one query, oldest first.
	 *
	 * The course's instructor gets the active ones in full, and the revoked
	 * ones too with `revoked`. A student gets their own active adjustments on the
	 * exams that released their grades, as `ExamAdjustmentPublic`, whatever
	 * `filter` says.
	 *
	 * @throws {@link NotFound} If the course, or `filter.exam` when given, does not exist.
	 * @throws {@link NotAllowed} If `actor` neither teaches the course nor holds an `ACTIVE` enrollment in it; SYSTEM and BOT keys never read adjustments.
	 */
	const findMany = op({
		transaction: false,
		args: [examAdjustmentFilter],
		returns: examAdjustmentView.array(),
		run: async (
			tx: PrismaTx,
			filter: ExamAdjustmentFilter,
			opts: ServiceOptsWithoutTx,
		): Promise<ExamAdjustmentView[]> => {
			const course = await loadCourse(tx, filter.course);
			const full = hasPerm(opts.actor, "exam-adjustment.read", course);
			if (!full && !(await isReader(tx, opts.actor, course.id))) {
				// A user asking for their own adjustments in a course they are not enrolled in has none.
				const ownOnly =
					typeof opts.actor === "object" &&
					!opts.actor.bot &&
					filter.author === opts.actor.username;
				if (ownOnly) return [];
				throw new NotAllowed("exam-adjustment.read");
			}
			// Only staff learn whether the exam exists: a student could otherwise probe draft slugs.
			if (full && filter.exam !== undefined) {
				valueOrNotFound(
					"exam",
					await tx.exam.findUnique({
						where: {
							courseId_slug: { courseId: course.id, slug: filter.exam },
						},
						select: { id: true },
					}),
				);
			}

			const own = full ? undefined : (opts.actor as UserActor).username;
			if (own !== undefined && filter.author !== undefined) {
				if (filter.author !== own) return [];
			}
			const author = own ?? filter.author;
			const rows = await tx.examAdjustment.findMany({
				where: {
					...(full && filter.revoked ? {} : { revokedAt: null }),
					response: {
						exam: {
							courseId: course.id,
							...(filter.exam === undefined ? {} : { slug: filter.exam }),
						},
						...(author === undefined ? {} : { authorId: author }),
					},
				},
				include: adjustmentInclude,
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			});
			if (full) return rows.map((row) => toView(row, true));
			const open = await releasedExams(tx, rows);
			return rows
				.filter((row) => open.has(row.response.examId))
				.map((row) => toView(row, false));
		},
	});

	/**
	 * Changes `op`, `value`, `reason` or `notes` of an active adjustment.
	 *
	 * The result must still satisfy the rules of `create` for the row's target.
	 *
	 * @throws {@link NotFound} If the course or the adjustment does not exist.
	 * @throws {@link NotAllowed} If `actor` is not the course's instructor, or the adjustment is revoked (409).
	 * @throws {@link InvalidData} Keyed on `op` or `value` for a combination the rules refuse, or for a second active `SET` on the attempt (`not-unique`).
	 */
	const update = op({
		args: [examAdjustmentPK, examAdjustmentUpdate],
		returns: examAdjustmentSchema,
		run: async (
			tx: PrismaTx,
			pk: ExamAdjustmentPK,
			fields: ExamAdjustmentUpdate,
			opts: ServiceOptsWithoutTx,
		): Promise<ExamAdjustment> => {
			const row = await writableRow(tx, pk, opts, "exam-adjustment.update");
			await checkUpdate(tx, row, fields);
			return fromDb(
				await guardedUpdate(
					tx,
					"examAdjustment",
					{ id: row.id },
					{
						...(fields.op === undefined ? {} : { op: fields.op }),
						...(fields.value === undefined ? {} : { value: fields.value }),
						...(fields.reason === undefined ? {} : { reason: fields.reason }),
						...(fields.notes === undefined ? {} : { notes: fields.notes }),
					},
					opts,
					{ include: adjustmentInclude },
				),
			);
		},
	});

	/**
	 * Lifts an active adjustment, recording who and when. The row stays as a record.
	 *
	 * @throws {@link NotFound} If the course or the adjustment does not exist.
	 * @throws {@link NotAllowed} If `actor` is not the course's instructor, or the adjustment is already revoked (409).
	 */
	const revoke = op({
		args: [examAdjustmentPK],
		returns: examAdjustmentSchema,
		run: async (
			tx: PrismaTx,
			pk: ExamAdjustmentPK,
			opts: ServiceOptsWithoutTx,
		): Promise<ExamAdjustment> => {
			const row = await writableRow(tx, pk, opts, "exam-adjustment.revoke");
			return fromDb(
				await guardedUpdate(
					tx,
					"examAdjustment",
					{ id: row.id },
					{
						revokedAt: new Date(),
						revokedById: (opts.actor as UserActor).username,
					},
					opts,
					{ include: adjustmentInclude },
				),
			);
		},
	});

	return { create, findOne, findMany, update, revoke };
});

/** The service, as built by {@link makeExamAdjustmentService}. */
export type ExamAdjustmentService = ReturnType<
	typeof makeExamAdjustmentService
>;

// Private utilities -----------------------------------------------------------

/// A new adjustment id, 18 lowercase hex characters.
function newPublicId(): string {
	return randomBytes(9).toString("hex");
}

/// The course as `exam-adjustment.*` needs it: its id and instructor.
async function loadCourse(tx: PrismaTx, ref: CourseRef) {
	return valueOrNotFound(
		"course",
		await tx.course.findUnique({
			where: courseRefWhere(ref),
			select: { id: true, instructor: { select: { username: true } } },
		}),
	);
}

/// Whether `actor` may read their own adjustments in the course: a user with an `ACTIVE` enrollment in it, not SYSTEM and not a BOT key.
async function isReader(
	tx: PrismaTx,
	actor: Actor,
	courseId: CourseId,
): Promise<boolean> {
	if (typeof actor !== "object" || actor.bot) return false;
	const enrollment = await tx.enrollment.findUnique({
		where: { username_courseId: { username: actor.username, courseId } },
		select: { status: true },
	});
	return enrollment?.status === "ACTIVE";
}

/// Converts a database row into the adjustment entity.
function fromDb(row: DbExamAdjustment): ExamAdjustment {
	return {
		id: row.id,
		publicId: row.publicId,
		response: row.response.publicId,
		exam: row.response.exam.slug,
		author: row.response.authorId,
		question: row.questionRef?.slug ?? null,
		op: row.op,
		value: row.value,
		reason: row.reason,
		notes: row.notes,
		createdBy: row.createdById,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		revokedAt: row.revokedAt,
		revokedBy: row.revokedById,
	};
}

/// The whole row for the instructor, or the row without its private keys for the student.
function toView(row: DbExamAdjustment, full: boolean): ExamAdjustmentView {
	const entity = fromDb(row);
	if (full) return entity;
	const {
		notes: _notes,
		createdBy: _createdBy,
		revokedBy: _revokedBy,
		...publicPart
	} = entity;
	// Strict, so a field added to the row but not to the public schema fails here instead of leaking.
	return examAdjustmentPublicSchema.strict().parse(publicPart);
}

/// The ids of the exams of `rows` that have released their grades to their students, in one query.
async function releasedExams(
	tx: PrismaTx,
	rows: { response: { examId: number } }[],
): Promise<Set<number>> {
	const ids = [...new Set(rows.map((row) => row.response.examId))];
	if (ids.length === 0) return new Set();
	const exams = await tx.exam.findMany({
		where: { id: { in: ids } },
		select: { id: true, ...examReleaseSelect() },
	});
	const now = new Date();
	return new Set(
		exams.filter((exam) => releasedToStudents(exam, now)).map((e) => e.id),
	);
}

/**
 * The ids of the real attempts of `usernames` at the exam, in the order of `usernames`.
 *
 * @throws {@link InvalidData} For a repeated student, one without a real attempt, or one that already has an active `SET` (when `op` is `SET`) or an active adjustment on the question.
 */
async function attemptsOf(
	tx: PrismaTx,
	examId: number,
	questionRefId: number | null,
	op: ExamAdjustmentOp,
	usernames: string[],
): Promise<number[]> {
	const repeated = usernames.find((name, i) => usernames.indexOf(name) !== i);
	if (repeated !== undefined) {
		throw usernamesError(
			"invalid",
			m.errors_exam_adjustment_duplicate({ username: repeated }),
		);
	}
	const attempts = await tx.response.findMany({
		where: { examId, authorId: { in: usernames }, ...realAttempt },
		select: { id: true, authorId: true },
	});
	const byAuthor = new Map(attempts.map((a) => [a.authorId, a.id]));
	const missing = usernames.find((name) => !byAuthor.has(name));
	if (missing !== undefined) {
		throw usernamesError(
			"invalid",
			m.errors_exam_adjustment_no_attempt({ username: missing }),
		);
	}
	// The exam total takes any number of FACTOR and OFFSET, but one SET.
	if (questionRefId !== null || op === "SET") {
		const active = await tx.examAdjustment.findMany({
			where: {
				responseId: { in: attempts.map((a) => a.id) },
				questionRefId,
				...(questionRefId === null ? { op: "SET" as const } : {}),
				revokedAt: null,
			},
			select: { response: { select: { authorId: true } } },
		});
		const taken = new Set(active.map((row) => row.response.authorId));
		const conflict = usernames.find((name) => taken.has(name));
		if (conflict !== undefined) {
			throw usernamesError(
				"not-unique",
				questionRefId === null
					? m.errors_exam_adjustment_set_exists({ username: conflict })
					: m.errors_exam_adjustment_exists({ username: conflict }),
			);
		}
	}
	return usernames.map((name) => byAuthor.get(name) as number);
}

/// An `InvalidData` on `usernames`.
function usernamesError(code: "invalid" | "not-unique", message: string) {
	return new InvalidData({ usernames: [{ code, message }] });
}

/**
 * The active adjustment `pk` addresses, once `action` is allowed and the caller's version matches.
 *
 * @throws {@link NotAllowed} If `actor` lacks `action`, or the adjustment is revoked (409).
 */
async function writableRow(
	tx: PrismaTx,
	pk: ExamAdjustmentPK,
	opts: ServiceOptsWithoutTx,
	action: "exam-adjustment.update" | "exam-adjustment.revoke",
) {
	const course = await loadCourse(tx, pk.course);
	ensurePerm(opts.actor, action, course);
	const found = await tx.examAdjustment.findFirst({
		where: {
			publicId: pk.publicId,
			response: { exam: { slug: pk.exam, courseId: course.id } },
		},
		select: {
			id: true,
			revokedAt: true,
			responseId: true,
			questionRefId: true,
			op: true,
			value: true,
		},
	});
	// A missing row is a 412 for a caller that expected one, not a 404.
	if (!found) checkExpectedUpdatedAt(null, opts.expectedUpdatedAt);
	const row = valueOrNotFound("exam adjustment", found);
	// Before the rules: a stale caller changes nothing and sees no 409.
	await checkVersion(tx, "examAdjustment", { id: row.id }, opts);
	if (row.revokedAt !== null) throw new NotAllowed(action, { status: 409 });
	return row;
}

/**
 * Checks the row `fields` would leave behind against the rules of `create`.
 *
 * @throws {@link InvalidData} Keyed on `op` or `value` for a combination the rules refuse, or on `op` (`not-unique`) when the row would become a second active `SET` of its attempt.
 */
async function checkUpdate(
	tx: PrismaTx,
	row: {
		id: number;
		responseId: number;
		questionRefId: number | null;
		op: ExamAdjustmentOp;
		value: string;
	},
	fields: ExamAdjustmentUpdate,
): Promise<void> {
	const op = fields.op ?? row.op;
	const value = fields.value ?? row.value;
	const error = adjustmentValueError(op, value, row.questionRefId !== null);
	if (error) {
		throw new InvalidData({
			[error.field]: [{ code: "invalid", message: error.message }],
		});
	}
	if (op === "SET" && row.op !== "SET") {
		const other = await tx.examAdjustment.findFirst({
			where: {
				responseId: row.responseId,
				questionRefId: null,
				op: "SET",
				revokedAt: null,
				id: { not: row.id },
			},
			select: { id: true },
		});
		if (other) {
			throw new InvalidData({
				op: [
					{
						code: "not-unique",
						message: m.errors_exam_adjustment_set_exists({ username: "" }),
					},
				],
			});
		}
	}
}
