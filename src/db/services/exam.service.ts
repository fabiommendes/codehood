/**
 * Exams and the questions they are assembled from.
 *
 * An exam lives in exactly one course, so writes are ownership-gated
 * (`course.update-contents`) and reads follow `course.read-contents`, with a
 * `DRAFT` or `ARCHIVED` exam visible to its author alone.
 */
import type { z } from "zod";
import { SYSTEM } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import type { CourseId, ExamId } from "@/core/schemas";
import {
	courseExamSchema,
	examCreate,
	examFilter,
	examFilterByCourses,
	examPK,
	examSchema,
	examUpdate,
} from "@/core/schemas";
import {
	CrudBase,
	type ServiceOpts,
	type ServiceOptsWithoutTx,
} from "@/db/base-service";
import { courseContentsWhere } from "@/db/services/course.service";
import { m } from "@/i18n";
import { type ExamResult, examResult } from "@/services/exam-result";
import {
	type ExceptionTiming,
	examPhase,
	type GradeReleaseBlocker,
	gradeReleaseBlocker,
	personalTiming,
} from "@/services/exam-state";
import { Validate } from "@/utils/validate";
import type { Prisma, PrismaTx } from "../client";
import {
	courseRefWhere,
	fromMs,
	invalidIfExists,
	toMs,
	valueOrNotFound,
} from "../utils";

export { examStatus, examType, textFormat } from "@/core/schemas";
export type { ExamId };

//
// Type definitions
//
export type Exam = z.infer<typeof examSchema>;
export type ExamCreate = z.infer<typeof examCreate>;
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
				questionRef: { select: { id: true, slug: true } },
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

export class ExamService extends CrudBase<{
	entity: Exam;
	pkFilter: ExamPK;
	create: ExamCreate;
	filter: ExamFilter;
	update: ExamUpdate;
}> {
	/**
	 * Creates an exam in a course, with its tags and its pinned questions.
	 *
	 * The questions are given by slug and must live in the same course; a slug
	 * that does not resolve there is refused rather than silently dropped.
	 */
	@Validate({
		service: true,
		returns: examSchema,
		args: [undefined, examCreate],
	})
	protected async createTx(
		tx: PrismaTx,
		input: ExamCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<Exam> {
		const course = await this.course(input.course, tx, opts, {
			perm: "course.update-contents",
		});
		const questions = await resolveQuestions(tx, course.id, input.questions);

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
				rev: input.rev,
				authorId:
					opts.actor === SYSTEM
						? course.instructor.username
						: opts.actor.username,
				examTags: { create: (input.tags ?? []).map((tag) => ({ tag })) },
				questionsForExams: { create: questions },
			},
			include: examInclude(),
		});

		return fromDb(row);
	}

	/**
	 * Finds an exam by id or by its `(course, slug)` natural key.
	 *
	 * A `DRAFT` or `ARCHIVED` exam does not exist for anyone but whoever may
	 * write the course's contents.
	 */
	@Validate({
		service: true,
		returns: examSchema.nullable(),
		args: [undefined, examPK],
	})
	protected async findOneTx(
		tx: PrismaTx,
		filter: ExamPK,
		opts: ServiceOptsWithoutTx,
	): Promise<Exam | null> {
		const row = await tx.exam.findFirst({
			where: examWhere(filter),
			include: examInclude(),
		});
		if (!row) return null;

		if (hasPerm(opts.actor, "course.update-contents", row.course)) {
			return fromDb(row);
		}
		if (row.status === "DRAFT" || row.status === "ARCHIVED") return null;
		if (!hasPerm(opts.actor, "course.read-contents", row.course)) {
			throw new NotAllowed("exam.read");
		}

		return fromDb(row);
	}

	/**
	 * Lists the exams of one course, narrowed to what `actor` may see.
	 *
	 * Drafts and archived exams are left out for anyone but whoever may write
	 * the course's contents.
	 */
	@Validate({
		service: true,
		returns: examSchema.array(),
		args: [undefined, examFilter],
	})
	protected async findManyTx(
		tx: PrismaTx,
		filter: ExamFilter,
		opts: ServiceOptsWithoutTx,
	): Promise<Exam[]> {
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
					full ? {} : { status: { notIn: ["DRAFT", "ARCHIVED"] } },
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

		return rows.map(fromDb);
	}

	/**
	 * Lists the exams of several courses in one query, each paired with its course id and narrowed to what `actor` may see.
	 *
	 * Visibility is decided per course, as in `findMany`: drafts and archived
	 * exams only for whoever may write that course's contents. A course whose
	 * contents the actor may not read contributes no exams; it is not an error.
	 * An empty `courseIds` returns an empty list without querying.
	 */
	@Validate({
		service: true,
		returns: courseExamSchema.array(),
		args: [examFilterByCourses],
	})
	async findManyInCourses(
		filter: ExamFilterByCourses,
		opts: ServiceOpts,
	): Promise<CourseExam[]> {
		if (filter.courseIds.length === 0) return [];
		const client = opts.tx ?? this.prisma;
		const rows = await client.exam.findMany({
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
			include: examInclude(opts.actor === SYSTEM ? "" : opts.actor.username),
			orderBy: [{ courseId: "asc" }, { slug: "asc" }],
		});

		const result: CourseExam[] = [];
		for (const row of rows) {
			if (!hasPerm(opts.actor, "course.read-contents", row.course)) continue;
			const full = hasPerm(opts.actor, "course.update-contents", row.course);
			if (!full && (row.status === "DRAFT" || row.status === "ARCHIVED")) {
				continue;
			}
			result.push({ courseId: row.courseId as CourseId, exam: fromDb(row) });
		}
		return result;
	}

	/**
	 * Updates an exam's fields, its tag set, and the questions it pins.
	 *
	 * `tags` and `questions` are replaced wholesale when given, so a push always
	 * leaves the exam holding exactly what the caller sent.
	 */
	@Validate({
		service: true,
		returns: examSchema,
		args: [undefined, examPK, examUpdate],
	})
	protected async updateTx(
		tx: PrismaTx,
		filter: ExamPK,
		fields: ExamUpdate,
		opts: ServiceOptsWithoutTx,
	): Promise<Exam> {
		const exam = await writableExam(tx, filter, opts.actor, "exam.update");
		const questions = fields.questions
			? await resolveQuestions(tx, exam.courseId, fields.questions)
			: undefined;

		const row = await tx.exam.update({
			where: { id: exam.id },
			data: {
				type: fields.type,
				status: fields.status,
				title: fields.title,
				description: fields.description,
				preamble: fields.preamble,
				format: fields.format,
				scheduledAt: fields.scheduledAt,
				durationMs: toMs(fields.duration),
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
			},
			include: examInclude(),
		});

		return fromDb(row);
	}

	/**
	 * Upserts an exam keyed on its `(course, slug)` natural key.
	 *
	 * An archived exam under that key takes the update branch, which revives it
	 * only if the caller sends a new `status`.
	 */
	@Validate({
		service: true,
		returns: examSchema,
		args: [undefined, examCreate],
	})
	protected async upsertTx(
		tx: PrismaTx,
		input: ExamCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<Exam> {
		// Checked up front so both branches refuse a non-author the same way,
		// without telling them whether the exam exists.
		const course = await this.course(input.course, tx, opts, {
			perm: "course.update-contents",
		});

		const scoped = { ...opts, tx };

		const existing = await tx.exam.findUnique({
			where: { courseId_slug: { courseId: course.id, slug: input.slug } },
			select: { id: true },
		});
		if (!existing) return this.create({ ...input, course: course.id }, scoped);

		const { slug: _slug, course: _course, ...fields } = input;
		return this.update({ course: course.id, slug: input.slug }, fields, scoped);
	}

	/**
	 * Releases an exam's grades to its students now.
	 *
	 * Sets `gradesReleasedAt` to the current time. Calling it again on a
	 * released exam returns it unchanged. Only a closed `EXAM` with no answer
	 * still waiting for a grade can be released: a `QUIZ` and a `PRACTICE`
	 * release on their own schedule.
	 *
	 * @throws {@link NotFound} If the exam does not exist or `actor` may not see it.
	 * @throws {@link NotAllowed} If `actor` may not write the course's contents.
	 * @throws {@link InvalidData}
	 * If the exam is not an `EXAM`, is not closed, or has an answer waiting for a grade.
	 */
	@Validate({ service: true, returns: examSchema, args: [examPK] })
	releaseGrades<Opt extends ServiceOpts>(
		filter: ExamPK,
		opts: Opt,
	): Promise<Exam> {
		return this.$transaction(opts, async (tx, scoped) => {
			const row = valueOrNotFound(
				"exam",
				await tx.exam.findFirst({
					where: examWhere(filter),
					include: examInclude(),
				}),
			);

			if (!hasPerm(scoped.actor, "course.update-contents", row.course)) {
				const seen =
					row.status !== "DRAFT" &&
					row.status !== "ARCHIVED" &&
					hasPerm(scoped.actor, "course.read-contents", row.course);
				throw seen ? new NotAllowed("exam.update") : new NotFound("exam");
			}

			const exam = fromDb(row);
			const now = new Date();
			const exceptions = (
				await tx.examException.findMany({
					where: { examId: row.id },
					select: { extraTimeMs: true, scheduledAt: true },
				})
			).map((e) => ({
				extraTime: fromMs(e.extraTimeMs),
				scheduledAt: e.scheduledAt,
			}));
			const blocker =
				gradeReleaseBlocker(exam, [], now, exceptions) ??
				gradeReleaseBlocker(
					exam,
					await attemptResults(tx, row),
					now,
					exceptions,
				);
			if (blocker === "released") return exam;
			if (blocker) {
				throw new InvalidData({
					exam: [{ code: "invalid", message: releaseRefusals[blocker]() }],
				});
			}

			const updated = await tx.exam.update({
				where: { id: row.id },
				data: { gradesReleasedAt: new Date() },
				include: examInclude(),
			});
			return fromDb(updated);
		});
	}

	/**
	 * Archives an exam rather than removing it.
	 *
	 * Responses point at the exam they were written for, so the row stays
	 * readable; `update` or `upsert` bring it back.
	 */
	@Validate({ service: true, args: [undefined, examPK] })
	protected async deleteTx(
		tx: PrismaTx,
		filter: ExamPK,
		opts: ServiceOptsWithoutTx,
	): Promise<void> {
		const exam = await writableExam(tx, filter, opts.actor, "exam.delete");
		if (exam.status === "ARCHIVED") return;

		await tx.exam.update({
			where: { id: exam.id },
			data: { status: "ARCHIVED" },
		});
	}
}

//
// Auxiliary functions
//

/// Why {@link ExamService.releaseGrades} refuses, for each blocker it reports.
const releaseRefusals: Record<
	Exclude<GradeReleaseBlocker, "released">,
	() => string
> = {
	"not-an-exam": m.errors_release_not_an_exam,
	"not-closed": m.errors_release_not_closed,
	"exception-open": m.errors_release_exception_open,
	pending: m.errors_release_pending,
};

/// The result of every attempt at `exam`, with all feedback as the instructor sees it.
async function attemptResults(
	tx: PrismaTx,
	exam: DbExam,
): Promise<ExamResult[]> {
	const attempts = await tx.response.findMany({
		where: { examId: exam.id },
		select: {
			submissions: {
				select: {
					publicId: true,
					createdAt: true,
					question: { select: { slug: true } },
					feedbacks: {
						select: { score: true, feedback: true, updatedAt: true },
					},
				},
			},
		},
	});
	const slugs = exam.questionsForExams.map((q) => q.questionRef.slug);
	return attempts.map(({ submissions }) =>
		examResult(
			slugs,
			submissions.map((s) => ({ ...s, question: s.question.slug })),
			submissions.flatMap((s) =>
				s.feedbacks.map((f) => ({ ...f, submission: s.publicId })),
			),
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
	actor: ServiceOpts["actor"],
	action: "exam.update" | "exam.delete",
) {
	const exam = valueOrNotFound(
		"exam",
		await tx.exam.findFirst({
			where: examWhere(filter),
			select: {
				id: true,
				courseId: true,
				status: true,
				course: { select: { instructor: { select: { username: true } } } },
			},
		}),
	);

	if (hasPerm(actor, "course.update-contents", exam.course)) return exam;
	if (exam.status === "DRAFT" || exam.status === "ARCHIVED") {
		throw new NotFound("exam");
	}
	throw new NotAllowed(action);
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
 * order follow `personalTiming(exam, exception)`, while the groups still hold
 * the exams themselves.
 */
export function groupExamsForStudent(
	exams: Exam[],
	now: Date = new Date(),
	exceptions: ReadonlyMap<string, ExceptionTiming> = new Map(),
): ExamGroup[] {
	const visible = exams
		.filter((exam) => exam.status !== "DRAFT" && exam.status !== "ARCHIVED")
		.map((exam) => ({
			exam,
			personal: personalTiming(exam, exceptions.get(exam.slug) ?? null),
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

/** Converts a database row into the exam entity. */
function fromDb(row: DbExam): Exam {
	return {
		id: row.id as ExamId,
		slug: row.slug,
		type: row.type,
		status: row.status,
		title: row.title,
		description: row.description,
		preamble: row.preamble,
		format: row.format,
		scheduledAt: row.scheduledAt,
		duration: fromMs(row.durationMs),
		extraTime: fromMs(row.extraTimeMs),
		author: row.authorId,
		gradesReleasedAt: row.gradesReleasedAt,
		rev: row.rev,
		tags: row.examTags.map((t) => t.tag),
		questions: row.questionsForExams.map((q) => ({
			id: q.questionRef.id as Exam["questions"][number]["id"],
			slug: q.questionRef.slug,
			version: q.version,
		})),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}
