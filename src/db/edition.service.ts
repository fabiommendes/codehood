import { canManageEditions } from "@/auth/permissions";
import { EDITION_RE } from "@/utils/course-url";
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
import { type Edition, type PrismaClient, prisma } from "./client";

export interface CreateEdition {
	slug: string;
	name: string;
	startAt: Date;
	endAt: Date;
}

export type FindEditionBy = FillUndefineds<{ slug: string }>;

export interface FindEditionsBy {
	slugs?: string[];
	/** Only editions whose window contains now — what a course-creation form needs. */
	active?: boolean;
}

export interface UpdateEditionFilter {
	slug: string;
}

/**
 * The editable fields. `slug` is deliberately absent: it is the token in every
 * course URL under this edition (see `docs/design/url-structure.md`), so
 * changing it would move every one of those courses without touching a row.
 */
export interface UpdateEdition {
	name?: string;
	startAt?: Date;
	endAt?: Date;
}

export interface DeleteEditionFilter {
	slug: string;
}

/**
 * Every user sees every edition — they are labels on courses, not secrets — so
 * the read methods stay on the plain interfaces. Only the writes carry a rule,
 * because an edition slug occupies part of the course URL namespace and is
 * shared by every instructor teaching that term.
 */
class EditionService
	implements
	Create<CreateEdition, Edition>,
	FindOne<FindEditionBy, Edition>,
	FindMany<FindEditionsBy, Edition>,
	Update<UpdateEditionFilter, UpdateEdition, Edition>,
	Delete<DeleteEditionFilter> {
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	async create(input: CreateEdition, opts: ServiceOpts): Promise<Edition> {
		if (!canManageEditions(opts.actor)) {
			throw new ForbiddenError();
		}
		if (!EDITION_RE.test(input.slug)) {
			throw new Error(
				`"${input.slug}" is not a valid edition slug: it should be a URL-safe name with no spaces, e.g. 2026 or 2026-1.`,
			);
		}
		assertWindow(input.startAt, input.endAt);
		const client = opts.tx ?? this.prisma;
		return client.edition.create({
			data: {
				slug: input.slug,
				name: input.name,
				startAt: input.startAt,
				endAt: input.endAt,
			},
		});
	}

	findOne(
		filter: FindEditionBy,
		opts?: ServiceOpts,
	): Promise<Edition | null> {
		const client = opts?.tx ?? this.prisma;
		return client.edition.findUnique({ where: { slug: filter.slug } });
	}

	findMany(
		filter: FindEditionsBy,
		opts?: ServiceOpts,
	): Promise<Edition[]> {
		const client = opts?.tx ?? this.prisma;
		const now = new Date();
		return client.edition.findMany({
			where: {
				AND: [
					filter.slugs ? { slug: { in: filter.slugs } } : {},
					filter.active ? { startAt: { lte: now }, endAt: { gte: now } } : {},
				],
			},
			orderBy: { slug: "desc" },
		});
	}

	async update(
		filter: UpdateEditionFilter,
		fields: UpdateEdition,
		opts: ServiceOpts,
	): Promise<Edition> {
		if (!canManageEditions(opts.actor)) {
			throw new ForbiddenError();
		}
		const client = opts.tx ?? this.prisma;
		const current = await client.edition.findUnique({
			where: { slug: filter.slug },
		});
		if (!current) {
			throw new Error(`No edition with slug "${filter.slug}".`);
		}
		assertWindow(
			fields.startAt ?? current.startAt,
			fields.endAt ?? current.endAt,
		);
		return client.edition.update({
			where: { slug: filter.slug },
			data: fields,
		});
	}

	/**
	 * Refuses an edition that still has courses. The foreign key would raise
	 * anyway; checking first is what turns a constraint error into a message
	 * naming how many courses are in the way.
	 */
	async delete(filter: DeleteEditionFilter, opts: ServiceOpts): Promise<void> {
		if (!canManageEditions(opts.actor)) {
			throw new ForbiddenError();
		}
		const client = opts.tx ?? this.prisma;
		const courses = await client.course.count({
			where: { editionSlug: filter.slug },
		});
		if (courses > 0) {
			throw new Error(
				`Edition "${filter.slug}" still has ${courses} course(s) and cannot be deleted.`,
			);
		}
		await client.edition.deleteMany({ where: { slug: filter.slug } });
	}
}

function assertWindow(startAt: Date, endAt: Date): void {
	if (startAt >= endAt) {
		throw new Error("An edition's startAt must be before its endAt.");
	}
}

/** Whether `edition`'s active window contains `at` (default: now). */
export function isEditionOpen(
	edition: Pick<Edition, "startAt" | "endAt">,
	at: Date = new Date(),
): boolean {
	return edition.startAt <= at && at <= edition.endAt;
}

export const editionService = new EditionService();
export type { Edition };
