/**
 * An instructor's sanctions on a student's score: zeroing or reducing one
 * question, or the whole exam, of one attempt.
 *
 * Writes and the full read need the course's instructor (`exam-sanction.*`). The
 * sanctioned student reads their own active sanctions, without the private
 * fields, once the exam has released its grades; before that, and for anyone
 * else, a sanction does not exist.
 */
import { randomBytes } from "node:crypto";
import type { z } from "zod";
import type { Actor, UserActor } from "@/auth/actor";
import { ensurePerm, hasPerm } from "@/auth/permissions";
import { InvalidData, NotAllowed } from "@/core/error";
import type { CourseId } from "@/core/schemas/base";
import type { CourseRef } from "@/core/schemas/course";
import {
	examSanctionCreate,
	examSanctionFilter,
	examSanctionPK,
	examSanctionPublicSchema,
	examSanctionSchema,
	examSanctionUpdate,
} from "@/core/schemas/exam-sanction";
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
export type ExamSanction = z.infer<typeof examSanctionSchema>;
export type ExamSanctionPublic = z.infer<typeof examSanctionPublicSchema>;
/// What a read returns: the whole row to the instructor, the public half to its student.
export type ExamSanctionView = ExamSanction | ExamSanctionPublic;
/// The input of `create`, before the defaults apply.
export type ExamSanctionCreate = Omit<
	z.input<typeof examSanctionCreate>,
	"course"
> & { course: CourseRef };
export type ExamSanctionUpdate = z.input<typeof examSanctionUpdate>;
export type ExamSanctionPK = z.infer<typeof examSanctionPK>;
/// The input of `findMany`, before the defaults apply.
export type ExamSanctionFilter = Omit<
	z.input<typeof examSanctionFilter>,
	"course"
> & { course: CourseRef };

/// The attempt and the question a sanction row is read with.
const sanctionInclude = {
	response: {
		select: {
			publicId: true,
			authorId: true,
			examId: true,
			exam: { select: { slug: true } },
		},
	},
	questionRef: { select: { slug: true } },
} satisfies Prisma.ExamSanctionInclude;

type DbExamSanction = Prisma.ExamSanctionGetPayload<{
	include: typeof sanctionInclude;
}>;

const examSanctionView = examSanctionSchema.or(examSanctionPublicSchema);

/** The service of `client` (the shared client by default). */
export const makeExamSanctionService = defineService()(() => {
	/**
	 * Sanctions each student of `input.usernames` on the exam, or on one of its questions.
	 *
	 * One sanction per student, all or none, in the order of `usernames`. The
	 * sanction hits the attempt, so every student needs a real one (a
	 * simulation does not count) and the exam cannot be a practice one.
	 *
	 * @throws {@link NotFound} If the course or the exam does not exist.
	 * @throws {@link NotAllowed} If `actor` is not the course's instructor.
	 * @throws {@link InvalidData}
	 * Keyed on `exam` for a practice exam, `question` for one the exam does not
	 * have, and `usernames` (`invalid`) for a repeated student or one without a
	 * real attempt, or (`not-unique`) one already sanctioned on the same target.
	 */
	const create = op({
		args: [examSanctionCreate],
		returns: examSanctionSchema.array(),
		run: async (
			tx: PrismaTx,
			input: ExamSanctionCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<ExamSanction[]> => {
			const course = await loadCourse(tx, input.course);
			ensurePerm(opts.actor, "exam-sanction.create", course);
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
						{ code: "invalid", message: m.errors_exam_sanction_practice() },
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
								message: m.errors_exam_sanction_question({
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
				input.usernames,
			);
			const createdBy = (opts.actor as UserActor).username;
			const rows: DbExamSanction[] = [];
			for (const response of responses) {
				rows.push(
					await tx.examSanction.create({
						data: {
							publicId: newPublicId(),
							responseId: response,
							questionRefId,
							factor: input.factor ?? "0",
							reason: input.reason ?? null,
							notes: input.notes ?? null,
							createdById: createdBy,
						},
						include: sanctionInclude,
					}),
				);
			}
			return rows.map(fromDb);
		},
	});

	/**
	 * Finds one sanction.
	 *
	 * The course's instructor gets any, whole. The sanctioned student gets their
	 * own, active and released, as `ExamSanctionPublic`. Anyone else, and the
	 * student before the release, gets `null`, the same answer as for a
	 * sanction that does not exist.
	 *
	 * @throws {@link NotFound} If the course does not exist.
	 */
	const findOne = op({
		transaction: false,
		args: [examSanctionPK],
		returns: examSanctionView.nullable(),
		run: async (
			tx: PrismaTx,
			pk: ExamSanctionPK,
			opts: ServiceOptsWithoutTx,
		): Promise<ExamSanctionView | null> => {
			const course = await loadCourse(tx, pk.course);
			const full = hasPerm(opts.actor, "exam-sanction.read", course);
			if (!full && !(await isReader(tx, opts.actor, course.id))) return null;

			const row = await tx.examSanction.findFirst({
				where: {
					publicId: pk.publicId,
					...(full ? {} : { revokedAt: null }),
					response: {
						exam: { slug: pk.exam, courseId: course.id },
						...(full ? {} : { authorId: (opts.actor as UserActor).username }),
					},
				},
				include: sanctionInclude,
			});
			if (!row) return null;
			if (!full && (await releasedExams(tx, [row])).size === 0) return null;
			return toView(row, full);
		},
	});

	/**
	 * Lists the sanctions of a course, narrowed to one exam or student, in one query, oldest first.
	 *
	 * The course's instructor gets the active ones in full, and the revoked
	 * ones too with `revoked`. A student gets their own active sanctions on the
	 * exams that released their grades, as `ExamSanctionPublic`, whatever
	 * `filter` says.
	 *
	 * @throws {@link NotFound} If the course, or `filter.exam` when given, does not exist.
	 * @throws {@link NotAllowed} If `actor` neither teaches the course nor holds an `ACTIVE` enrollment in it; SYSTEM and BOT keys never read sanctions.
	 */
	const findMany = op({
		transaction: false,
		args: [examSanctionFilter],
		returns: examSanctionView.array(),
		run: async (
			tx: PrismaTx,
			filter: ExamSanctionFilter,
			opts: ServiceOptsWithoutTx,
		): Promise<ExamSanctionView[]> => {
			const course = await loadCourse(tx, filter.course);
			const full = hasPerm(opts.actor, "exam-sanction.read", course);
			if (!full && !(await isReader(tx, opts.actor, course.id))) {
				// A user asking for their own sanctions in a course they are not enrolled in has none.
				const ownOnly =
					typeof opts.actor === "object" &&
					!opts.actor.bot &&
					filter.author === opts.actor.username;
				if (ownOnly) return [];
				throw new NotAllowed("exam-sanction.read");
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
			const rows = await tx.examSanction.findMany({
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
				include: sanctionInclude,
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
	 * Changes `factor`, `reason` or `notes` of an active sanction.
	 *
	 * @throws {@link NotFound} If the course or the sanction does not exist.
	 * @throws {@link NotAllowed} If `actor` is not the course's instructor, or the sanction is revoked (409).
	 */
	const update = op({
		args: [examSanctionPK, examSanctionUpdate],
		returns: examSanctionSchema,
		run: async (
			tx: PrismaTx,
			pk: ExamSanctionPK,
			fields: ExamSanctionUpdate,
			opts: ServiceOptsWithoutTx,
		): Promise<ExamSanction> => {
			const row = await writableRow(tx, pk, opts, "exam-sanction.update");
			return fromDb(
				await guardedUpdate(
					tx,
					"examSanction",
					{ id: row.id },
					{
						...(fields.factor === undefined ? {} : { factor: fields.factor }),
						...(fields.reason === undefined ? {} : { reason: fields.reason }),
						...(fields.notes === undefined ? {} : { notes: fields.notes }),
					},
					opts,
					{ include: sanctionInclude },
				),
			);
		},
	});

	/**
	 * Lifts an active sanction, recording who and when. The row stays as a record.
	 *
	 * @throws {@link NotFound} If the course or the sanction does not exist.
	 * @throws {@link NotAllowed} If `actor` is not the course's instructor, or the sanction is already revoked (409).
	 */
	const revoke = op({
		args: [examSanctionPK],
		returns: examSanctionSchema,
		run: async (
			tx: PrismaTx,
			pk: ExamSanctionPK,
			opts: ServiceOptsWithoutTx,
		): Promise<ExamSanction> => {
			const row = await writableRow(tx, pk, opts, "exam-sanction.revoke");
			return fromDb(
				await guardedUpdate(
					tx,
					"examSanction",
					{ id: row.id },
					{
						revokedAt: new Date(),
						revokedById: (opts.actor as UserActor).username,
					},
					opts,
					{ include: sanctionInclude },
				),
			);
		},
	});

	return { create, findOne, findMany, update, revoke };
});

/** The service, as built by {@link makeExamSanctionService}. */
export type ExamSanctionService = ReturnType<typeof makeExamSanctionService>;

// Private utilities -----------------------------------------------------------

/// A new sanction id, 18 lowercase hex characters.
function newPublicId(): string {
	return randomBytes(9).toString("hex");
}

/// The course as `exam-sanction.*` needs it: its id and instructor.
async function loadCourse(tx: PrismaTx, ref: CourseRef) {
	return valueOrNotFound(
		"course",
		await tx.course.findUnique({
			where: courseRefWhere(ref),
			select: { id: true, instructor: { select: { username: true } } },
		}),
	);
}

/// Whether `actor` may read their own sanctions in the course: a user with an `ACTIVE` enrollment in it, not SYSTEM and not a BOT key.
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

/// Converts a database row into the sanction entity.
function fromDb(row: DbExamSanction): ExamSanction {
	return {
		id: row.id,
		publicId: row.publicId,
		response: row.response.publicId,
		exam: row.response.exam.slug,
		author: row.response.authorId,
		question: row.questionRef?.slug ?? null,
		factor: row.factor,
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
function toView(row: DbExamSanction, full: boolean): ExamSanctionView {
	const entity = fromDb(row);
	if (full) return entity;
	const {
		notes: _notes,
		createdBy: _createdBy,
		revokedBy: _revokedBy,
		...publicPart
	} = entity;
	// Strict, so a field added to the row but not to the public schema fails here instead of leaking.
	return examSanctionPublicSchema.strict().parse(publicPart);
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
 * @throws {@link InvalidData} For a repeated student, one without a real attempt, or one with an active sanction on the target.
 */
async function attemptsOf(
	tx: PrismaTx,
	examId: number,
	questionRefId: number | null,
	usernames: string[],
): Promise<number[]> {
	const repeated = usernames.find((name, i) => usernames.indexOf(name) !== i);
	if (repeated !== undefined) {
		throw usernamesError(
			"invalid",
			m.errors_exam_sanction_duplicate({ username: repeated }),
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
			m.errors_exam_sanction_no_attempt({ username: missing }),
		);
	}
	const active = await tx.examSanction.findMany({
		where: {
			responseId: { in: attempts.map((a) => a.id) },
			questionRefId,
			revokedAt: null,
		},
		select: { response: { select: { authorId: true } } },
	});
	const taken = new Set(active.map((row) => row.response.authorId));
	const conflict = usernames.find((name) => taken.has(name));
	if (conflict !== undefined) {
		throw usernamesError(
			"not-unique",
			m.errors_exam_sanction_exists({ username: conflict }),
		);
	}
	return usernames.map((name) => byAuthor.get(name) as number);
}

/// An `InvalidData` on `usernames`.
function usernamesError(code: "invalid" | "not-unique", message: string) {
	return new InvalidData({ usernames: [{ code, message }] });
}

/**
 * The active sanction `pk` addresses, once `action` is allowed and the caller's version matches.
 *
 * @throws {@link NotAllowed} If `actor` lacks `action`, or the sanction is revoked (409).
 */
async function writableRow(
	tx: PrismaTx,
	pk: ExamSanctionPK,
	opts: ServiceOptsWithoutTx,
	action: "exam-sanction.update" | "exam-sanction.revoke",
) {
	const course = await loadCourse(tx, pk.course);
	ensurePerm(opts.actor, action, course);
	const found = await tx.examSanction.findFirst({
		where: {
			publicId: pk.publicId,
			response: { exam: { slug: pk.exam, courseId: course.id } },
		},
		select: { id: true, revokedAt: true },
	});
	// A missing row is a 412 for a caller that expected one, not a 404.
	if (!found) checkExpectedUpdatedAt(null, opts.expectedUpdatedAt);
	const row = valueOrNotFound("exam sanction", found);
	// Before the rules: a stale caller changes nothing and sees no 409.
	await checkVersion(tx, "examSanction", { id: row.id }, opts);
	if (row.revokedAt !== null) throw new NotAllowed(action, { status: 409 });
	return row;
}
