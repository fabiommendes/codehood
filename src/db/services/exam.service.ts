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
import type { ExamId } from "@/core/schemas";
import {
	examCreate,
	examFilter,
	examPK,
	examSchema,
	examUpdate,
	examUpsert,
} from "@/core/schemas";
import {
	CrudBase,
	type ServiceOpts,
	type ServiceOptsWithoutTx,
} from "@/db/base-service";
import { Validate } from "@/utils/validate";
import type { Prisma, PrismaTx } from "../client";
import {
	courseRefWhere,
	invalidIfExists,
	valueOrNotAllowed,
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
export type ExamPK = z.infer<typeof examPK>;
export type ExamUpdate = z.infer<typeof examUpdate>;
export type ExamUpsert = z.infer<typeof examUpsert>;

/// The course shape the permission predicates need, plus the exam's own relations.
function examInclude() {
	return {
		course: {
			select: {
				instructor: { select: { username: true } },
				enrollments: {
					where: { status: "ACTIVE" as const },
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
	upsert: ExamUpsert;
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
		const course = await writableCourse(tx, input.courseId, opts.actor);
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
				format: input.format,
				scheduledAt: input.scheduledAt ?? null,
				durationMs: input.durationMs ?? null,
				extraTimeMs: input.extraTimeMs,
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
				where: courseRefWhere(
					"courseId" in filter
						? filter.courseId
						: {
								discipline: filter.discipline,
								instructor: filter.instructor,
								edition: filter.edition,
							},
				),
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
				...(full ? {} : { status: { notIn: ["DRAFT", "ARCHIVED"] } }),
				...(filter.slugs ? { slug: { in: filter.slugs } } : {}),
				...(filter.statuses ? { status: { in: filter.statuses } } : {}),
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
				durationMs: fields.durationMs,
				extraTimeMs: fields.extraTimeMs,
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
		args: [undefined, examUpsert],
	})
	protected async upsertTx(
		tx: PrismaTx,
		input: ExamUpsert,
		opts: ServiceOptsWithoutTx,
	): Promise<Exam> {
		// Checked up front so both branches refuse a non-author the same way,
		// without telling them whether the exam exists.
		const course = await writableCourse(tx, input.courseId, opts.actor);
		const scoped = { ...opts, tx };

		const existing = await tx.exam.findUnique({
			where: { courseId_slug: { courseId: course.id, slug: input.slug } },
			select: { id: true },
		});
		if (!existing)
			return this.create({ ...input, courseId: course.id }, scoped);

		const { slug: _slug, courseId: _courseId, ...fields } = input;
		return this.update(
			{ courseId: course.id, slug: input.slug },
			fields,
			scoped,
		);
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

/** The `where` matching whichever of the primary keys `filter` carries. */
function examWhere(filter: ExamPK): Prisma.ExamWhereInput {
	if ("id" in filter) return { id: filter.id };
	if ("courseId" in filter) {
		return { courseId: filter.courseId, slug: filter.slug };
	}

	return {
		slug: filter.slug,
		course: {
			disciplineSlug: filter.discipline,
			instructorId: filter.instructor,
			editionSlug: filter.edition,
		},
	};
}

/** Finds the course an exam is written to, refusing an actor who may not write its contents. */
async function writableCourse(
	tx: PrismaTx,
	ref: ExamCreate["courseId"],
	actor: ServiceOpts["actor"],
) {
	return valueOrNotAllowed(
		"exam.create",
		valueOrNotFound(
			"course",
			await tx.course.findUnique({
				where: courseRefWhere(ref),
				select: { id: true, instructor: { select: { username: true } } },
			}),
		),
		(c) => hasPerm(actor, "course.update-contents", c),
	);
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
): Promise<{ questionRefId: number; version: string | null }[]> {
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
				message: `No question "${slug}" in this course`,
			})),
		});
	}

	return questions.map((q) => ({
		// Checked above: every slug resolved.
		questionRefId: bySlug.get(q.slug) as number,
		version: q.version ?? null,
	}));
}

/** Converts a database row into the exam entity. */
function fromDb(row: DbExam): Exam {
	return {
		id: row.id as ExamId,
		courseId: row.courseId as Exam["courseId"],
		slug: row.slug,
		type: row.type,
		status: row.status,
		title: row.title,
		description: row.description,
		preamble: row.preamble,
		format: row.format,
		scheduledAt: row.scheduledAt,
		durationMs: row.durationMs,
		extraTimeMs: row.extraTimeMs,
		authorId: row.authorId,
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
