/**
 * Per-student adjustments to an exam's timing: extra time, a makeup date, or
 * both, at most one per student and exam.
 *
 * Writes need `exam.manage-exceptions` on the exam's course. Reads go to the
 * same holders in full, and to the student an exception belongs to without
 * the instructor's `note`; anyone else does not learn that it exists.
 */
import type { z } from "zod";
import { SYSTEM } from "@/auth/actor";
import { ensurePerm, hasPerm } from "@/auth/permissions";
import { InvalidData, NotAllowed } from "@/core/error";
import {
	type CourseRef,
	type Duration,
	type ExamExceptionId,
	type ExamId,
	examExceptionCreate,
	examExceptionFilter,
	examExceptionPK,
	examExceptionPublicSchema,
	examExceptionSchema,
	examExceptionUpdate,
} from "@/core/schemas";
import {
	CrudBase,
	type ServiceOpts,
	type ServiceOptsWithoutTx,
} from "@/db/base-service";
import { m } from "@/i18n";
import { resultsReleased } from "@/services/exam-state";
import { durationToMinutes } from "@/utils/schedule-time";
import { Validate } from "@/utils/validate";
import type { Prisma, PrismaTx } from "../client";
import {
	courseRefWhere,
	exceptionTimings,
	fromMs,
	invalidIfExists,
	toMs,
	valueOrNotFound,
} from "../utils";
import { examTimingFromDb, examTimingSelect } from "./submission.service";

export type { ExamExceptionId };

//
// Type definitions
//
export type ExamException = z.infer<typeof examExceptionSchema>;
export type ExamExceptionPublic = z.infer<typeof examExceptionPublicSchema>;
/// What a read returns: the whole row to the instructor, the public half to its student.
export type ExamExceptionView = ExamException | ExamExceptionPublic;
export type ExamExceptionCreate = z.infer<typeof examExceptionCreate>;
export type ExamExceptionUpdate = z.infer<typeof examExceptionUpdate>;
export type ExamExceptionPK = z.infer<typeof examExceptionPK>;
export type ExamExceptionFilter = z.infer<typeof examExceptionFilter>;

/// The exam's slug is part of the entity.
const examExceptionInclude = {
	exam: { select: { slug: true } },
} satisfies Prisma.ExamExceptionInclude;

type DbExamException = Prisma.ExamExceptionGetPayload<{
	include: typeof examExceptionInclude;
}>;

/// Converts a database row into the exception entity, a zero extra time reading as `null`.
function fromDb(row: DbExamException): ExamException {
	return {
		id: row.id as ExamExceptionId,
		examId: row.examId as ExamException["examId"],
		exam: row.exam.slug,
		username: row.username,
		extraTime: fromMs(row.extraTimeMs),
		scheduledAt: row.scheduledAt,
		note: row.note,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/// Refuses an exception that breaks the rules of {@link ExamExceptionService.create}.
async function checkRules(
	tx: PrismaTx,
	courseId: number,
	exam: { type: string; durationMs: number | null; released: boolean },
	input: {
		username: string;
		extraTime?: Duration | null;
		scheduledAt?: Date | null;
	},
): Promise<void> {
	if (exam.type === "PRACTICE") {
		throw new InvalidData({
			exam: [{ code: "invalid", message: m.errors_exam_exception_practice() }],
		});
	}
	if (exam.released) {
		throw new InvalidData({
			exam: [{ code: "invalid", message: m.errors_exam_exception_released() }],
		});
	}
	const hasExtra = !!input.extraTime && durationToMinutes(input.extraTime) > 0;
	if (!hasExtra && !input.scheduledAt) {
		throw new InvalidData({
			extraTime: [
				{ code: "invalid", message: m.errors_exam_exception_empty() },
			],
		});
	}
	if (input.scheduledAt && !exam.durationMs) {
		throw new InvalidData({
			scheduledAt: [
				{ code: "invalid", message: m.errors_exam_exception_untimed() },
			],
		});
	}
	const enrollment = await tx.enrollment.findFirst({
		where: {
			courseId,
			username: input.username,
		},
		select: { id: true },
	});
	if (!enrollment) {
		throw new InvalidData({
			username: [
				{
					code: "not-exists",
					message: m.errors_exam_exception_not_enrolled({
						username: input.username,
					}),
				},
			],
		});
	}
}

const examExceptionView = examExceptionSchema.or(examExceptionPublicSchema);

export class ExamExceptionService extends CrudBase<{
	entity: ExamExceptionView;
	pkFilter: ExamExceptionPK;
	create: ExamExceptionCreate;
	filter: ExamExceptionFilter;
	update: ExamExceptionUpdate;
}> {
	// Only holders of `exam.manage-exceptions` write, so a write always returns
	// the whole row. The logic and its docs live in the `*Tx` methods.
	override create<Opt extends ServiceOpts>(
		input: ExamExceptionCreate,
		opts: Opt,
	): Promise<ExamException> {
		return super.create(input, opts) as Promise<ExamException>;
	}

	override update<Opt extends ServiceOpts>(
		filter: ExamExceptionPK,
		fields: ExamExceptionUpdate,
		opts: Opt,
	): Promise<ExamException> {
		return super.update(filter, fields, opts) as Promise<ExamException>;
	}

	override upsert<Opt extends ServiceOpts>(
		input: ExamExceptionCreate,
		opts: Opt,
	): Promise<ExamException> {
		return super.upsert(input, opts) as Promise<ExamException>;
	}

	/**
	 * Creates the exception of `input.username` on `input.exam`.
	 *
	 * The exam must be a `QUIZ` or an `EXAM`, a `scheduledAt` needs an exam
	 * with a duration, the student must hold an enrollment in the course
	 * (active or dropped), and the exception must grant extra time or a new
	 * date.
	 *
	 * @throws {@link NotFound} If the course or the exam does not exist.
	 * @throws {@link NotAllowed} If `actor` lacks `exam.manage-exceptions` on the course.
	 * @throws {@link InvalidData}
	 * If a rule above fails (keyed on `exam`, `scheduledAt`, `username` or
	 * `extraTime`), or the student already has an exception on this exam.
	 */
	@Validate({
		service: true,
		returns: examExceptionSchema,
		args: [undefined, examExceptionCreate],
	})
	protected async createTx(
		tx: PrismaTx,
		input: ExamExceptionCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<ExamException> {
		const { course, exam } = await this.load(tx, input);
		ensurePerm(opts.actor, "exam.manage-exceptions", course);
		await checkRules(tx, course.id, await withRelease(tx, exam, course), input);
		return fromDb(await createRow(tx, exam.id, input));
	}

	/**
	 * Finds the exception of one student on one exam.
	 *
	 * A holder of `exam.manage-exceptions` gets the whole row and the student
	 * it belongs to gets {@link ExamExceptionPublic}. Anyone else gets `null`,
	 * the same answer as for a student with no exception.
	 *
	 * @throws {@link NotFound} If the course or the exam does not exist.
	 */
	@Validate({
		service: true,
		returns: examExceptionView.nullable(),
		args: [undefined, examExceptionPK],
	})
	protected async findOneTx(
		tx: PrismaTx,
		filter: ExamExceptionPK,
		opts: ServiceOptsWithoutTx,
	): Promise<ExamExceptionView | null> {
		const { course, exam } = await this.load(tx, filter);
		const full = hasPerm(opts.actor, "exam.manage-exceptions", course);
		if (!full && !isSelf(opts.actor, filter.username)) return null;

		const row = await tx.examException.findUnique({
			where: {
				examId_username: { examId: exam.id, username: filter.username },
			},
			include: examExceptionInclude,
		});
		return row ? toView(row, full) : null;
	}

	/**
	 * Lists the exceptions of a course, optionally narrowed to one exam or one student, in one query.
	 *
	 * A holder of `exam.manage-exceptions` gets every matching row in full. A
	 * student enrolled in the course gets at most their own, as
	 * {@link ExamExceptionPublic}, whatever `filter.username` says. Ordered by
	 * exam slug, then username.
	 *
	 * @throws {@link NotFound} If the course, or `filter.exam` when given, does not exist.
	 * @throws {@link NotAllowed} If `actor` may neither manage exceptions nor read the course's contents.
	 */
	@Validate({
		service: true,
		returns: examExceptionView.array(),
		args: [undefined, examExceptionFilter],
	})
	protected async findManyTx(
		tx: PrismaTx,
		filter: ExamExceptionFilter,
		opts: ServiceOptsWithoutTx,
	): Promise<ExamExceptionView[]> {
		const course = await loadCourse(tx, filter.course);
		const full = hasPerm(opts.actor, "exam.manage-exceptions", course);
		if (!full && !hasPerm(opts.actor, "course.read-contents", course)) {
			throw new NotAllowed("exam.read");
		}
		if (filter.exam !== undefined) {
			valueOrNotFound(
				"exam",
				await tx.exam.findUnique({
					where: { courseId_slug: { courseId: course.id, slug: filter.exam } },
					select: { id: true },
				}),
			);
		}

		const username = full
			? filter.username
			: (opts.actor as { username: string }).username;
		const rows = await tx.examException.findMany({
			where: {
				exam: {
					courseId: course.id,
					...(filter.exam === undefined ? {} : { slug: filter.exam }),
				},
				...(username === undefined ? {} : { username }),
			},
			include: examExceptionInclude,
			orderBy: [{ exam: { slug: "asc" } }, { username: "asc" }],
		});
		return rows.map((row) => toView(row, full));
	}

	/**
	 * Changes `extraTime`, `scheduledAt` or `note` of an existing exception.
	 *
	 * The rules of `create` are checked against the merged result, so an
	 * update that would leave neither extra time nor a new date is refused.
	 *
	 * @throws {@link NotFound} If the course, the exam or the exception does not exist.
	 * @throws {@link NotAllowed} If `actor` lacks `exam.manage-exceptions` on the course.
	 * @throws {@link InvalidData} If the merged exception breaks a rule of `create`.
	 */
	@Validate({
		service: true,
		returns: examExceptionSchema,
		args: [undefined, examExceptionPK, examExceptionUpdate],
	})
	protected async updateTx(
		tx: PrismaTx,
		filter: ExamExceptionPK,
		fields: ExamExceptionUpdate,
		opts: ServiceOptsWithoutTx,
	): Promise<ExamException> {
		const { course, exam } = await this.load(tx, filter);
		ensurePerm(opts.actor, "exam.manage-exceptions", course);
		const existing = valueOrNotFound(
			"exam exception",
			await tx.examException.findUnique({
				where: {
					examId_username: { examId: exam.id, username: filter.username },
				},
			}),
		);

		const merged = mergeFields(existing, fields);
		await checkRules(tx, course.id, await withRelease(tx, exam, course), {
			username: filter.username,
			...merged,
		});
		return fromDb(
			await saveRow(tx, exam.id, { username: filter.username, ...merged }),
		);
	}

	/**
	 * Creates or updates the exception keyed on `(course, exam, username)`.
	 *
	 * PUT semantics: the same permission and rules as `create` on either
	 * branch; fields left `undefined` keep their stored value.
	 *
	 * @throws {@link NotFound} If the course or the exam does not exist.
	 * @throws {@link NotAllowed} If `actor` lacks `exam.manage-exceptions` on the course.
	 * @throws {@link InvalidData} If the resulting exception breaks a rule of `create`.
	 */
	@Validate({
		service: true,
		returns: examExceptionSchema,
		args: [undefined, examExceptionCreate],
	})
	protected async upsertTx(
		tx: PrismaTx,
		input: ExamExceptionCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<ExamException> {
		const { course, exam } = await this.load(tx, input);
		ensurePerm(opts.actor, "exam.manage-exceptions", course);
		const existing = await tx.examException.findUnique({
			where: {
				examId_username: { examId: exam.id, username: input.username },
			},
		});

		const merged = existing ? mergeFields(existing, input) : input;
		await checkRules(tx, course.id, await withRelease(tx, exam, course), {
			username: input.username,
			...merged,
		});
		return fromDb(
			await saveRow(tx, exam.id, { username: input.username, ...merged }),
		);
	}

	/**
	 * Deletes an exception, which is the only way to take one back.
	 *
	 * @throws {@link NotFound} If the course, the exam or the exception does not exist.
	 * @throws {@link NotAllowed} If `actor` lacks `exam.manage-exceptions` on the course.
	 */
	@Validate({ service: true, args: [undefined, examExceptionPK] })
	protected async deleteTx(
		tx: PrismaTx,
		filter: ExamExceptionPK,
		opts: ServiceOptsWithoutTx,
	): Promise<void> {
		const { course, exam } = await this.load(tx, filter);
		ensurePerm(opts.actor, "exam.manage-exceptions", course);
		const existing = valueOrNotFound(
			"exam exception",
			await tx.examException.findUnique({
				where: {
					examId_username: { examId: exam.id, username: filter.username },
				},
				select: { id: true },
			}),
		);
		await tx.examException.delete({ where: { id: existing.id } });
	}

	// Private utilities -------------------------------------------------------

	/// Loads the course and then the exam of `filter`, so a missing course wins over a missing exam.
	private async load(
		tx: PrismaTx,
		filter: Pick<ExamExceptionPK, "course" | "exam">,
	) {
		const course = await loadCourse(tx, filter.course);
		const exam = valueOrNotFound(
			"exam",
			await tx.exam.findUnique({
				where: { courseId_slug: { courseId: course.id, slug: filter.exam } },
				select: {
					id: true,
					...examTimingSelect,
					gradesReleasedAt: true,
					durationMs: true,
				},
			}),
		);
		return { course, exam };
	}
}

/// `exam` plus whether its results are already released, which freezes its exceptions.
async function withRelease<
	E extends Prisma.ExamGetPayload<{
		select: typeof examTimingSelect & { gradesReleasedAt: true };
	}>,
>(
	tx: PrismaTx,
	exam: E & { id: number },
	course: { enrollments: { username: string }[] },
): Promise<E & { released: boolean }> {
	const rows =
		exam.type === "QUIZ"
			? await tx.examException.findMany({
					where: { examId: exam.id as ExamId },
					select: { username: true, extraTimeMs: true, scheduledAt: true },
				})
			: [];
	const released = resultsReleased(
		{ ...examTimingFromDb(exam), gradesReleasedAt: exam.gradesReleasedAt },
		new Date(),
		exceptionTimings(
			rows,
			course.enrollments.map((entry) => entry.username),
		),
	);
	return { ...exam, released };
}

/// The course as the permission predicates need it: its instructor and active enrollments.
async function loadCourse(tx: PrismaTx, ref: CourseRef) {
	return valueOrNotFound(
		"course",
		await tx.course.findUnique({
			where: courseRefWhere(ref),
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
}

/// Whether `actor` is the user `username`.
function isSelf(actor: ServiceOpts["actor"], username: string): boolean {
	return actor !== SYSTEM && actor.username === username;
}

/// The whole row for a manager, or the row without its `note` key for the student it belongs to.
function toView(row: DbExamException, full: boolean): ExamExceptionView {
	const entity = fromDb(row);
	if (full) return entity;
	const { note: _note, ...publicPart } = entity;
	// Strict, so a field added to the row but not to the public schema fails here instead of leaking.
	return examExceptionPublicSchema.strict().parse(publicPart);
}

/// `fields` over the stored row, where a field left `undefined` keeps its stored value.
function mergeFields(
	stored: {
		extraTimeMs: number;
		scheduledAt: Date | null;
		note: string | null;
	},
	fields: {
		extraTime?: Duration | null;
		scheduledAt?: Date | null;
		note?: string | null;
	},
) {
	return {
		extraTime:
			fields.extraTime === undefined
				? fromMs(stored.extraTimeMs)
				: fields.extraTime,
		scheduledAt:
			fields.scheduledAt === undefined
				? stored.scheduledAt
				: fields.scheduledAt,
		note: fields.note === undefined ? stored.note : fields.note,
	};
}

/// The stored form of the optional fields of an exception.
function storedFields(data: {
	extraTime?: Duration | null;
	scheduledAt?: Date | null;
	note?: string | null;
}) {
	return {
		extraTimeMs: toMs(data.extraTime) ?? 0,
		scheduledAt: data.scheduledAt ?? null,
		note: data.note ?? null,
	};
}

/// Inserts the exception of `data.username` on `examId`, refusing a second one.
function createRow(
	tx: PrismaTx,
	examId: ExamId,
	data: Parameters<typeof storedFields>[0] & { username: string },
): Promise<DbExamException> {
	return invalidIfExists(tx.examException.create.bind(tx.examException), {
		data: { examId, username: data.username, ...storedFields(data) },
		include: examExceptionInclude,
	});
}

/// Inserts the exception of `data.username` on `examId`, or replaces every field of the existing one.
function saveRow(
	tx: PrismaTx,
	examId: ExamId,
	data: Parameters<typeof storedFields>[0] & { username: string },
): Promise<DbExamException> {
	return invalidIfExists(tx.examException.upsert.bind(tx.examException), {
		where: { examId_username: { examId, username: data.username } },
		create: { examId, username: data.username, ...storedFields(data) },
		update: storedFields(data),
		include: examExceptionInclude,
	});
}
