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
import type { Duration, ExamId } from "@/core/schemas";
import {
	examCreate,
	examFilter,
	examPK,
	examSchema,
	examUpdate,
} from "@/core/schemas";
import {
	CrudBase,
	type ServiceOpts,
	type ServiceOptsWithoutTx,
} from "@/db/base-service";
import { durationToMinutes, toDuration } from "@/utils/schedule-time";
import { Validate } from "@/utils/validate";
import type { Prisma, PrismaTx } from "../client";
import { examPhase } from "../exam-state";
import { courseRefWhere, invalidIfExists, valueOrNotFound } from "../utils";

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
				...(full ? {} : { status: { notIn: ["DRAFT", "ARCHIVED"] } }),
				...(filter.exams ? { slug: { in: filter.exams } } : {}),
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

/** Orders exams within a group, unscheduled exams sorted last. */
function sortGroup(key: ExamGroup["key"], exams: Exam[]): Exam[] {
	if (key === "practice") {
		return [...exams].sort((a, b) => a.title.localeCompare(b.title));
	}

	const dirMul = key === "past" ? -1 : 1;
	return [...exams].sort((a, b) => {
		if (a.scheduledAt === null && b.scheduledAt === null) return 0;
		if (a.scheduledAt === null) return 1;
		if (b.scheduledAt === null) return -1;
		return dirMul * (a.scheduledAt.getTime() - b.scheduledAt.getTime());
	});
}

/** Display order and label for each `ExamGroup` key — never authored, see the spec. */
const GROUP_ORDER: { key: ExamGroup["key"]; label: string }[] = [
	{ key: "open", label: "Open" },
	{ key: "practice", label: "Practice" },
	{ key: "upcoming", label: "Upcoming" },
	{ key: "past", label: "Past exams and grades" },
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
 */
export function groupExamsForStudent(
	exams: Exam[],
	now: Date = new Date(),
): ExamGroup[] {
	const visible = exams.filter(
		(exam) => exam.status !== "DRAFT" && exam.status !== "ARCHIVED",
	);

	const groups: ExamGroup[] = [];
	for (const { key, label } of GROUP_ORDER) {
		const inGroup = sortGroup(
			key,
			visible.filter((exam) => belongsTo(key, exam, now)),
		);
		if (inGroup.length > 0) {
			groups.push({ key, label, exams: inGroup });
		}
	}
	return groups;
}

/** A {@link Duration} as the milliseconds the database stores, passing `null` and `undefined` through. */
function toMs<T extends null | undefined>(length: Duration | T): number | T {
	if (length === null || length === undefined) return length;
	return durationToMinutes(length) * 60_000;
}

/** Stored milliseconds as a {@link Duration}, a missing or zero length read as `null`. */
function fromMs(ms: number | null): Duration | null {
	if (!ms) return null;
	return toDuration(Math.round(ms / 60_000));
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
