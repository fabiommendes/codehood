import type { z } from "zod";
import { canManageDisciplines } from "@/auth/permissions";
import { NotAllowed } from "@/core/error";
import { DISCIPLINE_SLUG_RE, RESERVED_SLUGS } from "@/utils/course-url";
import { Validate } from "@/utils/validate";
import {
	disciplineCreate,
	disciplineFilter,
	disciplinePK,
	disciplineSchema,
	disciplineUpdate,
} from "../../core/schemas";
import type { Crud, ServiceOpts } from "../base-service";
import { type PrismaClient, prisma } from "../client";

//
// Type definitions
//
export type DisciplineCreate = z.infer<typeof disciplineCreate>;
export type Discipline = z.infer<typeof disciplineSchema>;
export type DisciplineFilter = z.infer<typeof disciplineFilter>;
export type DisciplinePK = z.infer<typeof disciplinePK>;
export type DisciplineUpdate = z.infer<typeof disciplineUpdate>;

/**
 * Every discipline is public — there is no catalog-visibility rule — so
 * `findOne`/`findMany` take no permission-gated `opts`.
 *
 * Only `create`/`update`/`delete` carry a rule, because a discipline slug
 * occupies the root URL namespace shared with every system route (see
 * `docs/design/url-structure.md`).
 */
class DisciplineService
	implements
	Crud<{
		entity: Discipline;
		pkFilter: DisciplinePK;
		create: DisciplineCreate;
		filter: DisciplineFilter;
		update: DisciplineUpdate;
	}> {
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Finds a single discipline by slug.
	 */
	@Validate({
		async: true,
		returns: disciplineSchema.nullable(),
		args: [disciplinePK],
	})
	findOne(
		filter: DisciplinePK,
		opts?: ServiceOpts,
	): Promise<Discipline | null> {
		const client = opts?.tx ?? this.prisma;
		return client.discipline.findUnique({ where: { slug: filter.slug } });
	}

	/**
	 * Finds many disciplines, optionally narrowed to `filter.slugs`.
	 */
	@Validate({
		async: true,
		returns: disciplineSchema.array(),
		args: [disciplineFilter],
	})
	findMany(
		filter: DisciplineFilter,
		opts?: ServiceOpts,
	): Promise<Discipline[]> {
		const client = opts?.tx ?? this.prisma;
		return client.discipline.findMany({
			where: filter.slugs ? { slug: { in: filter.slugs } } : undefined,
			orderBy: { name: "asc" },
		});
	}

	/**
	 * Creates a discipline.
	 *
	 * Rejects a slug that doesn't match `DISCIPLINE_SLUG_RE` or that names a
	 * reserved route — a discipline slug occupies the root URL namespace
	 * shared with every system route.
	 */
	@Validate({
		service: true,
		returns: disciplineSchema,
		args: [disciplineCreate],
	})
	async create(
		input: DisciplineCreate,
		opts: ServiceOpts,
	): Promise<Discipline> {
		if (!canManageDisciplines(opts.actor)) {
			throw new NotAllowed({ action: "create-discipline" });
		}
		if (
			!DISCIPLINE_SLUG_RE.test(input.slug) ||
			RESERVED_SLUGS.has(input.slug)
		) {
			throw new Error(
				`"${input.slug}" is not a valid discipline slug: it must match ${DISCIPLINE_SLUG_RE} and not be a reserved name.`,
			);
		}
		const client = opts.tx ?? this.prisma;
		return client.discipline.create({
			data: { slug: input.slug, name: input.name },
		});
	}

	/**
	 * Updates a discipline's name.
	 *
	 * `slug` is not editable: it is the first segment of every course URL
	 * under this discipline (see `docs/design/url-structure.md`), so
	 * changing it would move every one of those courses without touching a
	 * row.
	 */
	@Validate({
		service: true,
		returns: disciplineSchema,
		args: [disciplinePK, disciplineUpdate],
	})
	async update(
		filter: DisciplinePK,
		fields: DisciplineUpdate,
		opts: ServiceOpts,
	): Promise<Discipline> {
		if (!canManageDisciplines(opts.actor)) {
			throw new NotAllowed({ action: "update-discipline" });
		}
		const client = opts.tx ?? this.prisma;
		const current = await client.discipline.findUnique({
			where: { slug: filter.slug },
		});
		if (!current) {
			throw new Error(`No discipline with slug "${filter.slug}".`);
		}
		return client.discipline.update({
			where: { slug: filter.slug },
			data: { name: fields.name },
		});
	}

	/**
	 * Deletes a discipline.
	 *
	 * Refuses one that still has courses or questions. The foreign keys
	 * would raise anyway; checking first is what turns a constraint error
	 * into a message naming what is in the way.
	 */
	@Validate({ service: true, args: [disciplinePK] })
	async delete(filter: DisciplinePK, opts: ServiceOpts): Promise<void> {
		if (!canManageDisciplines(opts.actor)) {
			throw new NotAllowed({ action: "delete-discipline" });
		}
		const client = opts.tx ?? this.prisma;
		const [courses, questions] = await Promise.all([
			client.course.count({ where: { disciplineSlug: filter.slug } }),
			client.questionRef.count({ where: { disciplineSlug: filter.slug } }),
		]);
		if (courses > 0 || questions > 0) {
			throw new Error(
				`Discipline "${filter.slug}" still has ${courses} course(s) and ${questions} question(s) and cannot be deleted.`,
			);
		}
		await client.discipline.deleteMany({ where: { slug: filter.slug } });
	}
}

export const disciplineService = new DisciplineService();
