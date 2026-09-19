/**
 * Questions and their versions — see `dev/specs/to-do/questions.md`.
 *
 * A question lives in exactly one course, so writes are ownership-gated
 * (`canWriteCourseContent`) and reads follow `canViewQuestion`. What a read
 * returns depends on the actor: an author sees the MDQ document whole, anyone
 * else the public half of a published question, and nothing of a draft.
 */
import { isDeepStrictEqual } from "node:util";
import type { z } from "zod";
import { type Actor, SYSTEM } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import { generateToken } from "@/auth/token";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import type { QuestionRefId } from "@/core/schemas";
import {
	questionCreate,
	questionFilter,
	questionPK,
	questionPublicSchema,
	questionSchema,
	questionUpdate,
	questionUpsert,
} from "@/core/schemas";
import {
	CrudBase,
	type ServiceOpts,
	type ServiceOptsWithoutTx,
} from "@/db/base-service";
import type { PublicQuestion } from "@/mdq/public";
import { Question as MdqQuestion } from "@/mdq/question";
import { mergeQuestion, splitQuestion } from "@/mdq/split";
import type { JSONValue } from "@/typing/concrete-types";
import { Validate } from "@/utils/validate";
import type { Prisma, PrismaTx } from "../client";
import { courseRefWhere, valueOrNotAllowed, valueOrNotFound } from "../utils";
import { courseContentsWhere } from "./course.service";

export { questionStatus, questionType } from "@/core/schemas";
export type { QuestionRefId };

//
// Type definitions
//
export type Question = z.infer<typeof questionSchema>;
export type QuestionPublic = z.infer<typeof questionPublicSchema>;
export type QuestionCreate = z.infer<typeof questionCreate>;
export type QuestionFilter = z.infer<typeof questionFilter>;
export type QuestionPK = z.infer<typeof questionPK>;
export type QuestionUpdate = z.infer<typeof questionUpdate>;
export type QuestionUpsert = z.infer<typeof questionUpsert>;

/** What a read returns: the authored document, or the student-safe half. */
export type QuestionView = Question | QuestionPublic;

/**
 * The course shape the predicates need, plus the version a read renders.
 *
 * `includePrivate` gates whether `latest.privatePayload` is selected at all —
 * the query itself, not application code filtering it out afterwards, is
 * what keeps the answer key out of a student's read (see the module
 * docstring). Defaults to `false`: callers that haven't yet checked
 * `canWriteCourseContent` get the safe shape for free.
 */
function questionInclude<Private extends boolean = false>(
	includePrivate: Private = false as Private,
) {
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
		latest: {
			select: {
				versionHash: true,
				publicPayload: true,
				privatePayload: includePrivate,
			},
		},
		questionTags: { select: { tag: true } },
	} satisfies Prisma.QuestionRefInclude;
}

type DbQuestion = Prisma.QuestionRefGetPayload<{
	include: ReturnType<typeof questionInclude<true>>;
}>;
type DbQuestionPublic = Prisma.QuestionRefGetPayload<{
	include: ReturnType<typeof questionInclude<false>>;
}>;

const questionView = questionSchema.or(questionPublicSchema);

export class QuestionService extends CrudBase<{
	entity: QuestionView;
	pkFilter: QuestionPK;
	create: QuestionCreate;
	filter: QuestionFilter;
	update: QuestionUpdate;
	upsert: QuestionUpsert;
}> {
	// Overloads only narrow the return type on `filter.public`; the logic and
	// its docs live in `findOneTx`/`findManyTx`.
	override findOne<Opt extends ServiceOpts>(
		filter: QuestionPK & { public: true },
		opts: Opt,
	): Promise<QuestionPublic | null>;
	override findOne<Opt extends ServiceOpts>(
		filter: QuestionPK & { public: false },
		opts: Opt,
	): Promise<Question | null>;
	override findOne<Opt extends ServiceOpts>(
		filter: QuestionPK,
		opts: Opt,
	): Promise<QuestionView | null>;
	override findOne<Opt extends ServiceOpts>(
		filter: QuestionPK,
		opts: Opt,
	): Promise<QuestionView | null> {
		return super.findOne(filter, opts);
	}

	override findMany<Opt extends ServiceOpts>(
		filter: QuestionFilter & { public: true },
		opts: Opt,
	): Promise<QuestionPublic[]>;
	override findMany<Opt extends ServiceOpts>(
		filter: QuestionFilter & { public: false },
		opts: Opt,
	): Promise<Question[]>;
	override findMany<Opt extends ServiceOpts>(
		filter: QuestionFilter,
		opts: Opt,
	): Promise<QuestionView[]>;
	override findMany<Opt extends ServiceOpts>(
		filter: QuestionFilter,
		opts: Opt,
	): Promise<QuestionView[]> {
		return super.findMany(filter, opts);
	}

	/**
	 * Creates a question and its first version, or revives an archived one
	 * under the same slug.
	 */
	@Validate({
		service: true,
		returns: questionSchema,
		args: [undefined, questionCreate],
	})
	protected async createTx(
		tx: PrismaTx,
		input: QuestionCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<Question> {
		assertWellFormed(input.question);
		const course = await writableCourse(tx, input.courseId, opts.actor);

		const archived = await tx.questionRef.findFirst({
			where: { courseId: course.id, slug: input.slug, status: "ARCHIVED" },
			select: { id: true, slug: true },
		});
		if (archived) return applyWrite(tx, archived, input);

		const row = await tx.questionRef.create({
			data: {
				publicId: generateToken(9),
				slug: input.slug,
				status: input.status,
				type: toDbType(input.question.type),
				courseId: course.id,
			},
		});
		return applyWrite(tx, row, input);
	}

	/**
	 * Finds a question by id, public id, or its `(course, slug)` natural key.
	 *
	 * `filter.public` picks the view (see `questionFindOneQuery`); asking for
	 * the whole document without the right to see it throws `NotAllowed`, and
	 * a draft or archived question is `null` for anyone but its author.
	 */
	@Validate({
		service: true,
		returns: questionView.nullable(),
		args: [undefined, questionPK],
	})
	protected async findOneTx(
		tx: PrismaTx,
		filter: QuestionPK,
		opts: ServiceOptsWithoutTx,
	): Promise<QuestionView | null> {
		// Resolved with the public-safe include: at this point `actor` hasn't
		// been checked against the course, so `latest.privatePayload` must not
		// be in the query yet.
		const row = await tx.questionRef.findFirst({
			where: refWhere(filter),
			include: questionInclude(),
		});

		if (!row) return null;

		if (!hasPerm(opts.actor, "course.read-contents", row.course)) {
			// A draft or archived question does not exist for a non-author.
			if (row.status !== "PUBLISHED") return null;
			throw new NotAllowed("question.read");
		}

		const full = hasPerm(opts.actor, "course.update-contents", row.course);
		if (filter.public === false && !full) {
			throw new NotAllowed("question.read");
		}
		if (filter.public || !full) return fromDbPublic(row);

		// Only now, with the full view granted, does the query touching
		// `privatePayload` get sent.
		return fromDb(
			valueOrNotFound(
				"question",
				await tx.questionRef.findUnique({
					where: { id: row.id },
					include: questionInclude(true),
				}),
			),
		);
	}

	/**
	 * Lists the questions of one course, narrowed to what `actor` may see.
	 *
	 * `filter.public` picks the view, as in {@link findOneTx}.
	 */
	@Validate({
		service: true,
		returns: questionView.array(),
		args: [undefined, questionFilter],
	})
	protected async findManyTx(
		tx: PrismaTx,
		filter: QuestionFilter,
		opts: ServiceOptsWithoutTx,
	): Promise<QuestionView[]> {
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
			throw new NotAllowed("question.read");
		}

		const full = hasPerm(opts.actor, "course.update-contents", course);
		const isPublic = filter.public ?? !full;
		if (filter.public === false && !full) {
			throw new NotAllowed("question.read");
		}

		const where = {
			AND: [
				questionWhere(opts.actor, isPublic),
				{
					courseId: course.id,
					...(filter.slugs ? { slug: { in: filter.slugs } } : {}),
					...(filter.statuses ? { status: { in: filter.statuses } } : {}),
					...(filter.types ? { type: { in: filter.types.map(toDbType) } } : {}),
					...(filter.tags
						? { questionTags: { some: { tag: { in: filter.tags } } } }
						: {}),
				},
			],
		} satisfies Prisma.QuestionRefWhereInput;

		if (isPublic) {
			const rows = await tx.questionRef.findMany({
				where,
				include: questionInclude(false),
				orderBy: { slug: "asc" },
			});
			return rows.map(fromDbPublic);
		}

		const rows = await tx.questionRef.findMany({
			where,
			include: questionInclude(true),
			orderBy: { slug: "asc" },
		});
		return rows.map(fromDb);
	}

	/**
	 * Appends a version when `question` changes, and repoints `latest`.
	 *
	 * Stored versions are never rewritten: an exam may be pinned to any of
	 * them. A `status` change alone produces no version, and an archived
	 * question is refused (FR-SYNC-012); `create` or `upsert` revive it.
	 */
	@Validate({
		service: true,
		returns: questionSchema,
		args: [undefined, questionPK, questionUpdate],
	})
	protected async updateTx(
		tx: PrismaTx,
		filter: QuestionPK,
		fields: QuestionUpdate,
		opts: ServiceOptsWithoutTx,
	): Promise<Question> {
		if ((fields.question === undefined) !== (fields.version === undefined)) {
			throw new InvalidData({
				[fields.question ? "version" : "question"]: [
					{ code: "missing", message: "`question` and `version` go together" },
				],
			});
		}
		if (fields.question) assertWellFormed(fields.question);

		const ref = await writableRef(tx, filter, opts.actor, "question.update");
		if (ref.status === "ARCHIVED") {
			throw new NotAllowed("question.update", {
				status: 409,
				message: `Question "${ref.slug}" is archived and cannot be written to`,
			});
		}

		return applyWrite(tx, ref, fields);
	}

	/**
	 * Upserts a question keyed on its `(course, slug)` natural key.
	 *
	 * An archived question under that key takes the create branch, which
	 * revives it.
	 */
	@Validate({
		service: true,
		returns: questionSchema,
		args: [undefined, questionUpsert],
	})
	protected async upsertTx(
		tx: PrismaTx,
		input: QuestionUpsert,
		opts: ServiceOptsWithoutTx,
	): Promise<QuestionView> {
		// Checked up front so both branches refuse a non-author the same way,
		// without telling them whether the question exists.
		const course = await writableCourse(tx, input.courseId, opts.actor);
		const scoped = { ...opts, tx };

		const existing = await tx.questionRef.findUnique({
			where: { slug_courseId: { slug: input.slug, courseId: course.id } },
			select: { status: true },
		});
		if (!existing || existing.status === "ARCHIVED") {
			return this.create({ ...input, courseId: course.id }, scoped);
		}

		const { status, version, question } = input;
		return this.update(
			{ courseId: course.id, slug: input.slug },
			{ status, version, question },
			scoped,
		);
	}

	/**
	 * Archives a question rather than removing it (FR-SYNC-013).
	 *
	 * The row stays readable through an exam that references it, and only
	 * `create` or `upsert` bring it back.
	 */
	@Validate({ service: true, args: [undefined, questionPK] })
	protected async deleteTx(
		tx: PrismaTx,
		filter: QuestionPK,
		opts: ServiceOptsWithoutTx,
	): Promise<void> {
		const ref = await writableRef(tx, filter, opts.actor, "question.delete");
		if (ref.status === "ARCHIVED") return;

		await tx.questionRef.update({
			where: { id: ref.id },
			data: { status: "ARCHIVED" },
		});
	}

	// Auxiliary functions -----------------------------------------------------

	/**
	 * Expensive check to determine if the actor can view the given question.
	 *
	 * This can be used in tests or in one-offs. This method performs database
	 * access, so do not use to check items in a large collection.
	 */
	async canViewQuestion(
		actor: Actor,
		question: Question,
		visibility: "private" | "public",
	): Promise<boolean> {
		if (actor === SYSTEM) return true;

		const data = await this.prisma.questionRef.findUnique({
			where: { id: question.id },
			select: {
				course: {
					select: {
						instructor: { select: { username: true } },
						id: true,
						enrollments: {
							select: { username: true },
						},
					},
				},
			},
		});
		if (!data) return false;

		const perm =
			visibility === "public"
				? "course.read-contents"
				: "course.update-contents";

		return hasPerm(actor, perm, data.course);
	}
}

//
// Auxiliary functions
//

/**
 * Prisma `where` fragment implementing the same rule as {@link canReadQuestion}.
 */
export function questionWhere(
	actor: Actor,
	isPublic = false,
): Prisma.QuestionRefWhereInput {
	if (actor === SYSTEM) return {};

	const owned = { course: { instructor: { username: actor.username } } };
	if (!isPublic) return owned;

	return {
		OR: [owned, { status: "PUBLISHED", course: courseContentsWhere(actor) }],
	};
}

/** Converts a database row into the authored question. */
function fromDb(row: DbQuestion): Question {
	const latest = valueOrNotFound("question-version", row.latest);

	return {
		id: row.id,
		slug: row.slug,
		status: row.status,
		version: latest.versionHash,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		// Prisma types a stored JSON object's values as possibly `undefined`,
		// which a value parsed back out of a JSON column never is.
		question: mergeQuestion(
			latest.publicPayload as JSONValue,
			latest.privatePayload as JSONValue,
		),
	};
}

/** Converts a database row into the student-safe half — no merge, since the private column was never fetched in the first place. */
function fromDbPublic(row: DbQuestionPublic): QuestionPublic {
	const latest = valueOrNotFound("question-version", row.latest);

	return {
		id: row.id,
		slug: row.slug,
		status: row.status,
		version: latest.versionHash,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		question: latest.publicPayload as unknown as PublicQuestion,
	};
}

/** The `where` matching whichever of the primary keys `filter` carries. */
function refWhere(filter: QuestionPK): Prisma.QuestionRefWhereInput {
	if ("id" in filter) return { id: filter.id };
	if ("publicId" in filter) return { publicId: filter.publicId };
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

/** Finds the course a question is written to, refusing an actor who may not write its content. */
async function writableCourse(
	tx: PrismaTx,
	ref: QuestionCreate["courseId"],
	actor: ServiceOpts["actor"],
) {
	return valueOrNotAllowed(
		"question.create",
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
 * Finds the question a write targets, refusing an actor who may not write to its course.
 *
 * A draft or archived question is `NotFound` for a non-author, as on reads.
 */
async function writableRef(
	tx: PrismaTx,
	filter: QuestionPK,
	actor: ServiceOpts["actor"],
	action: "question.update" | "question.delete",
) {
	const ref = valueOrNotFound(
		"question",
		await tx.questionRef.findFirst({
			where: refWhere(filter),
			select: {
				id: true,
				slug: true,
				status: true,
				course: { select: { instructor: { select: { username: true } } } },
			},
		}),
	);

	if (hasPerm(actor, "course.update-contents", ref.course)) return ref;
	if (ref.status !== "PUBLISHED") throw new NotFound("question");
	throw new NotAllowed(action);
}

/** Writes `fields` onto `ref`, appending a version when `question` is given. */
async function applyWrite(
	tx: PrismaTx,
	ref: { id: QuestionRefId; slug: string },
	fields: QuestionUpdate,
): Promise<Question> {
	const { question, version } = fields;
	const latestId =
		question && version
			? await writeVersion(tx, ref, { version, question })
			: undefined;

	return fromDb(
		await tx.questionRef.update({
			where: { id: ref.id },
			data: {
				status: fields.status,
				latestId,
				...(question && {
					type: toDbType(question.type),
					// A push replaces the tag set wholesale.
					questionTags: {
						deleteMany: {},
						create: (question.tags ?? []).map((tag) => ({ tag })),
					},
				}),
			},
			include: questionInclude(true),
		}),
	);
}

/**
 * Stores `input.question` as version `input.version` of `ref`, returning its id.
 *
 * A label already in use for the same content resolves to that row, so a
 * repeated push or a rollback writes nothing; reusing it for different
 * content is refused, since versions are never rewritten.
 */
async function writeVersion(
	tx: PrismaTx,
	ref: { id: number; slug: string },
	input: Pick<Question, "version" | "question">,
): Promise<number> {
	// Round-tripped through JSON so it compares equal to what the column
	// hands back; both halves are plain JSON by construction.
	const halves = JSON.parse(JSON.stringify(splitQuestion(input.question))) as {
		publicPayload: Prisma.InputJsonValue;
		privatePayload: Prisma.InputJsonValue;
	};

	const existing = await tx.questionData.findUnique({
		where: { refId_versionHash: { refId: ref.id, versionHash: input.version } },
		select: { id: true, publicPayload: true, privatePayload: true },
	});

	if (existing) {
		const { id, ...stored } = existing;
		if (isDeepStrictEqual(stored, halves)) return id;

		throw new NotAllowed("question.update", {
			status: 409,
			message: `Version "${input.version}" of "${ref.slug}" already holds different content`,
		});
	}

	const version = await tx.questionData.create({
		data: {
			refId: ref.id,
			versionHash: input.version,
			title: input.question.title ?? ref.slug,
			stem: input.question.stem,
			...halves,
		},
	});
	return version.id;
}

/**
 * Refuses a document whose fields are individually valid but disagree with
 * each other — a fill-in stem naming a blank it never defines, for one.
 *
 * The Zod schema on the way in checks one field at a time, which is all JSON
 * Schema can express; these are mdq.spec's rules *between* fields, and a
 * document that breaks one is a question nobody can answer.
 */
function assertWellFormed(data: Question["question"]): void {
	const problems = new MdqQuestion(data).validate();
	if (problems.length === 0) return;

	throw new InvalidData(
		{
			question: problems.map((p) => ({ code: "invalid", message: p.message })),
		},
		{ message: problems.map((p) => `${p.code}: ${p.message}`).join("; ") },
	);
}

/** The Prisma enum spelling of an MDQ question type. */
function toDbType(
	type: Question["question"]["type"],
): Prisma.QuestionRefCreateInput["type"] {
	return type
		.replace(/-/g, "_")
		.toUpperCase() as Prisma.QuestionRefCreateInput["type"];
}
