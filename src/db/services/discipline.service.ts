import type { z } from "zod";
import type { Actor } from "@/auth/actor";
import { ensurePerm } from "@/auth/permissions";
import {
	disciplineCreate,
	disciplineFilter,
	disciplinePK,
	disciplineSchema,
	disciplineUpdate,
	disciplineUpsert,
} from "@/core/schemas";
import type { Crud, ServiceOpts } from "@/db/base-service";
import { DISCIPLINE_SLUG_RE, RESERVED_SLUGS } from "@/urls";
import { Validate } from "@/utils/validate";
import { type PrismaClient, prisma } from "../client";

//
// Type definitions
//
export type DisciplineCreate = z.infer<typeof disciplineCreate>;
export type Discipline = z.infer<typeof disciplineSchema>;
export type DisciplineFilter = z.infer<typeof disciplineFilter>;
export type DisciplinePK = z.infer<typeof disciplinePK>;
export type DisciplineUpdate = z.infer<typeof disciplineUpdate>;
export type DisciplineUpsert = z.infer<typeof disciplineUpsert>;

/**
 * Every discipline is public — there is no catalog-visibility rule — so
 * `findOne`/`findMany` take no permission-gated `opts`.
 *
 * Only `create`/`update`/`delete` carry a rule, because a discipline slug
 * occupies the root URL namespace shared with every system route (see
 * `docs/design/url-structure.md`).
 */
export class DisciplineService
	implements
		Crud<{
			entity: Discipline;
			pkFilter: DisciplinePK;
			create: DisciplineCreate;
			filter: DisciplineFilter;
			update: DisciplineUpdate;
			upsert: DisciplineUpsert;
		}>
{
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
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
		assertCanWriteDiscipline(opts.actor, input.slug, "discipline.create");
		const client = opts.tx ?? this.prisma;
		return client.discipline.create({
			data: { slug: input.slug, name: input.name },
		});
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
		assertCanWriteDiscipline(opts.actor, filter.slug, "discipline.update");
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
	 * Upserts a discipline keyed on `slug`: creates it if absent, else updates
	 * its `name`.
	 *
	 * Same permission and slug-validation rule as `create`/`update`, run once
	 * via {@link assertCanWriteDiscipline} regardless of which branch Prisma
	 * takes.
	 */
	@Validate({
		service: true,
		returns: disciplineSchema,
		args: [disciplineUpsert],
	})
	upsert(input: DisciplineUpsert, opts: ServiceOpts): Promise<Discipline> {
		assertCanWriteDiscipline(opts.actor, input.slug, "discipline.create");
		const client = opts.tx ?? this.prisma;
		return client.discipline.upsert({
			where: { slug: input.slug },
			update: { name: input.name },
			create: { slug: input.slug, name: input.name },
		});
	}

	/**
	 * Deletes a discipline.
	 *
	 * Refuses one that still has courses. The foreign key would raise anyway;
	 * checking first is what turns a constraint error into a message naming
	 * what is in the way. Questions hang off a course, so a discipline with no
	 * courses has none.
	 */
	@Validate({ service: true, args: [disciplinePK] })
	async delete(filter: DisciplinePK, opts: ServiceOpts): Promise<void> {
		ensurePerm(opts.actor, "discipline.delete");
		const client = opts.tx ?? this.prisma;
		const courses = await client.course.count({
			where: { disciplineSlug: filter.slug },
		});
		if (courses > 0) {
			throw new Error(
				`Discipline "${filter.slug}" still has ${courses} course(s) and cannot be deleted.`,
			);
		}
		await client.discipline.deleteMany({ where: { slug: filter.slug } });
	}
}

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
		throw new Error(
			`"${slug}" is not a valid discipline slug: it must match ${DISCIPLINE_SLUG_RE} and not be a reserved name.`,
		);
	}
}
