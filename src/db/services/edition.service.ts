import type { z } from "zod";
import { canManageEditions } from "@/auth/permissions";
import type { Actor } from "@/core/actor";
import { type ActionCode, NotAllowed } from "@/core/error";
import { Validate } from "@/utils/validate";
import {
	editionCreate,
	editionFilter,
	editionPK,
	editionSchema,
	editionUpdate,
	editionUpsert,
} from "../../core/schemas";
import type { Crud, ServiceOpts } from "../base-service";
import { type PrismaClient, prisma } from "../client";

//
// Type definitions
//
export type EditionCreate = z.infer<typeof editionCreate>;
export type Edition = z.infer<typeof editionSchema>;
export type EditionFilter = z.infer<typeof editionFilter>;
export type EditionPK = z.infer<typeof editionPK>;
export type EditionUpdate = z.infer<typeof editionUpdate>;
export type EditionUpsert = z.infer<typeof editionUpsert>;

/**
 * Every user sees every edition — they are labels on courses, not secrets —
 * so `findOne`/`findMany` take no permission-gated `opts`.
 *
 * Only the writes carry a rule, because an edition slug occupies part of the
 * course URL namespace and is shared by every instructor teaching that term.
 */
class EditionService
	implements
		Crud<{
			entity: Edition;
			pkFilter: EditionPK;
			create: EditionCreate;
			filter: EditionFilter;
			update: EditionUpdate;
			upsert: EditionUpsert;
		}>
{
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Creates an edition.
	 *
	 * Rejects a slug that doesn't match `EDITION_RE`, and a window where
	 * `startAt` is not before `endAt`.
	 */
	@Validate({ service: true, returns: editionSchema, args: [editionCreate] })
	async create(input: EditionCreate, opts: ServiceOpts): Promise<Edition> {
		const client = opts.tx ?? this.prisma;

		assertCanWriteEdition(opts.actor, "create-edition");
		assertWindow(input.startAt, input.endAt);

		return client.edition.create({
			data: {
				slug: input.slug,
				name: input.name,
				startAt: input.startAt,
				endAt: input.endAt,
			},
		});
	}

	/**
	 * Finds a single edition by slug.
	 */
	@Validate({
		async: true,
		returns: editionSchema.nullable(),
		args: [editionPK],
	})
	findOne(filter: EditionPK, opts?: ServiceOpts): Promise<Edition | null> {
		const client = opts?.tx ?? this.prisma;
		return client.edition.findUnique({ where: { slug: filter.slug } });
	}

	/**
	 * Finds many editions, optionally narrowed to `filter.slugs` and/or
	 * `filter.active`.
	 */
	@Validate({
		async: true,
		returns: editionSchema.array(),
		args: [editionFilter],
	})
	findMany(filter: EditionFilter, opts?: ServiceOpts): Promise<Edition[]> {
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

	/**
	 * Updates an edition's editable fields.
	 *
	 * `slug` is not editable: it is the token in every course URL under this
	 * edition (see `docs/design/url-structure.md`), so changing it would
	 * move every one of those courses without touching a row.
	 */
	@Validate({
		service: true,
		returns: editionSchema,
		args: [editionPK, editionUpdate],
	})
	async update(
		filter: EditionPK,
		fields: EditionUpdate,
		opts: ServiceOpts,
	): Promise<Edition> {
		assertCanWriteEdition(opts.actor, "update-edition");
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
	 * Upserts an edition keyed on `slug`: creates it if absent, else updates
	 * its editable fields.
	 *
	 * Same permission and window checks as `create`/`update`, run once via
	 * {@link assertCanWriteEdition}/{@link assertWindow} regardless of which
	 * branch Prisma takes.
	 */
	@Validate({
		service: true,
		args: [editionUpsert],
		returns: editionSchema,
	})
	upsert(input: EditionUpsert, opts: ServiceOpts): Promise<Edition> {
		assertCanWriteEdition(opts.actor, "upsert-edition");
		assertWindow(input.startAt, input.endAt);
		const client = opts.tx ?? this.prisma;

		return client.edition.upsert({
			where: { slug: input.slug },
			update: {
				name: input.name,
				startAt: input.startAt,
				endAt: input.endAt,
			},
			create: {
				slug: input.slug,
				name: input.name,
				startAt: input.startAt,
				endAt: input.endAt,
			},
		});
	}

	/**
	 * Deletes an edition.
	 *
	 * Refuses one that still has courses. The foreign key would raise
	 * anyway; checking first is what turns a constraint error into a
	 * message naming how many courses are in the way.
	 */
	@Validate({ service: true, args: [editionPK] })
	async delete(filter: EditionPK, opts: ServiceOpts): Promise<void> {
		if (!canManageEditions(opts.actor)) {
			throw new NotAllowed({ action: "delete-edition" });
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

/**
 * Enforces {@link canManageEditions}, tagged with `action`.
 *
 * Shared by `create`/`update`/`upsert`: editions are shared infrastructure —
 * their slugs appear in every course URL — so every write path carries the
 * same admin-only rule.
 */
function assertCanWriteEdition(actor: Actor, action: ActionCode): void {
	if (!canManageEditions(actor)) throw new NotAllowed({ action });
}

/** Whether `edition`'s active window contains `at` (default: now). */
export function isEditionOpen(
	edition: Pick<Edition, "startAt" | "endAt">,
	at: Date = new Date(),
): boolean {
	return edition.startAt <= at && at <= edition.endAt;
}

export const editionService = new EditionService();
