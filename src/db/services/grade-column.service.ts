/**
 * The grade columns an instructor pushes to a course.
 *
 * A column is written whole: its values travel inside it and have no service
 * of their own. Writes need the `course.update-contents` permission. Whoever
 * holds it reads every column with every value; a student who may read the
 * course's contents reads released columns only, each with their own value.
 */
import type { z } from "zod";
import { hasPerm } from "@/auth/permissions";
import {
	InvalidData,
	type InvalidDataErrors,
	NotAllowed,
	NotFound,
} from "@/core/error";
import {
	type CourseId,
	type GradeColumnId,
	gradeColumnCreate,
	gradeColumnFilter,
	gradeColumnPK,
	gradeColumnSchema,
	gradeColumnUpdate,
} from "@/core/schemas";
import {
	CrudBase,
	type ServiceOpts,
	type ServiceOptsWithoutTx,
} from "@/db/base-service";
import { Validate } from "@/utils/validate";
import type { Prisma, PrismaTx } from "../client";
import { courseRefWhere, invalidIfExists, valueOrNotFound } from "../utils";

export type { GradeColumnId } from "@/core/schemas";

//
// Type definitions
//
export type GradeColumnCreate = z.infer<typeof gradeColumnCreate>;
export type GradeColumn = z.infer<typeof gradeColumnSchema>;
export type GradeColumnFilter = z.infer<typeof gradeColumnFilter>;
export type GradeColumnPK = z.infer<typeof gradeColumnPK>;
export type GradeColumnUpdate = z.infer<typeof gradeColumnUpdate>;

type GradeColumnKind = GradeColumn["kind"];
type GradeValueInput = GradeColumnCreate["values"][number];

/// The course shape the permission predicates need.
const courseSelect = {
	id: true,
	instructor: { select: { username: true } },
	enrollments: {
		where: { status: "ACTIVE" as const },
		select: { username: true },
	},
} satisfies Prisma.CourseSelect;

/// A column row without values, with the course the predicates need.
const columnSelect = {
	id: true,
	courseId: true,
	slug: true,
	title: true,
	kind: true,
	position: true,
	releasedAt: true,
	rev: true,
	createdAt: true,
	updatedAt: true,
	course: { select: courseSelect },
} satisfies Prisma.GradeColumnSelect;

type DbColumn = Prisma.GradeColumnGetPayload<{ select: typeof columnSelect }>;
type DbValue = {
	username: string;
	number: number | null;
	label: string | null;
};

export class GradeColumnService extends CrudBase<{
	entity: GradeColumn;
	pkFilter: GradeColumnPK;
	create: GradeColumnCreate;
	filter: GradeColumnFilter;
	update: GradeColumnUpdate;
}> {
	/**
	 * Creates a column, with its values, hidden from students.
	 *
	 * @throws {@link InvalidData} If a value does not fit the kind, or a username is not enrolled.
	 */
	@Validate({
		service: true,
		returns: gradeColumnSchema,
		args: [undefined, gradeColumnCreate],
	})
	protected async createTx(
		tx: PrismaTx,
		input: GradeColumnCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<GradeColumn> {
		const course = await writableCourse(
			tx,
			input.course,
			opts.actor,
			"grade-column.create",
		);
		checkValuesFit(input.kind, input.values);
		await checkEnrolled(tx, course.id, input.values);

		const row = await invalidIfExists(
			tx.gradeColumn.create.bind(tx.gradeColumn),
			{
				data: {
					courseId: course.id,
					slug: input.slug,
					title: input.title,
					kind: input.kind,
					position: input.position,
					rev: input.rev ?? null,
				},
				select: { id: true },
			},
		);
		await replaceValues(tx, row.id, input.kind, input.values);
		return readWhole(tx, row.id);
	}

	/**
	 * Finds a column by id or by course and slug.
	 *
	 * Returns `null` for a column that does not exist and for a hidden column
	 * the actor may not see.
	 *
	 * @throws {@link NotFound} If the filter references a course that does not exist.
	 * @throws {@link NotAllowed} If the column exists but the actor may not read the course.
	 */
	@Validate({
		service: true,
		returns: gradeColumnSchema.nullable(),
		args: [undefined, gradeColumnPK],
	})
	protected async findOneTx(
		tx: PrismaTx,
		filter: GradeColumnPK,
		opts: ServiceOptsWithoutTx,
	): Promise<GradeColumn | null> {
		const row = await tx.gradeColumn.findFirst({
			where: columnWhere(filter),
			select: columnSelect,
		});
		if (!row) {
			if (!("id" in filter)) {
				valueOrNotFound(
					"course",
					await tx.course.findUnique({
						where: courseRefWhere(filter.course),
						select: { id: true },
					}),
				);
			}
			return null;
		}

		const access = accessTo(opts.actor, row.course);
		if (access === "none") throw new NotAllowed("grade-column.read");
		if (access === "released" && !row.releasedAt) return null;
		return fromDb(row, await loadValues(tx, row.id, access, opts.actor));
	}

	/**
	 * Lists the columns of one course, ordered by position then slug.
	 *
	 * A student gets released columns only, each with their own value alone.
	 *
	 * @throws {@link NotFound} If the course does not exist.
	 * @throws {@link NotAllowed} If the actor may not read the course.
	 */
	@Validate({
		service: true,
		returns: gradeColumnSchema.array(),
		args: [undefined, gradeColumnFilter],
	})
	protected async findManyTx(
		tx: PrismaTx,
		filter: GradeColumnFilter,
		opts: ServiceOptsWithoutTx,
	): Promise<GradeColumn[]> {
		const course = valueOrNotFound(
			"course",
			await tx.course.findUnique({
				where: courseRefWhere(filter.course),
				select: courseSelect,
			}),
		);
		const access = accessTo(opts.actor, course);
		if (access === "none") throw new NotAllowed("grade-column.read");

		const rows = await tx.gradeColumn.findMany({
			where: {
				courseId: course.id,
				...(access === "released" ? { releasedAt: { not: null } } : {}),
			},
			select: {
				...columnSelect,
				values: {
					...(access === "released"
						? { where: { username: actorUsername(opts.actor) } }
						: {}),
					select: { username: true, number: true, label: true },
					orderBy: { username: "asc" },
				},
			},
			orderBy: [{ position: "asc" }, { slug: "asc" }],
		});
		return rows.map(({ values, ...row }) => fromDb(row, values));
	}

	/**
	 * Updates a column. Never `slug` or `releasedAt`.
	 *
	 * `values`, when given, replaces the stored set. Changing `kind` needs `values`.
	 *
	 * @throws {@link InvalidData} If a value does not fit the kind, a username is not enrolled, or `kind` changes without `values`.
	 */
	@Validate({
		service: true,
		returns: gradeColumnSchema,
		args: [undefined, gradeColumnPK, gradeColumnUpdate],
	})
	protected async updateTx(
		tx: PrismaTx,
		filter: GradeColumnPK,
		fields: GradeColumnUpdate,
		opts: ServiceOptsWithoutTx,
	): Promise<GradeColumn> {
		const current = await writableColumn(
			tx,
			filter,
			opts.actor,
			"grade-column.update",
		);
		const kind = fields.kind ?? current.kind;
		if (fields.values) {
			checkValuesFit(kind, fields.values);
			await checkEnrolled(tx, current.courseId, fields.values);
		} else if (kind !== current.kind) {
			throw new InvalidData({
				kind: [
					{
						code: "invalid",
						message: "Changing the kind of a column needs its values.",
					},
				],
			});
		}

		await tx.gradeColumn.update({
			where: { id: current.id },
			data: {
				title: fields.title,
				kind: fields.kind,
				position: fields.position,
				rev: fields.rev,
			},
		});
		if (fields.values) {
			await replaceValues(tx, current.id, kind, fields.values);
		}
		return readWhole(tx, current.id);
	}

	/**
	 * Creates the column, or updates it when its course and slug exist.
	 *
	 * Replaces the values whole either way.
	 */
	@Validate({
		service: true,
		returns: gradeColumnSchema,
		args: [undefined, gradeColumnCreate],
	})
	protected async upsertTx(
		tx: PrismaTx,
		input: GradeColumnCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<GradeColumn> {
		const course = await writableCourse(
			tx,
			input.course,
			opts.actor,
			"grade-column.create",
		);
		const scoped = { ...opts, tx };

		const existing = await tx.gradeColumn.findUnique({
			where: { courseId_slug: { courseId: course.id, slug: input.slug } },
			select: { id: true },
		});
		if (!existing) return this.create({ ...input, course: course.id }, scoped);

		const { slug: _slug, course: _course, ...fields } = input;
		return this.update({ id: existing.id as GradeColumnId }, fields, scoped);
	}

	/**
	 * Deletes a column and its values.
	 *
	 * @throws {@link NotFound} If the column does not exist.
	 */
	@Validate({ service: true, args: [undefined, gradeColumnPK] })
	protected async deleteTx(
		tx: PrismaTx,
		filter: GradeColumnPK,
		opts: ServiceOptsWithoutTx,
	): Promise<void> {
		const current = await writableColumn(
			tx,
			filter,
			opts.actor,
			"grade-column.delete",
		);
		await tx.gradeColumn.delete({ where: { id: current.id } });
	}

	/**
	 * Releases a column to its students now.
	 *
	 * Sets `releasedAt` to the current time. Calling it again on a released
	 * column returns it unchanged.
	 *
	 * @throws {@link NotFound} If the column does not exist or `actor` may not see it.
	 * @throws {@link NotAllowed} If `actor` may not write the course's contents.
	 */
	@Validate({
		service: true,
		returns: gradeColumnSchema,
		args: [gradeColumnPK],
	})
	release<Opt extends ServiceOpts>(
		filter: GradeColumnPK,
		opts: Opt,
	): Promise<GradeColumn> {
		return this.$transaction(opts, async (tx, scoped) => {
			const row = valueOrNotFound(
				"grade-column",
				await tx.gradeColumn.findFirst({
					where: columnWhere(filter),
					select: columnSelect,
				}),
			);

			const access = accessTo(scoped.actor, row.course);
			if (access !== "all") {
				const seen = access === "released" && row.releasedAt !== null;
				throw seen
					? new NotAllowed("grade-column.update")
					: new NotFound("grade-column");
			}

			if (!row.releasedAt) {
				await tx.gradeColumn.update({
					where: { id: row.id },
					data: { releasedAt: new Date() },
				});
			}
			return readWhole(tx, row.id);
		});
	}
}

//
// Auxiliary functions
//

type Access = "all" | "released" | "none";

/// How much of a course's columns `actor` reads.
function accessTo(
	actor: ServiceOptsWithoutTx["actor"],
	course: Pick<DbColumn["course"], "instructor" | "enrollments">,
): Access {
	if (hasPerm(actor, "course.update-contents", course)) return "all";
	if (hasPerm(actor, "course.read-contents", course)) return "released";
	return "none";
}

/// The username a student's own values are filtered by.
function actorUsername(actor: ServiceOptsWithoutTx["actor"]): string {
	return typeof actor === "symbol" ? "" : actor.username;
}

/// The `where` matching whichever of the primary keys `filter` carries.
function columnWhere(filter: GradeColumnPK): Prisma.GradeColumnWhereInput {
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

/// Finds the course a column is written to, refusing an actor who may not write its contents.
async function writableCourse(
	tx: PrismaTx,
	ref: GradeColumnCreate["course"],
	actor: ServiceOptsWithoutTx["actor"],
	action: "grade-column.create",
) {
	const course = valueOrNotFound(
		"course",
		await tx.course.findUnique({
			where: courseRefWhere(ref),
			select: { id: true, instructor: { select: { username: true } } },
		}),
	);
	if (!hasPerm(actor, "course.update-contents", course)) {
		throw new NotAllowed(action);
	}
	return course;
}

/// Finds the column a write targets, refusing an actor who may not write its course.
async function writableColumn(
	tx: PrismaTx,
	filter: GradeColumnPK,
	actor: ServiceOptsWithoutTx["actor"],
	action: "grade-column.update" | "grade-column.delete",
) {
	const column = valueOrNotFound(
		"grade-column",
		await tx.gradeColumn.findFirst({
			where: columnWhere(filter),
			select: {
				id: true,
				courseId: true,
				kind: true,
				course: { select: { instructor: { select: { username: true } } } },
			},
		}),
	);
	if (!hasPerm(actor, "course.update-contents", column.course)) {
		throw new NotAllowed(action);
	}
	return column;
}

/// Refuses a value that does not fit `kind`, listing each offender.
function checkValuesFit(
	kind: GradeColumnKind,
	values: GradeValueInput[],
): void {
	const errors: InvalidDataErrors = {};
	values.forEach((entry, index) => {
		const { value } = entry;
		const fits =
			kind === "NUMBER"
				? typeof value === "number" && Number.isFinite(value)
				: typeof value === "string" && value.length >= 1 && value.length <= 32;
		if (fits) return;
		errors[`values.${index}.value`] = [
			{
				code: "type-mismatch",
				message:
					kind === "NUMBER"
						? `"${entry.username}" needs a finite number.`
						: `"${entry.username}" needs a label of 1 to 32 characters.`,
			},
		];
	});
	if (Object.keys(errors).length > 0) throw new InvalidData(errors);
}

/// Refuses usernames with no enrollment in the course, listing each of them.
async function checkEnrolled(
	tx: PrismaTx,
	courseId: number,
	values: GradeValueInput[],
): Promise<void> {
	if (values.length === 0) return;
	const enrolled = await tx.enrollment.findMany({
		where: {
			courseId,
			username: { in: values.map((entry) => entry.username) },
		},
		select: { username: true },
	});
	const known = new Set(enrolled.map((e) => e.username));
	const unknown = values.filter((entry) => !known.has(entry.username));
	if (unknown.length === 0) return;

	throw new InvalidData({
		values: unknown.map((entry) => ({
			code: "not-exists" as const,
			message: `"${entry.username}" is not enrolled in the course.`,
		})),
	});
}

/// Replaces the stored values of a column with `values`.
async function replaceValues(
	tx: PrismaTx,
	columnId: number,
	kind: GradeColumnKind,
	values: GradeValueInput[],
): Promise<void> {
	await tx.gradeValue.deleteMany({ where: { columnId } });
	if (values.length === 0) return;
	await tx.gradeValue.createMany({
		data: values.map((entry) => ({
			columnId,
			username: entry.username,
			number: kind === "NUMBER" ? (entry.value as number) : null,
			label: kind === "LABEL" ? (entry.value as string) : null,
		})),
	});
}

/// Reads a column back with every value, ordered by username.
async function readWhole(
	tx: PrismaTx,
	id: GradeColumnId,
): Promise<GradeColumn> {
	const { values, ...row } = await tx.gradeColumn.findUniqueOrThrow({
		where: { id },
		select: {
			...columnSelect,
			values: {
				select: { username: true, number: true, label: true },
				orderBy: { username: "asc" },
			},
		},
	});
	return fromDb(row, values);
}

/// Loads a column's values, narrowed in the query to the actor's own for a student.
function loadValues(
	tx: PrismaTx,
	columnId: number,
	access: Access,
	actor: ServiceOptsWithoutTx["actor"],
): Promise<DbValue[]> {
	return tx.gradeValue.findMany({
		where: {
			columnId,
			...(access === "released" ? { username: actorUsername(actor) } : {}),
		},
		select: { username: true, number: true, label: true },
		orderBy: { username: "asc" },
	});
}

/// Converts a database row and its values into the column entity.
function fromDb(
	row: Omit<DbColumn, "course"> & Partial<DbColumn>,
	values: DbValue[],
): GradeColumn {
	const { course: _course, ...rest } = row as DbColumn;
	return {
		...rest,
		id: rest.id as GradeColumnId,
		courseId: rest.courseId as CourseId,
		values: values.flatMap((v) => {
			const value = row.kind === "NUMBER" ? v.number : v.label;
			return value === null ? [] : [{ username: v.username, value }];
		}),
	};
}
