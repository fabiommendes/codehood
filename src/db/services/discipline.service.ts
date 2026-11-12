import type { z } from "zod";
import type { Actor } from "@/auth/actor";
import { ensurePerm } from "@/auth/permissions";
import { FieldError, NotAllowed, NotFound } from "@/core/error";
import {
	disciplineCreate,
	disciplineFilter,
	disciplinePK,
	disciplineSchema,
	disciplineUpdate,
} from "@/core/schemas";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import {
	checkExpectedUpdatedAt,
	checkVersion,
	guardedDelete,
	guardedUpdate,
} from "@/db/conditional-write";
import { defineService, op } from "@/db/define-service";
import { m } from "@/i18n";
import { DISCIPLINE_SLUG_RE, RESERVED_SLUGS } from "@/urls";
import type { PrismaTx } from "../client";

//
// Type definitions
//
export type DisciplineCreate = z.infer<typeof disciplineCreate>;
export type Discipline = z.infer<typeof disciplineSchema>;
export type DisciplineFilter = z.infer<typeof disciplineFilter>;
export type DisciplinePK = z.infer<typeof disciplinePK>;
export type DisciplineUpdate = z.infer<typeof disciplineUpdate>;

/// The CRUD shape of the discipline service.
type DisciplineT = {
	entity: Discipline;
	pkFilter: DisciplinePK;
	create: DisciplineCreate;
	filter: DisciplineFilter;
	update: DisciplineUpdate;
};

/**
 * Every discipline is public — there is no catalog-visibility rule — so
 * `findOne`/`findMany` carry no permission rule.
 *
 * Only `create`/`update`/`delete` carry a rule, because a discipline slug
 * occupies the root URL namespace shared with every system route (see
 * `src/urls/README.md`).
 */
export const makeDisciplineService = defineService<DisciplineT>()(() => {
	/**
	 * Creates a discipline.
	 *
	 * Rejects a slug that doesn't match `DISCIPLINE_SLUG_RE` or that names a
	 * reserved route — a discipline slug occupies the root URL namespace
	 * shared with every system route.
	 */
	const create = op({
		args: [disciplineCreate],
		returns: disciplineSchema,
		run: async (
			tx: PrismaTx,
			input: DisciplineCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<Discipline> => {
			assertCanWriteDiscipline(opts.actor, input.slug, "discipline.create");
			try {
				return await tx.discipline.create({
					data: { slug: input.slug, name: input.name },
				});
			} catch (error) {
				if ((error as { code?: string }).code === "P2002") {
					throw new FieldError(
						"slug",
						m.errors_slug_taken({ slug: input.slug }),
					);
				}
				throw error;
			}
		},
	});

	/** Finds a single discipline by slug. */
	const findOne = op({
		transaction: false,
		args: [disciplinePK],
		returns: disciplineSchema.nullable(),
		run: async (
			tx: PrismaTx,
			filter: DisciplinePK,
			_opts: ServiceOptsWithoutTx,
		): Promise<Discipline | null> =>
			tx.discipline.findUnique({ where: { slug: filter.slug } }),
	});

	/** Finds many disciplines, optionally narrowed to `filter.slugs`. */
	const findMany = op({
		transaction: false,
		args: [disciplineFilter],
		returns: disciplineSchema.array(),
		run: async (
			tx: PrismaTx,
			filter: DisciplineFilter,
			_opts: ServiceOptsWithoutTx,
		): Promise<Discipline[]> =>
			tx.discipline.findMany({
				where: filter.slugs ? { slug: { in: filter.slugs } } : undefined,
				orderBy: { name: "asc" },
			}),
	});

	/**
	 * Updates a discipline's name.
	 *
	 * `slug` is not editable: it is the first segment of every course URL
	 * under this discipline (see `src/urls/README.md`), so
	 * changing it would move every one of those courses without touching a
	 * row.
	 */
	const update = op({
		args: [disciplinePK, disciplineUpdate],
		returns: disciplineSchema,
		run: async (
			tx: PrismaTx,
			filter: DisciplinePK,
			fields: DisciplineUpdate,
			opts: ServiceOptsWithoutTx,
		): Promise<Discipline> => {
			assertCanWriteDiscipline(opts.actor, filter.slug, "discipline.update");
			const current = await tx.discipline.findUnique({
				where: { slug: filter.slug },
			});
			if (!current) {
				checkExpectedUpdatedAt(null, opts.expectedUpdatedAt);
				throw new NotFound("discipline", {
					id: filter.slug,
					message: m.errors_discipline_not_found({ slug: filter.slug }),
				});
			}
			return guardedUpdate(
				tx,
				"discipline",
				{ slug: filter.slug },
				{ name: fields.name },
				opts,
			);
		},
	});

	/**
	 * Upserts a discipline keyed on `slug`: creates it if absent, else updates
	 * its `name`.
	 *
	 * Same permission and slug-validation rule as `create`/`update`, run once
	 * via {@link assertCanWriteDiscipline} regardless of which branch Prisma
	 * takes.
	 */
	const upsert = op({
		args: [disciplineCreate],
		returns: disciplineSchema,
		run: async (
			tx: PrismaTx,
			input: DisciplineCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<Discipline> => {
			assertCanWriteDiscipline(opts.actor, input.slug, "discipline.create");
			const current = await tx.discipline.findUnique({
				where: { slug: input.slug },
			});
			if (!current) {
				checkExpectedUpdatedAt(null, opts.expectedUpdatedAt);
				return tx.discipline.create({
					data: { slug: input.slug, name: input.name },
				});
			}
			return guardedUpdate(
				tx,
				"discipline",
				{ slug: input.slug },
				{ name: input.name },
				opts,
			);
		},
	});

	/**
	 * Deletes a discipline.
	 *
	 * Refuses one that still has courses. The foreign key would raise anyway;
	 * checking first is what turns a constraint error into a message naming
	 * what is in the way. Questions hang off a course, so a discipline with no
	 * courses has none.
	 */
	const remove = op({
		args: [disciplinePK],
		run: async (
			tx: PrismaTx,
			filter: DisciplinePK,
			opts: ServiceOptsWithoutTx,
		): Promise<void> => {
			ensurePerm(opts.actor, "discipline.delete");
			const where = { slug: filter.slug };
			await checkVersion(tx, "discipline", where, opts);
			const courses = await tx.course.count({
				where: { disciplineSlug: filter.slug },
			});
			if (courses > 0) {
				throw new NotAllowed("discipline.delete", {
					status: 409,
					message: m.errors_discipline_has_courses({
						slug: filter.slug,
						count: courses,
					}),
				});
			}
			await guardedDelete(tx, "discipline", where, opts);
		},
	});

	return { create, findOne, findMany, update, upsert, delete: remove };
});

/** The discipline service, as built by {@link makeDisciplineService}. */
export type DisciplineService = ReturnType<typeof makeDisciplineService>;

//
// Auxiliary functions
//

/**
 * Enforces the `action` permission and rejects a slug that doesn't
 * match {@link DISCIPLINE_SLUG_RE} or that names a reserved route.
 *
 * Shared by `create`/`update`/`upsert`: a discipline slug occupies the root
 * URL namespace shared with every system route, so every write path carries
 * the same rule.
 */
function assertCanWriteDiscipline(
	actor: Actor,
	slug: string,
	action: "discipline.create" | "discipline.update",
): void {
	ensurePerm(actor, action);
	if (!DISCIPLINE_SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) {
		throw new FieldError(
			"slug",
			m.errors_discipline_slug_invalid({
				slug,
				pattern: String(DISCIPLINE_SLUG_RE),
			}),
		);
	}
}
