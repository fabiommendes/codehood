import type { z } from "zod";
import { ensurePerm } from "@/auth/permissions";
import { FieldError, InvalidData, NotAllowed, NotFound } from "@/core/error";
import {
	editionCreate,
	editionFilter,
	editionPK,
	editionSchema,
	editionUpdate,
} from "@/core/schemas";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import { rejectExpectedUpdatedAt } from "@/db/conditional-write";
import { defineService, op } from "@/db/define-service";
import { m } from "@/i18n";
import { isDateWithin, todayIn } from "@/utils/schedule-time";
import type { PrismaTx } from "../client";

//
// Type definitions
//
export type EditionCreate = z.infer<typeof editionCreate>;
export type Edition = z.infer<typeof editionSchema>;
export type EditionFilter = z.infer<typeof editionFilter>;
export type EditionPK = z.infer<typeof editionPK>;
export type EditionUpdate = z.infer<typeof editionUpdate>;

/// The CRUD shape of the edition service.
type EditionT = {
	entity: Edition;
	pkFilter: EditionPK;
	create: EditionCreate;
	filter: EditionFilter;
	update: EditionUpdate;
};

/**
 * Every user sees every edition — they are labels on courses, not secrets —
 * so `findOne`/`findMany` carry no permission rule.
 *
 * Only the writes carry a rule, because an edition slug occupies part of the
 * course URL namespace and is shared by every instructor teaching that term.
 */
export const makeEditionService = defineService<EditionT>()(() => {
	/**
	 * Creates an edition.
	 *
	 * Rejects a slug that doesn't match `EDITION_RE`, and a window where
	 * `startDate` is after `endDate`.
	 */
	const create = op({
		args: [editionCreate],
		returns: editionSchema,
		run: async (
			tx: PrismaTx,
			input: EditionCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<Edition> => {
			ensurePerm(opts.actor, "edition.create");
			assertWindow(input.startDate, input.endDate);

			try {
				return await tx.edition.create({
					data: {
						slug: input.slug,
						name: input.name,
						startDate: input.startDate,
						endDate: input.endDate,
					},
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

	/** Finds a single edition by slug. */
	const findOne = op({
		transaction: false,
		args: [editionPK],
		returns: editionSchema.nullable(),
		run: async (
			tx: PrismaTx,
			filter: EditionPK,
			_opts: ServiceOptsWithoutTx,
		): Promise<Edition | null> =>
			tx.edition.findUnique({ where: { slug: filter.slug } }),
	});

	/**
	 * Finds many editions, optionally narrowed to `filter.slugs` and/or
	 * `filter.active`.
	 */
	const findMany = op({
		transaction: false,
		args: [editionFilter],
		returns: editionSchema.array(),
		run: async (
			tx: PrismaTx,
			filter: EditionFilter,
			_opts: ServiceOptsWithoutTx,
		): Promise<Edition[]> => {
			const today = todayIn();
			return tx.edition.findMany({
				where: {
					AND: [
						filter.slugs ? { slug: { in: filter.slugs } } : {},
						filter.active
							? { startDate: { lte: today }, endDate: { gte: today } }
							: {},
					],
				},
				orderBy: { slug: "desc" },
			});
		},
	});

	/**
	 * Updates an edition's editable fields.
	 *
	 * `slug` is not editable: it is the token in every course URL under this
	 * edition (see `src/urls/README.md`), so changing it would
	 * move every one of those courses without touching a row.
	 */
	const update = op({
		args: [editionPK, editionUpdate],
		returns: editionSchema,
		run: async (
			tx: PrismaTx,
			filter: EditionPK,
			fields: EditionUpdate,
			opts: ServiceOptsWithoutTx,
		): Promise<Edition> => {
			ensurePerm(opts.actor, "edition.update");
			rejectExpectedUpdatedAt(opts);
			const current = await tx.edition.findUnique({
				where: { slug: filter.slug },
			});
			if (!current) {
				throw new NotFound("edition", {
					id: filter.slug,
					message: m.errors_edition_not_found({ slug: filter.slug }),
				});
			}
			assertWindow(
				fields.startDate ?? current.startDate,
				fields.endDate ?? current.endDate,
			);
			return tx.edition.update({
				where: { slug: filter.slug },
				data: fields,
			});
		},
	});

	/**
	 * Upserts an edition keyed on `slug`: creates it if absent, else updates
	 * its editable fields.
	 *
	 * Same permission and window checks as `create`/`update`, run once
	 * regardless of which branch Prisma takes.
	 */
	const upsert = op({
		args: [editionCreate],
		returns: editionSchema,
		run: async (
			tx: PrismaTx,
			input: EditionCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<Edition> => {
			ensurePerm(opts.actor, "edition.create");
			rejectExpectedUpdatedAt(opts);
			assertWindow(input.startDate, input.endDate);

			return tx.edition.upsert({
				where: { slug: input.slug },
				update: {
					name: input.name,
					startDate: input.startDate,
					endDate: input.endDate,
				},
				create: {
					slug: input.slug,
					name: input.name,
					startDate: input.startDate,
					endDate: input.endDate,
				},
			});
		},
	});

	/**
	 * Deletes an edition.
	 *
	 * Refuses one that still has courses. The foreign key would raise
	 * anyway; checking first is what turns a constraint error into a
	 * message naming how many courses are in the way.
	 */
	const remove = op({
		args: [editionPK],
		run: async (
			tx: PrismaTx,
			filter: EditionPK,
			opts: ServiceOptsWithoutTx,
		): Promise<void> => {
			ensurePerm(opts.actor, "edition.delete");
			rejectExpectedUpdatedAt(opts);
			const courses = await tx.course.count({
				where: { editionSlug: filter.slug },
			});
			if (courses > 0) {
				throw new NotAllowed("edition.delete", {
					status: 409,
					message: m.errors_edition_has_courses({
						slug: filter.slug,
						count: courses,
					}),
				});
			}
			await tx.edition.deleteMany({ where: { slug: filter.slug } });
		},
	});

	return { create, findOne, findMany, update, upsert, delete: remove };
});

/** The edition service, as built by {@link makeEditionService}. */
export type EditionService = ReturnType<typeof makeEditionService>;

function assertWindow(startDate: string, endDate: string): void {
	if (startDate > endDate) {
		throw new InvalidData({
			endDate: [
				{
					code: "invalid",
					message: m.errors_edition_window(),
				},
			],
		});
	}
}

/** Whether `edition`'s window contains `today` (default: today in the server's zone), both ends inclusive. */
export function isEditionOpen(
	edition: { startDate: string; endDate: string },
	today: string = todayIn(),
): boolean {
	return isDateWithin(today, edition.startDate, edition.endDate);
}
