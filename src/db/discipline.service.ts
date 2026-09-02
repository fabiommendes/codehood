import { canManageDisciplines } from "@/auth/permissions";
import { DISCIPLINE_SLUG_RE, RESERVED_SLUGS } from "@/utils/course-url";
import type { FillUndefineds } from "@/utils/types";
import {
	type Create,
	type Delete,
	type FindMany,
	type FindOne,
	ForbiddenError,
	type ServiceOpts,
	type Update,
} from "./base-service";
import { type Discipline, type PrismaClient, prisma } from "./client";

export interface CreateDiscipline {
	slug: string;
	name: string;
}

export type FindDisciplineBy = FillUndefineds<{ slug: string }>;

export interface FindDisciplinesBy {
	slugs?: string[];
}

export interface DisciplineFilter {
	slug: string;
}

/**
 * The editable fields. `slug` is deliberately absent: it is the first segment
 * of every course URL under this discipline (see
 * `docs/design/url-structure.md`), so changing it would move every one of those
 * courses without touching a row.
 */
export interface UpdateDiscipline {
	name: string;
}

/**
 * Every discipline is public — there is no catalog-visibility rule — so
 * `findMany` stays on the plain interface. Only `create` carries a rule,
 * because a discipline slug occupies the root URL namespace shared with
 * every system route (see `docs/design/url-structure.md`).
 */
class DisciplineService
	implements
	FindOne<FindDisciplineBy, Discipline>,
	FindMany<FindDisciplinesBy, Discipline>,
	Create<CreateDiscipline, Discipline>,
	Update<DisciplineFilter, UpdateDiscipline, Discipline>,
	Delete<DisciplineFilter> {
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	findOne(
		filter: FindDisciplineBy,
		opts?: ServiceOpts,
	): Promise<Discipline | null> {
		const client = opts?.tx ?? this.prisma;
		return client.discipline.findUnique({ where: { slug: filter.slug } });
	}

	findMany(
		filter: FindDisciplinesBy,
		opts?: ServiceOpts,
	): Promise<Discipline[]> {
		const client = opts?.tx ?? this.prisma;
		return client.discipline.findMany({
			where: filter.slugs ? { slug: { in: filter.slugs } } : undefined,
			orderBy: { name: "asc" },
		});
	}

	async create(
		input: CreateDiscipline,
		opts: ServiceOpts,
	): Promise<Discipline> {
		if (!canManageDisciplines(opts.actor)) {
			throw new ForbiddenError();
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

	async update(
		filter: DisciplineFilter,
		fields: UpdateDiscipline,
		opts: ServiceOpts,
	): Promise<Discipline> {
		if (!canManageDisciplines(opts.actor)) {
			throw new ForbiddenError();
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
	 * Refuses a discipline that still has courses or questions. The foreign
	 * keys would raise anyway; checking first is what turns a constraint error
	 * into a message naming what is in the way.
	 */
	async delete(filter: DisciplineFilter, opts: ServiceOpts): Promise<void> {
		if (!canManageDisciplines(opts.actor)) {
			throw new ForbiddenError();
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
