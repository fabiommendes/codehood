/**
 * Questions and their versions.
 *
 * A question lives in exactly one course, so writes are ownership-gated
 * (`course.update-contents`). What a read returns depends on the actor: an author sees the MDQ document whole, anyone
 * else the public half of a published question, and nothing of a draft.
 */
import { isDeepStrictEqual } from "node:util";
import type { z } from "zod";
import { accessError, questionAccess, requireAccess } from "@/auth/access";
import { type Actor, SYSTEM } from "@/auth/actor";
import { ensurePerm, hasPerm } from "@/auth/permissions";
import { generateToken } from "@/auth/token";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import type { QuestionRefId } from "@/core/schemas";
import {
	questionCreate,
	questionFilter,
	questionFindOneFilter,
	questionPK,
	questionPublicSchema,
	questionSchema,
	questionUpdate,
} from "@/core/schemas";
import type { ServiceOpts, ServiceOptsWithoutTx } from "@/db/base-service";
import { defineService, op } from "@/db/define-service";
import { m } from "@/i18n";
import {
	type PublicQuestion,
	publicForm,
	type QuestionDocument,
	questionProblems,
	withIds,
} from "@/mdq";
import { upgradeLegacyQuestion } from "@/mdq/legacy";
import { type QuestionStatus, writable } from "@/services/question-status";
import type { JSONValue } from "@/typing/concrete-types";
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
/// A primary key plus the stored version to read, as `findOne` takes it.
export type QuestionFindOneFilter = z.infer<typeof questionFindOneFilter>;
export type QuestionUpdate = z.infer<typeof questionUpdate>;

/** What a read returns: the authored document, or the student-safe half. */
export type QuestionView = Question | QuestionPublic;

/**
 * The course shape the predicates need, plus the version a read renders.
 *
 * `includePrivate` gates whether `latest.privatePayload` is selected at all —
 * the query itself, not application code filtering it out afterwards, is
 * what keeps the answer key out of a student's read (see the module
 * docstring). Defaults to `false`: callers that haven't yet checked
 * `course.update-contents` get the safe shape for free.
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

/// The stored version of a question with this hash, or `null` when none is asked for or it never existed.
function findPinnedVersion(
	tx: PrismaTx,
	refId: number,
	versionHash: string | null | undefined,
	includePrivate: true,
): Promise<{
	versionHash: string;
	publicPayload: Prisma.JsonValue;
	privatePayload: Prisma.JsonValue;
} | null>;
function findPinnedVersion(
	tx: PrismaTx,
	refId: number,
	versionHash: string | null | undefined,
	includePrivate: false,
): Promise<{ versionHash: string; publicPayload: Prisma.JsonValue } | null>;
async function findPinnedVersion(
	tx: PrismaTx,
	refId: number,
	versionHash: string | null | undefined,
	includePrivate: boolean,
) {
	if (!versionHash) return null;
	return tx.questionData.findUnique({
		where: { refId_versionHash: { refId, versionHash } },
		select: {
			versionHash: true,
			publicPayload: true,
			privatePayload: includePrivate,
		},
	});
}

const questionView = questionSchema.or(questionPublicSchema);

/// The CRUD shape of the question service.
type QuestionT = {
	entity: QuestionView;
	pkFilter: QuestionPK;
	create: QuestionCreate;
	filter: QuestionFilter;
	update: QuestionUpdate;
};

const buildQuestionService = defineService<QuestionT>()(() => {
	/**
	 * Creates a question and its first version, or revives an archived one
	 * under the same slug.
	 */
	const create = op({
		args: [questionCreate],
		returns: questionSchema,
		run: async (
			tx: PrismaTx,
			input: QuestionCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<Question> => {
			assertWellFormed(input.question);
			const course = await writableCourse(tx, input.course, opts.actor);

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
		},
	});

	/**
	 * Finds a question by id, public id, or its `(course, slug)` natural key.
	 *
	 * `filter.public` picks the view (see `questionFindOneQuery`); asking for
	 * the whole document without the right to see it throws `NotAllowed`, and
	 * a draft, hidden or archived question is `null` for anyone but its author.
	 *
	 * `filter.version` picks the stored version by its `versionHash`, as an
	 * exam pins it; left out or `null`, the read returns the latest. Every
	 * field of the result but `question` and `version` describes the
	 * question as it is now (status, rev, timestamps). A version the question
	 * never had falls back to the latest.
	 */
	const findOne = op({
		transaction: false,
		args: [questionFindOneFilter],
		returns: questionView.nullable(),
		run: async (
			tx: PrismaTx,
			filter: QuestionFindOneFilter,
			opts: ServiceOptsWithoutTx,
		): Promise<QuestionView | null> => {
			// Resolved with the public-safe include: at this point `actor` hasn't
			// been checked against the course, so `latest.privatePayload` must not
			// be in the query yet.
			const row = await tx.questionRef.findFirst({
				where: refWhere(filter),
				include: questionInclude(),
			});

			if (!row) return null;

			// An outsider is refused whatever the status, so a hidden slug cannot
			// be told from a published one; a draft, hidden or archived question
			// is missing for a non-author, unless an exam still pins it.
			const access = questionAccess(opts.actor, row, await isPinned(tx, row));
			const error = accessError(access, "read", "question.read");
			if (error instanceof NotFound) return null;
			if (error) throw error;

			const full = access === "write";
			if (filter.public === false && !full) {
				throw new NotAllowed("question.read");
			}
			if (filter.public || !full) {
				const pinned = await findPinnedVersion(
					tx,
					row.id,
					filter.version,
					false,
				);
				return fromDbPublic(
					pinned ? ({ ...row, latest: pinned } as typeof row) : row,
				);
			}

			// Only now, with the full view granted, does the query touching
			// `privatePayload` get sent.
			const pinned = await findPinnedVersion(tx, row.id, filter.version, true);
			const fullRow = valueOrNotFound(
				"question",
				await tx.questionRef.findUnique({
					where: { id: row.id },
					include: pinned
						? { ...questionInclude(true), latest: false }
						: questionInclude(true),
				}),
			);
			return fromDb(
				pinned ? { ...fullRow, latest: pinned } : (fullRow as DbQuestion),
			);
		},
	});

	/**
	 * Lists the questions of one course, narrowed to what `actor` may see.
	 *
	 * `filter.public` picks the view, as in `findOne`.
	 */
	const findMany = op({
		transaction: false,
		args: [questionFilter],
		returns: questionView.array(),
		run: async (
			tx: PrismaTx,
			filter: QuestionFilter,
			opts: ServiceOptsWithoutTx,
		): Promise<QuestionView[]> => {
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
						...(filter.types
							? { type: { in: filter.types.map(toDbType) } }
							: {}),
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
		},
	});

	/**
	 * Appends a version when `question` changes, and repoints `latest`.
	 *
	 * Stored versions are never rewritten: an exam may be pinned to any of
	 * them. A `status` change alone produces no version, and an archived
	 * question is refused, since a sync must not silently write to an archived
	 * natural key; `create` or `upsert` revive it.
	 */
	const update = op({
		args: [questionPK, questionUpdate],
		returns: questionSchema,
		run: async (
			tx: PrismaTx,
			filter: QuestionPK,
			fields: QuestionUpdate,
			opts: ServiceOptsWithoutTx,
		): Promise<Question> => {
			if ((fields.question === undefined) !== (fields.version === undefined)) {
				throw new InvalidData({
					[fields.question ? "version" : "question"]: [
						{ code: "missing", message: m.errors_question_version_together() },
					],
				});
			}
			if (fields.question) assertWellFormed(fields.question);

			const ref = await writableRef(tx, filter, opts.actor, "question.update");
			if (!writable(ref.status)) {
				throw new NotAllowed("question.update", {
					status: 409,
					message: m.errors_question_archived({ slug: ref.slug }),
				});
			}

			return applyWrite(tx, ref, fields);
		},
	});

	/**
	 * Upserts a question keyed on its `(course, slug)` natural key.
	 *
	 * An archived question under that key takes the create branch, which
	 * revives it.
	 */
	const upsert = op({
		args: [questionCreate],
		returns: questionSchema,
		run: async (
			tx: PrismaTx,
			input: QuestionCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<QuestionView> => {
			// Checked up front so both branches refuse a non-author the same way,
			// without telling them whether the question exists.
			const course = await writableCourse(tx, input.course, opts.actor);

			const existing = await tx.questionRef.findUnique({
				where: { slug_courseId: { slug: input.slug, courseId: course.id } },
				select: { status: true },
			});
			if (!existing || !writable(existing.status)) {
				return create(tx, { ...input, course: course.id }, opts);
			}

			const { status, version, question, rev } = input;
			return update(
				tx,
				{ course: course.id, slug: input.slug },
				{ status, version, question, rev },
				opts,
			);
		},
	});

	/**
	 * Archives a question rather than removing it, since responses reference it.
	 *
	 * The row stays readable through an exam that references it, and only
	 * `create` or `upsert` bring it back.
	 */
	const remove = op({
		args: [questionPK],
		run: async (
			tx: PrismaTx,
			filter: QuestionPK,
			opts: ServiceOptsWithoutTx,
		): Promise<void> => {
			const ref = await writableRef(tx, filter, opts.actor, "question.delete");
			if (!writable(ref.status)) return;

			await tx.questionRef.update({
				where: { id: ref.id },
				data: { status: "ARCHIVED" },
			});
		},
	});

	/**
	 * Rewrites every version stored in the 0.2 format (split halves, older mdq
	 * fields) as the current document and its public form.
	 *
	 * A version already in the current format is left alone, so running it
	 * again changes nothing. `dryRun` reports without writing. An upgraded
	 * version is relabelled with {@link LEGACY_VERSION_SUFFIX}: its label
	 * digested the source the old parser read, and the next push of that
	 * unchanged source must append a version rather than clash with this one.
	 *
	 * @throws NotAllowed when the actor lacks `system.manage`.
	 */
	const upgradeLegacyVersions = op({
		run: async (
			tx: PrismaTx,
			options: { dryRun?: boolean },
			opts: ServiceOptsWithoutTx,
		): Promise<LegacyUpgradeReport> => {
			ensurePerm(opts.actor, "system.manage");
			const report: LegacyUpgradeReport = {
				upgraded: 0,
				current: 0,
				failed: [],
			};
			const rows = await tx.questionData.findMany({
				select: {
					id: true,
					versionHash: true,
					publicPayload: true,
					privatePayload: true,
					ref: { select: { slug: true } },
				},
				orderBy: { id: "asc" },
			});
			for (const row of rows) {
				let document: QuestionDocument | null;
				try {
					document = upgradeLegacyQuestion(
						row.publicPayload as JSONValue,
						row.privatePayload as JSONValue,
					);
				} catch (error) {
					report.failed.push({
						id: row.id,
						slug: row.ref.slug,
						reason: error instanceof Error ? error.message : String(error),
					});
					continue;
				}
				if (!document) {
					report.current++;
					continue;
				}
				report.upgraded++;
				if (options.dryRun) continue;
				const halves = JSON.parse(
					JSON.stringify({
						publicPayload: publicForm(document),
						privatePayload: document,
					}),
				);
				await tx.questionData.update({
					where: { id: row.id },
					data: {
						...halves,
						stem: document.stem,
						versionHash: `${row.versionHash}${LEGACY_VERSION_SUFFIX}`,
					},
				});
			}
			return report;
		},
	});

	return {
		create,
		findOne,
		findMany,
		update,
		upsert,
		delete: remove,
		upgradeLegacyVersions,
	};
});

/// Appended to the label of a version rewritten by `upgradeLegacyVersions`.
export const LEGACY_VERSION_SUFFIX = "+from-0.2";

/** What {@link QuestionService.upgradeLegacyVersions} did, version by version. */
export type LegacyUpgradeReport = {
	upgraded: number;
	current: number;
	failed: { id: number; slug: string; reason: string }[];
};

/// The service `buildQuestionService` makes, with `findOne` and `findMany` overloaded on `filter.public` to narrow the view they return.
type QuestionServiceBuilt = ReturnType<typeof buildQuestionService>;

/** The question service, as built by {@link makeQuestionService}. */
export type QuestionService = Omit<
	QuestionServiceBuilt,
	"findOne" | "findMany"
> & {
	findOne: {
		(
			filter: QuestionFindOneFilter & { public: true },
			opts: ServiceOpts,
		): Promise<QuestionPublic | null>;
		(
			filter: QuestionFindOneFilter & { public: false },
			opts: ServiceOpts,
		): Promise<Question | null>;
		(
			filter: QuestionFindOneFilter,
			opts: ServiceOpts,
		): Promise<QuestionView | null>;
	};
	findMany: {
		(
			filter: QuestionFilter & { public: true },
			opts: ServiceOpts,
		): Promise<QuestionPublic[]>;
		(
			filter: QuestionFilter & { public: false },
			opts: ServiceOpts,
		): Promise<Question[]>;
		(filter: QuestionFilter, opts: ServiceOpts): Promise<QuestionView[]>;
	};
};

/** The question service of `client` (the shared client by default). */
export const makeQuestionService = (
	...args: Parameters<typeof buildQuestionService>
): QuestionService =>
	buildQuestionService(...args) as unknown as QuestionService;

//
// Auxiliary functions
//

/**
 * Prisma `where` fragment implementing the same read rule as the question permissions.
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
		rev: row.rev,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		// The private column holds the whole document, validated on the way in.
		question: latest.privatePayload as unknown as QuestionDocument,
	};
}

/** Converts a database row into the public form, the only half a student-safe read fetches. */
function fromDbPublic(row: DbQuestionPublic): QuestionPublic {
	const latest = valueOrNotFound("question-version", row.latest);

	return {
		id: row.id,
		slug: row.slug,
		status: row.status,
		version: latest.versionHash,
		rev: row.rev,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		question: latest.publicPayload as unknown as Exclude<
			PublicQuestion,
			{ type: "code" }
		>,
	};
}

/** The `where` matching whichever of the primary keys `filter` carries. */
function refWhere(filter: QuestionPK): Prisma.QuestionRefWhereInput {
	if ("id" in filter) return { id: filter.id };
	if ("publicId" in filter) return { publicId: filter.publicId };

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

/** Finds the course a question is written to, refusing an actor who may not write its content. */
async function writableCourse(
	tx: PrismaTx,
	ref: QuestionCreate["course"],
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
 * Who sees the question at all is decided as on reads.
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
				course: questionInclude().course,
			},
		}),
	);

	requireAccess(
		questionAccess(actor, ref, await isPinned(tx, ref)),
		"write",
		action,
	);
	return ref;
}

/// Whether an exam pins the question; only a hidden or archived one can be told apart by it.
async function isPinned(
	tx: PrismaTx,
	row: { id: number; status: QuestionStatus },
): Promise<boolean> {
	if (row.status !== "HIDDEN" && row.status !== "ARCHIVED") return false;
	return (
		(await tx.questionsForExam.count({ where: { questionRefId: row.id } })) > 0
	);
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
				rev: fields.rev,
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
	// The ids are written into the stored document, since responses address
	// choices by id and grading never derives them. Round-tripped through JSON
	// so it compares equal to what the column hands back.
	const document = withIds(input.question);
	const halves = JSON.parse(
		JSON.stringify({
			publicPayload: publicForm(document),
			privatePayload: document,
		}),
	) as {
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
			message: m.errors_question_version_conflict({
				version: input.version,
				slug: ref.slug,
			}),
		});
	}

	const version = await tx.questionData.create({
		data: {
			refId: ref.id,
			versionHash: input.version,
			title: document.title ?? ref.slug,
			stem: document.stem,
			...halves,
		},
	});
	return version.id;
}

/**
 * Refuses a document whose fields are individually valid but break a model
 * rule of the mdq spec — a fill-in stem naming a blank it never defines, for one.
 *
 * The Zod schema on the way in checks one field at a time; a document that
 * breaks one of these rules is a question nobody can answer.
 */
function assertWellFormed(data: Question["question"]): void {
	const problems = questionProblems(data);
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
