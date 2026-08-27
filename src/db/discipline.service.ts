import { canCreateDiscipline } from "@/auth/permissions";
import { DISCIPLINE_SLUG_RE, RESERVED_SLUGS } from "@/utils/course-url";
import {
	type ActingOpts,
	type CreateAs,
	type FindMany,
	ForbiddenError,
	type ServiceMethodOpts,
} from "./base-service";
import { type Discipline, type PrismaClient, prisma } from "./client";

export interface CreateDiscipline {
	slug: string;
	name: string;
}

export interface FindDisciplinesBy {
	slugs?: string[];
}

/**
 * Every discipline is public — there is no catalog-visibility rule — so
 * `findMany` stays on the plain interface. Only `create` carries a rule,
 * because a discipline slug occupies the root URL namespace shared with
 * every system route (see `docs/design/url-structure.md`).
 */
class DisciplineService
	implements
		FindMany<FindDisciplinesBy, Discipline>,
		CreateAs<CreateDiscipline, Discipline>
{
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	findMany(
		filter: FindDisciplinesBy,
		opts?: ServiceMethodOpts,
	): Promise<Discipline[]> {
		const client = opts?.tx ?? this.prisma;
		return client.discipline.findMany({
			where: filter.slugs ? { slug: { in: filter.slugs } } : undefined,
			orderBy: { name: "asc" },
		});
	}

	async create(input: CreateDiscipline, opts: ActingOpts): Promise<Discipline> {
		if (!canCreateDiscipline(opts.actor)) {
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
}

export const disciplineService = new DisciplineService();
